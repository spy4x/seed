/// <reference lib="deno.ns" />
/**
 * Resets a development database: drops it, creates it again, applies every migration
 * (`db:migrate`) and seeds the demo data (`db:seed`).
 *
 * Usage, with the same `DB_*` values the other `db:*` tasks read (and `AUTH_PEPPER` and
 * `SEED_PASSWORD` for the seed):
 * `ENV=dev deno task db:reset` asks for confirmation; `deno task db:reset --yes` does not.
 * `--no-prod-check` skips the production-name guard (see below); `--prod-env-file=<path>` reads
 * the production values from another file, which the tests use.
 *
 * It refuses, before it touches anything, unless all of these hold:
 *
 * - `ENV` is `dev`;
 * - `DB_PORT` is a port number, and `DB_USER` and `DB_PASS` are set. The reset has no default for
 *   them, because `db:migrate` and `db:seed` have none: a reset that guessed the port dropped the
 *   database and then failed in the first of them;
 * - `AUTH_PEPPER` and `SEED_PASSWORD` pass the seed's own check (`readSeedOptions`).
 *
 * So a value the migration or the seed cannot start without stops the reset before the drop.
 * - `DB_HOST` is `localhost`, `127.0.0.1` or `db`, the Compose service name of the development
 *   database;
 * - `DB_NAME` is not the `DB_NAME` in `infra/envs/.env.prod`. This guard fails closed: a missing
 *   file, a missing or empty `DB_NAME`, or a value with `$` (Compose would expand it, so it cannot
 *   be compared as written) refuses the reset. `--no-prod-check` skips the guard on a machine that
 *   has no production file; the target line then says so.
 *
 * Refusals never print a host or a database name, so a production value cannot reach a log.
 *
 * @module
 */

import postgres from "postgres"
import { parseEnvValues } from "./env-file.ts"
import { readSeedOptions } from "./seed-data.ts"

/** Where the production values live. Only `DB_NAME` is read, only inside this script. */
export const PROD_ENV_PATH = "./infra/envs/.env.prod"

/** Hosts a reset may target: this machine, and the Compose service name of the dev database. */
export const ALLOWED_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "db"]

/** Raised when a guard refuses the reset. The message never carries a host or a name. */
export class ResetRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResetRefusedError"
  }
}

const NO_PROD_FILE = "no production file to compare against"

/**
 * Reads `DB_NAME` out of `.env.prod` content. Line endings may be CRLF.
 *
 * @throws {ResetRefusedError} When the file is missing (`content` undefined), `DB_NAME` is missing
 *   or empty, or its value contains `$`. The message never carries the value.
 */
export function readProdDbName(content: string | undefined, path = PROD_ENV_PATH): string {
  if (content === undefined) {
    throw new ResetRefusedError(
      `${NO_PROD_FILE}: ${path} is missing (pass --no-prod-check to skip the check)`,
    )
  }
  const name = parseEnvValues(content.replaceAll("\r\n", "\n"), path).DB_NAME
  if (!name) throw new ResetRefusedError("DB_NAME is missing or empty in the production file")
  if (name.includes("$")) {
    throw new ResetRefusedError("the production DB_NAME uses variable expansion, which is refused")
  }
  return name
}

/**
 * Checks the guards. `prodDbName` is `undefined` only when the production check is skipped.
 *
 * @throws {ResetRefusedError} When `ENV` is not `dev`, the host is not local, the name is missing,
 *   the name matches `prodDbName`, `DB_PORT` is not a port number, or `DB_USER` or `DB_PASS` is
 *   missing.
 */
export function checkGuards(
  env: Record<string, string | undefined>,
  prodDbName: string | undefined,
): void {
  if (env.ENV !== "dev") throw new ResetRefusedError("ENV must be dev")
  if (!ALLOWED_HOSTS.includes(env.DB_HOST ?? "")) {
    throw new ResetRefusedError("the database host is not local (localhost, 127.0.0.1 or db)")
  }
  if (!env.DB_NAME) throw new ResetRefusedError("DB_NAME is not set")
  if (prodDbName !== undefined && env.DB_NAME === prodDbName) {
    throw new ResetRefusedError("the database name matches production")
  }
  // `db:migrate` and `db:seed` run with `-N=$DB_HOST:$DB_PORT` and connect with these values, so
  // without them they fail after the drop.
  const port = env.DB_PORT ?? ""
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new ResetRefusedError("DB_PORT must be set to a port number")
  }
  if (!env.DB_USER) throw new ResetRefusedError("DB_USER is not set")
  if (!env.DB_PASS) throw new ResetRefusedError("DB_PASS is not set")
}

