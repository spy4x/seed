/// <reference lib="deno.ns" />
/**
 * Dumps the Compose Postgres database, gzips it and uploads it to S3.
 *
 * Usage, on the server, from the app's directory:
 * `deno run -R -W --allow-run=docker infra/scripts/db-backup-create.ts infra/envs/.env`
 *
 * It reads `PROJECT`, `DB_NAME`, `DB_USER`, `DB_PASS` and the `S3_BUCKET_BACKUPS_*` variables
 * from the env file. `pg_dump` runs in the `<PROJECT>-db` container and its output is gzipped
 * while it streams, into a temporary directory that is removed at the end. The upload runs the
 * `amazon/aws-cli` image. Passwords and keys reach `docker` through its environment, never its
 * arguments, so they do not show in the process list.
 *
 * @module
 */

import { error, log, success } from "./+lib.ts"
import { createEnvReader, readEnvVar } from "@spy4x/server/config"
import { describeEnvFileError, readEnvFile } from "./env-file.ts"

/** One `docker` invocation: its arguments and the variables it passes into the container. */
export interface DockerRun {
  args: string[]
  env: Record<string, string>
}

/** What {@link planBackup} decides; running it is `main`'s job. */
export interface BackupPlan {
  /** `<DB_NAME>-<timestamp>.sql.gz`. */
  fileName: string
  dump: DockerRun
  /** Uploads `<directory>/<fileName>`. */
  upload(directory: string): DockerRun
}

/**
 * Builds the dump and upload commands from the env file's values. Runs nothing.
 *
 * @throws {import("@spy4x/server/config").MissingEnvError} When a required variable is missing.
 */
export function planBackup(
  values: Record<string, string>,
  now: Date,
): BackupPlan {
  const env = createEnvReader(values)
  const read = (name: string) => readEnvVar(env, name)
  const container = `${read("PROJECT")}-db`
  const dbName = read("DB_NAME")
  const dbUser = read("DB_USER")
  const dbPass = read("DB_PASS")
  const bucket = read("S3_BUCKET_BACKUPS_NAME")
  const folder = read("S3_BUCKET_BACKUPS_DB_FOLDER")
  const region = read("S3_BUCKET_BACKUPS_REGION")
  const s3Env = {
    AWS_ACCESS_KEY_ID: read("S3_BUCKET_BACKUPS_ACCESS_KEY_ID"),
    AWS_SECRET_ACCESS_KEY: read("S3_BUCKET_BACKUPS_SECRET_ACCESS_KEY"),
    AWS_DEFAULT_REGION: region,
    AWS_ENDPOINT_URL: read("S3_BUCKET_BACKUPS_ENDPOINT"),
  }
  const fileName = `${dbName}-${now.toISOString().replace(/[:.]/g, "_")}.sql.gz`
  /** `-e NAME` with no value: docker copies the value from its own environment. */
  const passEnv = (env: Record<string, string>) => Object.keys(env).flatMap((name) => ["-e", name])

  const dumpEnv = { PGPASSWORD: dbPass }
  return {
    fileName,
    dump: {
      args: [
        "exec",
        "-i",
        ...passEnv(dumpEnv),
        container,
        "pg_dump",
        "-h",
        container,
        "-U",
        dbUser,
        dbName,
      ],
      env: dumpEnv,
    },
    upload: (directory) => ({
      args: [
        "run",
        "--rm",
        "-v",
        `${directory}:${directory}:ro`,
        ...passEnv(s3Env),
        "amazon/aws-cli",
        "s3",
        "cp",
        `${directory}/${fileName}`,
        `s3://${bucket}/${folder}/${fileName}`,
        "--region",
        region,
      ],
      env: s3Env,
    }),
  }
}

/** Runs `pg_dump` and writes its output, gzipped, to `path`. Returns docker's exit code. */
async function dumpTo(run: DockerRun, path: string): Promise<number> {
  const child = new Deno.Command("docker", {
    args: run.args,
    env: run.env,
    stdin: "null",
    stdout: "piped",
    stderr: "inherit",
  }).spawn()
  const file = await Deno.open(path, { write: true, createNew: true, mode: 0o600 })
  await child.stdout.pipeThrough(new CompressionStream("gzip")).pipeTo(file.writable)
  return (await child.status).code
}

async function main(): Promise<void> {
  const envFilePath = Deno.args[0]
  if (!envFilePath) {
    error("Usage: deno run -R -W --allow-run=docker db-backup-create.ts <env file>")
    Deno.exit(1)
  }
  let plan: BackupPlan
  try {
    plan = planBackup(await readEnvFile(envFilePath), new Date())
  } catch (err) {
    error(describeEnvFileError(err, envFilePath))
    Deno.exit(1)
  }

  const directory = await Deno.makeTempDir({ prefix: "db-backup-" })
  let code = 0
  try {
    const path = `${directory}/${plan.fileName}`
    log(`Dumping and compressing to ${plan.fileName}...`)
    let started = Date.now()
    code = await dumpTo(plan.dump, path)
    if (code !== 0) {
      error(`pg_dump failed (docker exited with ${code})`)
      return
    }
    const size = (await Deno.stat(path)).size / 1024 / 1024
    log(`Dumped in ${(Date.now() - started) / 1000} s, ${size.toFixed(2)} MB.`)

    log("Uploading...")
    started = Date.now()
    const upload = plan.upload(directory)
    code = (await new Deno.Command("docker", { args: upload.args, env: upload.env }).spawn()
      .status).code
    if (code !== 0) {
      error(`Upload failed (docker exited with ${code})`)
      return
    }
    success(`Uploaded in ${(Date.now() - started) / 1000} s.`)
  } finally {
    await Deno.remove(directory, { recursive: true })
    if (code !== 0) Deno.exit(code)
  }
}

if (import.meta.main) await main()
