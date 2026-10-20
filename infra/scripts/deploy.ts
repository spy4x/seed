/// <reference lib="deno.ns" />
/**
 * Copies the app to a server over SSH and starts it there with Compose.
 *
 * Usage: `deno task deploy [--allow-dirty] [env file]`. The env file defaults to
 * `infra/envs/.env.prod` and must live under `infra/`. It reads:
 *
 * - `SSH_TO_SERVER` (required): the SSH destination, `user@host` or a `Host` alias from
 *   `~/.ssh/config`.
 * - `PATH_ON_SERVER` (required): the app's directory on the server, absolute or relative to the
 *   SSH user's home directory (a leading `~/` is read as the home directory too).
 * - `DENO_ON_SERVER` (optional, default `deno`): the command that runs Deno on the server. The
 *   remote command puts `~/.deno/bin`, the Deno installer's directory, on `PATH` first.
 *
 * `SSH_TO_SERVER` and `DENO_ON_SERVER` are trusted operator input: the first is passed to ssh and
 * rsync as a destination, the second runs unquoted in the remote shell (so `~/bin/deno` works).
 * `PATH_ON_SERVER` is quoted.
 *
 * Before anything is sent, the deploy stops when the working tree has uncommitted changes,
 * untracked files included, because the copy sends the files as they are on disk and what runs on
 * the server would then match no commit. `--allow-dirty` sends them anyway. It also stops when a
 * password or secret in the env file equals one that `infra/envs/.env.example` prints, or when one
 * that the example file sets is empty or left out. The message names each such variable and never
 * prints a value.
 *
 * Four steps, each stopping the deploy when it fails: rsync the files that
 * `infra/deploy/include.txt` names, leaving out every env file (any `.env*` or `*.env`, anywhere,
 * and the chosen env file itself) and the web push keys, replacing every server file that differs
 * from this checkout's, a newer one too (so a deploy from an older commit is a full rollback), and
 * deleting server files under those paths that are gone here (excluded files are never deleted,
 * so a file placed by hand under `apps/`, `libs/` or `infra/` survives only if it is an env file
 * or the web push keys); copy the chosen env file to
 * `infra/envs/.env` on the server, readable by its owner only; create `infra/configs/vapid.json`
 * on the server when it is missing (never sent from this machine, never overwritten, mode 600);
 * then run `deno task compose up -d --build` there. Compose's one-shot `migrate` service applies
 * pending migrations before the API and the worker start, and a failed migration fails this step.
 * That task refuses a host port something else holds before it changes anything, and starts the
 * product before the optional services (compose-checks.ts).
 *
 * @module
 */

import { error, log, success } from "./+lib.ts"
import { createEnvReader, readEnvVar } from "@spy4x/server/config"
import { shellQuote } from "@spy4x/platform/universal/shell"
import { describeEnvFileError, readEnvFile } from "./env-file.ts"

/** The env file used when no argument names one. */
export const DEFAULT_ENV_FILE = "infra/envs/.env.prod"

/** Where the API's web push keys live, relative to the app's directory. */
export const VAPID_PATH = "infra/configs/vapid.json"

/** The file whose secret values are public, so none of them may reach a server. */
export const EXAMPLE_ENV_FILE = "infra/envs/.env.example"

/** What the name of a variable that holds a password, secret or key contains. */
const SECRET_NAME = /PASS|SECRET|PEPPER|TOTP|KEY|TOKEN/

/**
 * Secrets only a development machine uses, so a production env file may leave them out or keep the
 * example's value. `SEED_PASSWORD` is the development administrator's password: `db:seed` and
 * `db:reset` refuse to run unless `ENV` is `dev`. The example's value stays public for every other
 * variable.
 */
const DEVELOPMENT_ONLY: readonly string[] = ["SEED_PASSWORD"]

/**
 * Parts of a name that hold one of the words above without naming a secret: `PASSKEY` (the sign-in
 * method, as in `PASSKEY_RP_ID`), and a name that ends by describing a key instead of holding one
 * (`S3_KEY_PREFIX`, `S3_BUCKET_BACKUPS_ACCESS_KEY_ID`).
 */
const NOT_A_SECRET = /PASSKEY|KEY_(ID|PREFIX)$/g

/**
 * Whether a variable holds a password, secret or key, going by its name. The exemptions are cut
 * out of the name first, so the rest of it still counts: `PASSKEY_SECRET` and `SECRET_KEY_ID` stay
 * secrets.
 */
export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name.replace(NOT_A_SECRET, ""))
}

/** One secret a deploy must not go ahead with, and why. */
export interface UnsafeSecret {
  name: string
  /** `example`: its value is one the example file prints. `empty`: it has no value. */
  reason: "example" | "empty"
}

/**
 * The secrets of `values` that are not safe to deploy, in the example file's order first.
 *
 * A variable is a secret when its name says so ({@link isSecretName}). Every secret the example gives a value is public,
 * so a secret of `values` that equals any of those values is unsafe, whichever variable holds it
 * (`DB_PASS=change-me` too). A secret the example gives a value must also have one here: left empty
 * or out, its service starts with no password or its built-in one. A secret the example leaves
 * empty is optional and may stay empty. The list follows `.env.example` and needs no copy here.
 */
