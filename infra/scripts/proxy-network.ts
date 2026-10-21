/// <reference lib="deno.ns" />
import { runCommand } from "@spy4x/platform/server"

/** Name of the Docker network that Traefik and every stack's routed services share. */
export const PROXY_NETWORK = `proxy`

/** The container engines the scripts can drive. */
export type ContainerProvider = `docker` | `podman`

/**
 * The engine an env file asks for in `CONTAINER_PROVIDER`: Docker when it is unset or empty. Every
 * script takes it from here, so the Compose step and the network step never pick different ones.
 *
 * @throws {Error} When the value names neither engine.
 */
export function containerProvider(envVars: Record<string, string>): ContainerProvider {
  const value = envVars[`CONTAINER_PROVIDER`] ?? ``
  if (value === `` || value === `docker`) return `docker`
  if (value === `podman`) return `podman`
  throw new Error(`CONTAINER_PROVIDER must be "docker" or "podman", not "${value}"`)
}

/** Runs `<provider> <args>` and returns its exit code. */
export type RunContainerCli = (provider: string, args: string[]) => Promise<number>

/**
 * Creates the external network when it is missing, so a fresh machine starts the stack with no extra
 * step. An existing network is never touched. Returns true when it created one.
 */
export async function ensureProxyNetwork(
  provider: string,
  run: RunContainerCli,
  network: string = PROXY_NETWORK,
): Promise<boolean> {
  if (await run(provider, [`network`, `inspect`, network]) === 0) {
    return false
  }
  const code = await run(provider, [`network`, `create`, network])
  if (code !== 0) {
    throw new Error(`Could not create the ${network} network: ${provider} exited with ${code}`)
  }
  return true
}

/**
 * Runs the container CLI with its output hidden and returns its exit code.
 * @throws {Error} When the CLI could not be started (not installed, or not allowed to run).
 */
export const runContainerCli: RunContainerCli = async (provider, args) => {
  const result = await runCommand([provider, ...args])
  if (result.error !== undefined) throw new Error(`Could not run ${provider}: ${result.error}`)
  return result.code
}

/** The command `proxy:start` runs; Docker even under Podman, as docs/development.md says. */
export const PROXY_UP = [
  `docker`,
  `compose`,
  `-f`,
  `./infra/compose/compose.proxy.yml`,
  `--env-file`,
  `./infra/envs/.env`,
  `up`,
  `-d`,
]

/** What `startProxy` did: found Traefik running, started it, or left it to `proxy:start`. */
export type ProxyStart = `running` | `started` | `manual`

/**
 * Starts the project's Traefik for `deno task dev` unless a container named `traefik` already
 * runs, which may be another project's or a shared one: it is left alone. Under Podman it starts
 * nothing, since `proxy:start` calls Docker.
 *
 * @throws {Error} When the start fails, with what the engine printed.
 */
export async function startProxy(
  provider: ContainerProvider,
  run: (command: string[]) => Promise<{ code: number; stdout: string; stderr: string }>,
): Promise<ProxyStart> {
  const state = await run([provider, `container`, `inspect`, `-f`, `{{.State.Running}}`, `traefik`])
  if (state.code === 0 && state.stdout.trim() === `true`) return `running`
  if (provider === `podman`) return `manual`
  const up = await run(PROXY_UP)
  if (up.code !== 0) throw new Error(`Could not start Traefik:\n${up.stderr.trim()}`)
  return `started`
}

if (import.meta.main) {
  const { readEnvFile } = await import(`./env-file.ts`)
  const envVars = await readEnvFile(`./infra/envs/.env`).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error
    console.error(`infra/envs/.env is missing. Run: deno task init`)
    Deno.exit(1)
  })
  const provider = containerProvider(envVars)
  if (await ensureProxyNetwork(provider, runContainerCli)) {
    console.log(`Created the ${PROXY_NETWORK} network`)
  }
  // `--start` is `deno task dev`'s first step.
  if (Deno.args.includes(`--start`)) {
    const result = await startProxy(provider, (command) => runCommand(command))
    if (result === `started`) console.log(`Started Traefik`)
    if (result === `manual`) console.log(`Traefik is not running: start it with deno task proxy:start`)
  }
}
