/// <reference lib="deno.ns" />
/**
 * `deno task init`: prepares a fresh clone for `deno task dev`. Checks first that the container
 * engine is installed and running. Creates `infra/envs/.env` from `.env.example`, replaces every
 * placeholder secret with a random one, creates the web push keys, and records the Seed commit the
 * copy came from in `.seed/commit` (docs/products.md). Ends with the next command and the
 * addresses. Safe to run again: a value someone changed, and a file that exists, are never touched.
 *
 * Flags: `--name <name>` sets the project name, `--yes` takes the folder's name without asking.
 * Both apply only when the env file is created.
 *
 * @module
 */
import { encodeHex } from "@std/encoding/hex"
import { basename, dirname } from "@std/path"
import { generateVapidKeyPair } from "@spy4x/integrations/push"
import { type RunCommandResult, runCommand } from "@spy4x/platform/server"
import { parseEnvValues } from "./env-file.ts"
import { type ContainerProvider, containerProvider } from "./proxy-network.ts"

const EXAMPLE_PATH = `infra/envs/.env.example`
const ENV_PATH = `infra/envs/.env`
const VAPID_PATH = `infra/configs/vapid.json`
const SEED_COMMIT_PATH = `.seed/commit`

/** Seed's repository, where a product takes its later changes from (docs/products.md). */
export const SEED_REPOSITORY = `https://github.com/spy4x/seed`