export function unsafeSecretsIn(
  values: Record<string, string>,
  example: Record<string, string>,
): UnsafeSecret[] {
  const required = Object.keys(example).filter((name) =>
    isSecretName(name) && example[name] !== ""
  )
  const published = new Set(required.map((name) => example[name]))
  const names = new Set([...required, ...Object.keys(values).filter(isSecretName)])
  const unsafe: UnsafeSecret[] = []
  for (const name of names) {
    if (DEVELOPMENT_ONLY.includes(name)) continue
    const value = values[name] ?? ""
    if (published.has(value)) unsafe.push({ name, reason: "example" })
    else if (value === "" && required.includes(name)) unsafe.push({ name, reason: "empty" })
  }
  return unsafe
}

/**
 * Stops a deploy whose env file holds an example secret or leaves a required one empty.
 *
 * @throws {Error} Naming the env file and each such variable, never a value.
 */
export function refuseExampleSecrets(
  values: Record<string, string>,
  example: Record<string, string>,
  envFilePath: string,
): void {
  const unsafe = unsafeSecretsIn(values, example)
  if (unsafe.length === 0) return
  const named = (reason: UnsafeSecret["reason"]) =>
    unsafe.filter((secret) => secret.reason === reason).map((secret) => secret.name).join(", ")
  const problems = [
    named("example") &&
    `holds a value from ${EXAMPLE_ENV_FILE}, which is public, in ${named("example")}`,
    named("empty") && `has no value for ${named("empty")}`,
  ].filter(Boolean)
  throw new Error(
    `${envFilePath} ${problems.join(" and ")}. Set a real value for each before deploying.`,
  )
}

/**
 * Reads the env file at `envFilePath`, refuses it when a secret is unsafe, and plans the deploy.
 * Every deploy goes through here, so no step is planned for a refused file.
 *
 * @param read Reads one env file; replaced in tests.
 * @throws {Error} When the example file is missing, a secret is unsafe or a variable is missing.
 */
export async function planFromEnvFile(
  envFilePath: string,
  read: (path: string) => Promise<Record<string, string>> = readEnvFile,
): Promise<DeployStep[]> {
  const values = await read(envFilePath)
  let example: Record<string, string>
  try {
    example = await read(EXAMPLE_ENV_FILE)
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err
    throw new Error(
      `${EXAMPLE_ENV_FILE} is missing. The deploy reads it to refuse the passwords it prints; ` +
        `restore it before deploying.`,
    )
  }
  refuseExampleSecrets(values, example, envFilePath)
  return planDeploy(values, envFilePath)
}

/** The flag that lets a deploy send a working tree with uncommitted changes. */
export const ALLOW_DIRTY_FLAG = "--allow-dirty"

/** What the command line of `deno task deploy` asks for. */
export interface DeployArgs {
  envFilePath: string
  allowDirty: boolean
}

/**
 * Reads the command line: an optional {@link ALLOW_DIRTY_FLAG} and an optional env file, in any
 * order.
 *
 * @throws {Error} On an unknown flag or a second env file, so a typo never deploys by accident.
 */
export function parseDeployArgs(args: readonly string[]): DeployArgs {
  const allowDirty = args.includes(ALLOW_DIRTY_FLAG)
  const rest = args.filter((arg) => arg !== ALLOW_DIRTY_FLAG)
  const unknown = rest.find((arg) => arg.startsWith("-"))
  if (unknown) throw new Error(`Unknown option ${unknown}. The only option is ${ALLOW_DIRTY_FLAG}.`)
  if (rest.length > 1) throw new Error(`Name at most one env file, not ${rest.join(" and ")}.`)
  return { envFilePath: rest[0] ?? DEFAULT_ENV_FILE, allowDirty }
}

/**
 * Stops a deploy from a working tree with uncommitted changes, unless `allowDirty` is set.
 *
 * @param status The output of `git status --porcelain`: one line per changed or untracked file.
 * @throws {Error} Naming the first changed files and {@link ALLOW_DIRTY_FLAG}.
 */
export function refuseDirtyTree(status: string, allowDirty: boolean): void {
  if (allowDirty) return
  const changed = status.split("\n").filter((line) => line.trim() !== "")
  if (changed.length === 0) return
  const shown = changed.slice(0, 5).map((line) => `  ${line.trim()}`)
  if (changed.length > shown.length) shown.push(`  and ${changed.length - shown.length} more`)
  throw new Error(
    [
      `The working tree has uncommitted changes, and the deploy would send them as they are:`,
      ...shown,
      `Commit or stash them first, or run \`deno task deploy ${ALLOW_DIRTY_FLAG}\` ` +
      `to send them anyway.`,
    ].join("\n"),
  )
}

/**
 * Lists this checkout's uncommitted changes, untracked files included, with `git status`.
 *
 * @throws {Error} When git cannot answer, naming {@link ALLOW_DIRTY_FLAG}: a tree that cannot be
 *   checked is not taken for a clean one.
 */
