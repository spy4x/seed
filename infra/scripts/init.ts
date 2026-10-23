/// <reference lib="deno.ns" />
/**
 * `deno task init`: prepares a fresh clone for `deno task dev`. Creates `infra/envs/.env` from
 * `.env.example`, replaces every placeholder secret with a random one, and creates the web push
 * keys. Safe to run again: a value someone changed, and a file that exists, are never touched.
 *
 * Flags: `--name <name>` sets the project name, `--yes` takes the folder's name without asking.
 * Both apply only when the env file is created.
 *
 * @module
 */
import { encodeHex } from "@std/encoding/hex"
import { basename } from "@std/path"
import { generateVapidKeyPair } from "@spy4x/integrations/push"
import { parseEnvValues } from "./env-file.ts"

const EXAMPLE_PATH = `infra/envs/.env.example`
const ENV_PATH = `infra/envs/.env`
const VAPID_PATH = `infra/configs/vapid.json`

/** The secrets `.env.example` gives a placeholder, and how many random bytes each one gets. */
export const SECRETS: Record<string, number> = {
  KV_PASSWORD: 24,
  // The file store's key and Garage's RPC secret (docs/files.md): Garage takes a key id of GK and
  // 24 hex characters, and 64 hex characters for each secret.
  S3_ACCESS_KEY_ID: 12,
  S3_SECRET_ACCESS_KEY: 32,
  GARAGE_RPC_SECRET: 32,
  GRAFANA_PASS: 24,
  AUTH_COOKIE_SECRET: 32,
  AUTH_PEPPER: 32,
  // The API takes 8 to 50 characters: 20 bytes are 40 hex characters.
  SEED_PASSWORD: 20,
}

/** What goes before the random part of a secret, for the ones whose form is fixed. */
export const SECRET_PREFIXES: Record<string, string> = { S3_ACCESS_KEY_ID: `GK` }

/** Hex, as `openssl rand -hex` makes it: no character a shell or a flag parser reads specially. */
export const randomHex = (bytes: number) => encodeHex(crypto.getRandomValues(new Uint8Array(bytes)))

/**
 * A Compose project name from what a person typed: lower case, letters, digits and hyphens.
 * @throws {Error} When nothing usable is left.
 */
export function projectSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, `-`).replace(/^-+|-+$/g, ``)
  if (slug === ``) throw new Error(`"${name}" has no letter or digit to name the project with`)
  return slug
}

/**
 * Replaces `old`, the value `key` holds, with `value` on the last line that sets `key`: the one
 * Compose reads. The line is found by the parser's own rules (`export`, spaces around `=`), and
 * everything around the value (quotes, a trailing `# note`) stays as written.
 */
function setValue(text: string, key: string, old: string, value: string): string {
  const lines = text.split(`\n`)
  const at = lines.findLastIndex((line) => key in parseEnvValues(line, ENV_PATH))
  const eq = lines[at].indexOf(`=`)
  lines[at] = lines[at].slice(0, eq + 1) + lines[at].slice(eq + 1).replace(old, value)
  return lines.join(`\n`)
}

/** Keys whose new value does not reach data made with the old one. */
export const KEEPS_OLD_DATA: Record<string, string> = {
  AUTH_PEPPER:
    `accounts already in the local database cannot sign in; deno task db:reset starts clean`,
  GRAFANA_PASS: `Grafana keeps its old admin password until its volume is removed`,
}

/**
 * The env file `init` writes, and the keys it set. `current` is the existing `.env`, or
 * `undefined` when there is none: only then is `project` written. A secret is replaced only while
 * it still holds the example's placeholder.
 */
export function prepareEnv(
  example: string,
  current: string | undefined,
  project: string | undefined,
  random: (bytes: number) => string = randomHex,
): { text: string; changed: string[] } {
  const placeholders = parseEnvValues(example, EXAMPLE_PATH)
  let text = current ?? example
  const values = parseEnvValues(text, ENV_PATH)
  const changed: string[] = []
  if (current === undefined && project !== undefined) {
    text = setValue(text, `PROJECT`, values.PROJECT, project)
    changed.push(`PROJECT`)
  }
  for (const [key, bytes] of Object.entries(SECRETS)) {
    if (key in values && values[key] === placeholders[key]) {
      text = setValue(text, key, values[key], (SECRET_PREFIXES[key] ?? ``) + random(bytes))
      changed.push(key)
    }
  }
  return { text, changed }
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }
}

/**
 * The value of `--name`, `undefined` when the flag is absent.
 * @throws {Error} When the flag has no value after it.
 */
export function nameFlag(args: string[]): string | undefined {
  const at = args.indexOf(`--name`)
  if (at === -1) return undefined
  const name = args[at + 1]
  if (name === undefined || name.startsWith(`--`)) {
    throw new Error(`--name needs a value: --name "My Product"`)
  }
  return name
}

/**
 * Writes through a temporary file and a rename, so a crash never leaves the file cut short. An
 * existing file keeps its mode; `mode` is for a new file. A symlink is replaced by a regular file,
 * since its target may lie outside what the task may write.
 */
export async function writeSafely(path: string, text: string, mode?: number): Promise<void> {
  const temporary = `${path}.tmp`
  // `stat` follows a link, so its replacement takes the target's mode, never the link's 0777.
  const keep = (await Deno.stat(path).catch(() => undefined))?.mode
  const wanted = keep == null ? mode : keep & 0o777
  // Deno sets this mode as given, past the umask and on a temporary file left by a crash too.
  await Deno.writeTextFile(temporary, text, wanted === undefined ? {} : { mode: wanted })
  await Deno.rename(temporary, path)
}

/** The project name: the flag, else the folder's name, asked first on a terminal. */
function askProject(flag: string | undefined, yes: boolean): string {
  if (flag !== undefined) return projectSlug(flag)
  const folder = projectSlug(basename(Deno.cwd()))
  if (yes || !Deno.stdin.isTerminal()) return folder
  return projectSlug(prompt(`Project name:`, folder) ?? folder)
}

if (import.meta.main) {
  let name
  try {
    name = nameFlag(Deno.args)
  } catch (error) {
    console.error((error as Error).message)
    Deno.exit(1)
  }
  const current = await readIfExists(ENV_PATH)
  const project = current === undefined ? askProject(name, Deno.args.includes(`--yes`)) : undefined
  const { text, changed } = prepareEnv(await Deno.readTextFile(EXAMPLE_PATH), current, project)

  if (current === undefined) console.log(`Created ${ENV_PATH}`)
  if (changed.length > 0) {
    await writeSafely(ENV_PATH, text)
    console.log(`Set ${changed.join(`, `)} in ${ENV_PATH}`)
  }
  if (current !== undefined) {
    for (const key of changed) {
      if (key in KEEPS_OLD_DATA) console.warn(`Note: ${key} is new, so ${KEEPS_OLD_DATA[key]}.`)
    }
  }

  if (await readIfExists(VAPID_PATH) === undefined) {
    // The private key: readable by its owner only, as deploy.ts writes it on the server.
    const keys = JSON.stringify((await generateVapidKeyPair()).keys)
    await writeSafely(VAPID_PATH, keys, 0o600)
    console.log(`Created the web push keys in ${VAPID_PATH}`)
  }

  const env = parseEnvValues(text, ENV_PATH)
  console.log(`\nReady. Run: deno task dev\nThen open http://${env.DOMAIN}`)
}