/** The steps a reset runs, replaceable so tests need no database. */
export interface ResetSteps {
  /** Shows the target; called before every reset, with or without a question. */
  announce(target: string): void
  /** Asks the person to confirm `target`; resolves true to go on. */
  confirm(target: string): boolean | Promise<boolean>
  recreate(env: Record<string, string | undefined>): Promise<void>
  migrate(): Promise<void>
  seed(): Promise<void>
}

/**
 * Runs the guards and the seed's own check of its variables, asks for confirmation unless `yes`,
 * then recreates, migrates and seeds. Returns false when the person declined; nothing has changed
 * then.
 *
 * @throws {ResetRefusedError} When a guard refuses; no step has run then.
 * @throws {SeedConfigError} When the seed would refuse its variables; no step has run then.
 */
export async function runReset(
  env: Record<string, string | undefined>,
  prodEnvContent: string | undefined,
  options: { yes: boolean; skipProdCheck?: boolean; prodPath?: string },
  steps: ResetSteps,
): Promise<boolean> {
  const prodPath = options.prodPath ?? PROD_ENV_PATH
  checkGuards(env, options.skipProdCheck ? undefined : readProdDbName(prodEnvContent, prodPath))
  // The seed runs last, in a process of its own with this same environment. What it would refuse
  // is refused here, before the drop.
  readSeedOptions(env)
  const target = `${env.DB_NAME} on ${env.DB_HOST}:${env.DB_PORT}` +
    (options.skipProdCheck
      ? ` (${NO_PROD_FILE})`
      : prodPath === PROD_ENV_PATH
      ? ""
      : ` (production file: ${prodPath})`)
  steps.announce(target)
  if (!options.yes && !(await steps.confirm(target))) return false
  await steps.recreate(env)
  await steps.migrate()
  await steps.seed()
  return true
}

/**
 * Drops the database named by `DB_NAME` (closing its open connections) and creates it empty,
 * connecting through the server's `postgres` maintenance database.
 */
export async function recreateDatabase(env: Record<string, string | undefined>): Promise<void> {
  const name = env.DB_NAME!
  const sql = postgres({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USER,
    password: env.DB_PASS,
    database: "postgres",
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  })
  try {
    await sql`DROP DATABASE IF EXISTS ${sql(name)} WITH (FORCE)`
    await sql`CREATE DATABASE ${sql(name)}`
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function runTask(task: string): Promise<void> {
  const { code } = await new Deno.Command("deno", {
    args: ["task", task],
    stdout: "inherit",
    stderr: "inherit",
  }).output()
  if (code !== 0) throw new Error(`deno task ${task} failed (exit ${code})`)
}

async function main(): Promise<void> {
  const env = Deno.env.toObject()
  const prodPath = Deno.args.find((a) => a.startsWith("--prod-env-file="))?.slice(16) ??
    PROD_ENV_PATH
  let prodEnv: string | undefined
  try {
    prodEnv = await Deno.readTextFile(prodPath)
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  try {
    const done = await runReset(env, prodEnv, {
      yes: Deno.args.includes("--yes"),
      skipProdCheck: Deno.args.includes("--no-prod-check"),
      prodPath,
    }, {
      announce: (target) => console.log(`Target: ${target}`),
      confirm: (target) => {
        const answer = prompt(`Drop and recreate ${target}? All its data is lost. [y/N]`)
        return answer?.trim().toLowerCase() === "y"
      },
      recreate: recreateDatabase,
      migrate: () => runTask("db:migrate"),
      seed: () => runTask("db:seed"),
    })
    console.log(done ? "✅ Database reset and seeded." : "Cancelled. Nothing changed.")
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`)
    Deno.exit(1)
  }
}

if (import.meta.main) await main()