async function readWorkingTreeStatus(): Promise<string> {
  let output: Deno.CommandOutput
  try {
    output = await new Deno.Command("git", {
      args: ["status", "--porcelain", "--untracked-files=normal"],
      stdout: "piped",
      stderr: "piped",
    }).output()
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err
    throw new Error(
      `git is not installed, so the deploy cannot check for uncommitted changes. ` +
        `Install it, or pass ${ALLOW_DIRTY_FLAG} to deploy without the check.`,
    )
  }
  const decoder = new TextDecoder()
  if (!output.success) {
    throw new Error(
      `git status failed, so the deploy cannot check for uncommitted changes: ` +
        `${decoder.decode(output.stderr).trim()}. ` +
        `Pass ${ALLOW_DIRTY_FLAG} to deploy without the check.`,
    )
  }
  return decoder.decode(output.stdout)
}

/** One program to run, with its arguments, and what to call it in the log. */
export interface DeployStep {
  label: string
  command: "rsync" | "ssh"
  args: string[]
}

/**
 * Builds the deploy steps from the env file's values. Runs nothing.
 *
 * @throws {import("@spy4x/server/config").MissingEnvError} When a required variable is missing.
 */
export function planDeploy(values: Record<string, string>, envFilePath: string): DeployStep[] {
  const env = createEnvReader(values)
  const server = readEnvVar(env, "SSH_TO_SERVER")
  const path = readEnvVar(env, "PATH_ON_SERVER").replace(/^~\//, "")
  const deno = values.DENO_ON_SERVER || "deno"
  const denoPath = `PATH="$HOME/.deno/bin:$PATH" ${deno}`
  const remoteCommand = [
    `cd ${shellQuote(path)}`,
    `${denoPath} task compose up -d --build`,
  ].join(" && ")
  // An earlier start without the file leaves an empty directory there (Docker creates one for a
  // missing bind-mount source); `rmdir` removes only an empty one. A file that exists is kept.
  const vapidCommand = [
    `cd ${shellQuote(path)}`,
    `if [ -d ${VAPID_PATH} ]; then rmdir ${VAPID_PATH}; fi`,
    `if [ ! -e ${VAPID_PATH} ]; then (umask 077 && ${denoPath} task vapid-key:create); fi`,
    `chmod 600 ${VAPID_PATH}`,
  ].join(" && ")
  return [
    {
      label: "Copying files",
      command: "rsync",
      args: [
        // No `-u`: it keeps every file that is newer on the server, so a rollback, or a deploy
        // after a file was edited there, left a mix of two versions and still reported success.
        "-avhz",
        // Removes files deleted here, so a stale module cannot break the build on the server.
        // Excluded paths (the env file, the private key) are never deleted: no --delete-excluded.
        "--delete",
        "-e",
        "ssh",
        "--exclude-from=infra/deploy/exclude.txt",
        // Before include.txt, whose apps/***, libs/*** and infra/*** would otherwise send every
        // local env file. A pattern without a slash matches a file name in any directory.
        "--exclude=.env*",
        "--exclude=*.env",
        `--exclude=/${envFilePath.replace(/^\.\//, "")}`,
        // The private key is made on the server and stays there, whatever this machine holds.
        `--exclude=/${VAPID_PATH}`,
        "--include-from=infra/deploy/include.txt",
        "--exclude=*",
        ".",
        `${server}:${path}`,
      ],
    },
    {
      label: `Copying ${envFilePath} to infra/envs/.env`,
      command: "rsync",
      args: ["-e", "ssh", "-p", "--chmod=F600", envFilePath, `${server}:${path}/infra/envs/.env`],
    },
    { label: "Creating web push keys if missing", command: "ssh", args: [server, vapidCommand] },
    { label: "Starting the app", command: "ssh", args: [server, remoteCommand] },
  ]
}

/** Runs one step with the terminal attached. Returns its exit code. */
async function run(step: DeployStep): Promise<number> {
  try {
    const command = new Deno.Command(step.command, {
      args: step.args,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    return (await command.output()).code
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err
    error(`${step.command} is not installed on this machine`)
    return 1
  }
}

async function main(): Promise<void> {
  let args: DeployArgs
  try {
    args = parseDeployArgs(Deno.args)
    refuseDirtyTree(args.allowDirty ? "" : await readWorkingTreeStatus(), args.allowDirty)
  } catch (err) {
    error(err instanceof Error ? err.message : String(err))
    Deno.exit(1)
  }
  const { envFilePath } = args
  let steps: DeployStep[]
  try {
    steps = await planFromEnvFile(envFilePath)
  } catch (err) {
    error(describeEnvFileError(err, envFilePath))
    Deno.exit(1)
  }
  for (const step of steps) {
    log(`${step.label}...`)
    const code = await run(step)
    if (code !== 0) {
      error(`${step.label} failed (${step.command} exited with ${code})`)
      Deno.exit(code)
    }
  }
  success("Deploy completed.")
}

if (import.meta.main) await main()