/** The published Get started guide, which the last lines point at. */
const GET_STARTED_URL = `https://seedsaas.com/docs/get-started`

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
  // The errors profile's GlitchTip (docs/stack.md, "Error tracking"). The example leaves them
  // empty, so a server without the profile need not set them; init fills them all the same.
  GLITCHTIP_DB_PASS: 24,
  GLITCHTIP_SECRET_KEY: 32,
  GLITCHTIP_ADMIN_PASSWORD: 20,
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
export function setValue(text: string, key: string, old: string, value: string): string {
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

/** Runs a command and returns its result; `error` is set when the program could not start. */
export type Run = (command: string[]) => Promise<RunCommandResult>

/** Where to get each container engine. */
const INSTALL_URLS: Record<string, string> = {
  docker: `https://docs.docker.com/get-started/get-docker/`,
  podman: `https://podman.io/docs/installation`,
}

/**
 * Why `provider` cannot run the stack, in words that say what to install or start, or `undefined`
 * when `<provider> info` answers, which it does only with the engine installed and running.
 */
export async function engineProblem(provider: string, run: Run): Promise<string | undefined> {
  const result = await run([provider, `info`])
  if (result.error !== undefined) {
    return `${provider} is not installed. Install it from ${INSTALL_URLS[provider]}, ` +
      `then run deno task init again.`
  }
  if (result.code !== 0) {
    const start = provider === `docker`
      ? `Start Docker Desktop, or on Linux run: sudo systemctl start docker`
      : `Start it, on macOS and Windows with: podman machine start`
    return `${provider} is installed but not running. ${start}. Then run deno task init again.`
  }
  return undefined
}

/**
 * The engine to run the stack on, and why it cannot run when it cannot. A fresh clone has no env
 * file to name one yet, so it takes Podman when Docker does not answer and Podman does.
 */
export async function chooseEngine(
  current: string | undefined,
  run: Run,
): Promise<{ engine: ContainerProvider; problem?: string }> {
  const engine = containerProvider(parseEnvValues(current ?? ``, ENV_PATH))
  const problem = await engineProblem(engine, run)
  if (problem === undefined || current !== undefined) return { engine, problem }
  if (await engineProblem(`podman`, run) === undefined) return { engine: `podman` }
  return { engine, problem }
}

/** The new env file's text, set to Podman when that is the engine found. */
export function withEngine(text: string, engine: ContainerProvider): string {
  if (engine === `docker`) return text
  return text.replace(/^CONTAINER_PROVIDER=docker\b/m, `CONTAINER_PROVIDER=podman`)
}

/**
 * The Seed commit a fresh copy came from: Seed's current `main`, which is what a copy made today
 * holds. `note` says why there is none: in Seed itself, without git, or offline.
 */
export async function seedCommit(run: Run): Promise<{ commit?: string; note?: string }> {
  const origin = await run([`git`, `remote`, `get-url`, `origin`])
  if (origin.error !== undefined) {
    return { note: `git is not installed, so ${SEED_COMMIT_PATH} is not written.` }
  }
  if (/github\.com[:/]spy4x\/seed(?:\.git)?\/?$/i.test(origin.stdout.trim())) {
    return { note: `This is a clone of Seed itself, so ${SEED_COMMIT_PATH} is not written.` }
  }
  const remote = await run([`git`, `ls-remote`, SEED_REPOSITORY, `refs/heads/main`])
  const commit = /^[0-9a-f]{40}\b/.exec(remote.stdout)?.[0]
  if (commit === undefined) {
    return {
      note: `Could not reach ${SEED_REPOSITORY}, so ${SEED_COMMIT_PATH} is not written. ` +
        `Run deno task init again when online.`,
    }
  }
  return { commit }
}

/**
 * Writes the Seed commit to `path` unless the file exists, which is never touched or read. Returns
 * what to tell the person, or `undefined` when the file was there already.
 */
export async function recordSeedCommit(path: string, run: Run): Promise<string | undefined> {
  if (await Deno.lstat(path).then(() => true, () => false)) return undefined
  const { commit, note } = await seedCommit(run)
  if (commit === undefined) return note
  await Deno.mkdir(dirname(path), { recursive: true })
  await writeSafely(path, `${commit}\n`)
  return `Recorded Seed's commit ${commit.slice(0, 7)} in ${path}`
}

/** The last lines: the next command, and where each app the env file turns on opens. */
export function nextSteps(env: Record<string, string>): string {
  const profiles = (env.COMPOSE_PROFILES ?? ``).split(`,`).map((profile) => profile.trim())
  const opens: [string, string][] = []
  if (env.SPA !== `false`) opens.push([`http://${env.DOMAIN}`, `the product`])
  if (profiles.includes(`admin`) && env.ADMIN_DOMAIN) {
    opens.push([`http://${env.ADMIN_DOMAIN}`, `the admin app`])
  }
  if (profiles.includes(`mpa`) && env.MPA_DOMAIN) {
    opens.push([`http://${env.MPA_DOMAIN}`, `the website`])
  }
  if (profiles.includes(`monitoring`)) {
    const port = (env.GRAFANA_HOST_PORT ?? `3000`).split(`:`).at(-1)
    opens.push([`http://localhost:${port}`, `Grafana`])
  }
  const width = Math.max(...opens.map(([url]) => url.length))
  return [
    `Ready. Start it with:`,
    ``,
    `  deno task dev`,
    ``,
    `Then open:`,
    ...opens.map(([url, what]) => `  ${url.padEnd(width)}  ${what}`),
    ``,
    `More: ${GET_STARTED_URL}`,
  ].join(`\n`)
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
  const { engine, problem } = await chooseEngine(current, runCommand)
  if (problem !== undefined) {
    console.error(problem)
    Deno.exit(1)
  }
  const project = current === undefined ? askProject(name, Deno.args.includes(`--yes`)) : undefined
  const prepared = prepareEnv(await Deno.readTextFile(EXAMPLE_PATH), current, project)
  const text = current === undefined ? withEngine(prepared.text, engine) : prepared.text
  const { changed } = prepared

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

  const recorded = await recordSeedCommit(SEED_COMMIT_PATH, runCommand)
  if (recorded !== undefined) console.log(recorded)

  console.log(`\n${nextSteps(parseEnvValues(text, ENV_PATH))}`)
}
