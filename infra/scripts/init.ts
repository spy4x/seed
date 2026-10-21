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
  GRAFANA_PASS: 24,
  AUTH_COOKIE_SECRET: 32,
  AUTH_PEPPER: 32,
  // The API takes 8 to 50 characters: 20 bytes are 40 hex characters.
  SEED_PASSWORD: 20,
}

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

/** Replaces the value of `key` on its own line; the rest of the file stays as written. */
function setValue(text: string, key: string, value: string): string {
  return text.replace(new RegExp(`^${key}=.*$`, `m`), `${key}=${value}`)
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
    text = setValue(text, `PROJECT`, project)
    changed.push(`PROJECT`)
  }
  for (const [key, bytes] of Object.entries(SECRETS)) {
    if (key in values && values[key] === placeholders[key]) {
      text = setValue(text, key, random(bytes))
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

/** The project name: the flag, else the folder's name, asked first on a terminal. */
function askProject(flag: string | undefined, yes: boolean): string {
  if (flag !== undefined) return projectSlug(flag)
  const folder = projectSlug(basename(Deno.cwd()))
  if (yes || !Deno.stdin.isTerminal()) return folder
  return projectSlug(prompt(`Project name:`, folder) ?? folder)
}

if (import.meta.main) {
  const args = Deno.args
  const nameAt = args.indexOf(`--name`)
  const name = nameAt === -1 ? undefined : args[nameAt + 1]
  const current = await readIfExists(ENV_PATH)
  const project = current === undefined ? askProject(name, args.includes(`--yes`)) : undefined
  const { text, changed } = prepareEnv(await Deno.readTextFile(EXAMPLE_PATH), current, project)

  if (current === undefined) console.log(`Created ${ENV_PATH}`)
  if (changed.length > 0) {
    await Deno.writeTextFile(ENV_PATH, text)
    console.log(`Set ${changed.join(`, `)} in ${ENV_PATH}`)
  }

  if (await readIfExists(VAPID_PATH) === undefined) {
    await Deno.writeTextFile(VAPID_PATH, JSON.stringify((await generateVapidKeyPair()).keys))
    console.log(`Created the web push keys in ${VAPID_PATH}`)
  }

  const env = parseEnvValues(text, ENV_PATH)
  console.log(`\nReady. Run: deno task dev\nThen open http://${env.DOMAIN}`)
}
