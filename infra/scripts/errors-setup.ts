/// <reference lib="deno.ns" />
/**
 * `deno task errors:setup`: once the `errors` profile's GlitchTip runs, makes what the project
 * reports to and writes the two DSNs into `infra/envs/.env` (docs/stack.md, "Error tracking").
 *
 * In the running `errors` container, GlitchTip, it runs `infra/configs/glitchtip-setup.py`, which
 * makes the superuser (`DEV_EMAIL`, first password `GLITCHTIP_ADMIN_PASSWORD`), an organization
 * named after `PROJECT` and the projects `api` and `spa`, each only when missing. Then it sets
 * `ERROR_REPORT_DSN` and `SPA_ERROR_REPORT_DSN` while they are empty, and keeps a value someone
 * set. Safe to run again: a second run makes nothing and writes nothing. It never prints a DSN or a
 * password.
 *
 * The API's DSN names GlitchTip's container, not `ERRORS_DOMAIN`: the API reaches it on the
 * project's own network, with no trip out through the proxy, in development too, where
 * `errors.localhost` would be the API container itself.
 *
 * @module
 */
import { type } from "arktype"
import { runCommand } from "@spy4x/platform/server"
import { planCompose } from "./compose-plan.ts"
import { describeEnvFileError, parseEnvValues } from "./env-file.ts"
import { setValue, writeSafely } from "./init.ts"

const ENV_PATH = `infra/envs/.env`

/** The env file's DSN variables, and the GlitchTip project each one takes its DSN from. */
export const DSN_KEYS = { ERROR_REPORT_DSN: `api`, SPA_ERROR_REPORT_DSN: `spa` } as const

/** The port GlitchTip's image listens on inside the project's network. */
const GLITCHTIP_PORT = 8000

/**
 * Why setup cannot run with this env file, in words that say what to change, or `undefined` when
 * it can.
 */
export function setupProblem(env: Record<string, string>): string | undefined {
  const profiles = (env.COMPOSE_PROFILES ?? ``).split(`,`).map((profile) => profile.trim())
  if (!profiles.includes(`errors`)) {
    return `The errors profile is off. Add errors to COMPOSE_PROFILES in ${ENV_PATH}, ` +
      `start it with deno task compose up -d, then run deno task errors:setup again.`
  }
  for (const key of [`PROJECT`, `ERRORS_DOMAIN`, `DEV_EMAIL`, `GLITCHTIP_ADMIN_PASSWORD`]) {
    if (!env[key]) return `${key} is empty in ${ENV_PATH}; deno task init fills the passwords.`
  }
  return undefined
}

/** What `glitchtip-setup.py` prints last. */
const SetupOutput = type({
  dsns: { api: `string > 0`, spa: `string > 0` },
  made: `string[]`,
})

/** The parsed last line of `glitchtip-setup.py`'s output. */
export type SetupOutput = typeof SetupOutput.infer

/**
 * Reads the JSON line `glitchtip-setup.py` prints last.
 * @throws {Error} When the output ends in anything else. The message never quotes the output,
 *   since it holds the DSNs.
 */
export function parseSetupOutput(stdout: string): SetupOutput {
  const last = stdout.trim().split(`\n`).at(-1) ?? ``
  let json: unknown
  try {
    json = JSON.parse(last)
  } catch {
    throw new Error(`GlitchTip's setup did not end with its JSON line`)
  }
  const output = SetupOutput(json)
  if (output instanceof type.errors) {
    throw new Error(`GlitchTip's setup printed an unexpected line: ${output.summary}`)
  }
  return output
}

/**
 * `dsn` with its address replaced by GlitchTip's container on the project's own network, which is
 * how the API reaches it.
 * @throws {Error} When `dsn` is not a DSN with a key and a project.
 */
export function internalDsn(dsn: string, project: string): string {
  const url = URL.parse(dsn)
  if (!url?.username || !/^\/\d+$/.test(url.pathname)) {
    throw new Error(`GlitchTip gave no usable DSN; check ERRORS_DOMAIN`)
  }
  return `http://${url.username}@${project}-errors:${GLITCHTIP_PORT}${url.pathname}`
}

/** What {@link writeDsns} did to each DSN variable. */
export interface DsnWrite {
  text: string
  /** Set now: it was empty, or not in the file. */
  written: string[]
  /** Left alone: it holds another address, set by someone. */
  kept: string[]
}

/**
 * The env file with each DSN variable set to its value in `dsns`, but only where it is empty or
 * missing. A variable that already holds that value, or any other, is not touched.
 */
export function writeDsns(text: string, dsns: Record<keyof typeof DSN_KEYS, string>): DsnWrite {
  const written: string[] = []
  const kept: string[] = []
  for (const key of Object.keys(DSN_KEYS) as (keyof typeof DSN_KEYS)[]) {
    const values = parseEnvValues(text, ENV_PATH)
    const value = dsns[key]
    if (!(key in values)) {
      text = `${text}${text.endsWith(`\n`) || text === `` ? `` : `\n`}${key}=${value}\n`
      written.push(key)
    } else if (values[key] === ``) {
      text = setValue(text, key, ``, value)
      written.push(key)
    } else if (values[key] !== value) {
      kept.push(key)
    }
  }
  return { text, written, kept }
}

if (import.meta.main) {
  let text: string
  let env: Record<string, string>
  try {
    text = await Deno.readTextFile(ENV_PATH)
    env = parseEnvValues(text, ENV_PATH)
  } catch (error) {
    console.error(describeEnvFileError(error, ENV_PATH))
    Deno.exit(1)
  }
  const problem = setupProblem(env)
  if (problem !== undefined) {
    console.error(problem)
    Deno.exit(1)
  }

  // The values go through the environment, so no password is on a command line.
  const inputs = [`SETUP_ORGANIZATION`, `SETUP_ADMIN_EMAIL`, `SETUP_ADMIN_PASSWORD`]
  const plan = planCompose(env, [
    `exec`,
    `-T`,
    ...inputs.flatMap((name) => [`-e`, name]),
    `errors`,
    `python`,
    `/seed/glitchtip-setup.py`,
  ], ENV_PATH)
  const result = await runCommand([plan.engine, ...plan.command], {
    env: {
      SETUP_ORGANIZATION: env.PROJECT,
      SETUP_ADMIN_EMAIL: env.DEV_EMAIL,
      SETUP_ADMIN_PASSWORD: env.GLITCHTIP_ADMIN_PASSWORD,
    },
    signal: AbortSignal.timeout(120_000),
  })
  if (!result.success) {
    console.error(result.stderr.trim())
    console.error(
      `GlitchTip's setup failed. Is it running? Start it with deno task compose up -d, ` +
        `wait until it is healthy, then run deno task errors:setup again.`,
    )
    Deno.exit(1)
  }

  const { dsns, made } = parseSetupOutput(result.stdout)
  console.log(made.length > 0 ? `Made in GlitchTip: ${made.join(`, `)}` : `GlitchTip: nothing new`)
  const { text: updated, written, kept } = writeDsns(text, {
    ERROR_REPORT_DSN: internalDsn(dsns.api, env.PROJECT),
    SPA_ERROR_REPORT_DSN: dsns.spa,
  })
  if (written.length > 0) {
    await writeSafely(ENV_PATH, updated)
    console.log(`Set ${written.join(`, `)} in ${ENV_PATH}. Apply: deno task compose up -d`)
  }
  for (const key of kept) {
    console.log(`Kept ${key}: it already names another tracker. Empty it to use this GlitchTip.`)
  }
  if (written.length === 0 && kept.length === 0) console.log(`Both DSNs are set already.`)
}
