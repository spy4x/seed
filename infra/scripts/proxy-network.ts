/// <reference lib="deno.ns" />
import { runCommand } from "@spy4x/platform/server"

/** Name of the Docker network that Traefik and every stack's routed services share. */
export const PROXY_NETWORK = `proxy`

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

if (import.meta.main) {
  const { readEnvFile } = await import(`./env-file.ts`)
  const envVars = await readEnvFile(`./infra/envs/.env`)
  const provider = envVars[`CONTAINER_PROVIDER`] === `podman` ? `podman` : `docker`
  if (await ensureProxyNetwork(provider, runContainerCli)) {
    console.log(`Created the ${PROXY_NETWORK} network`)
  }
}
