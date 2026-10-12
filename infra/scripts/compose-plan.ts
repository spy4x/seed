import { type ContainerProvider, containerProvider } from "./proxy-network.ts"

/** What one run of `deno task compose` does, decided from the env file and the arguments. */
export interface ComposePlan {
  /** The engine every command of the run goes to. */
  engine: ContainerProvider
  /** Whether to create the shared `proxy` network first, when it is missing. */
  ensureProxyNetwork: boolean
  /** The build of the base image the other images start from, when the run builds anything. */
  buildBase?: string[]
  /** The Compose command itself. */
  command: string[]
}

/**
 * Plans `deno task compose <args>`. The engine is the one `CONTAINER_PROVIDER` names and Docker
 * without it, as everywhere else ({@link containerProvider}); `ENV` picks the second Compose file.
 */
export function planCompose(
  envVars: Record<string, string>,
  args: string[],
  envFilePath: string,
): ComposePlan {
  const compose = [
    "compose",
    "-f",
    "./infra/compose/compose.shared.yml",
    "-f",
    `./infra/compose/compose.${envVars["ENV"]}.yml`,
    "--env-file",
    envFilePath,
  ]
  const up = args.includes("up")
  return {
    engine: containerProvider(envVars),
    ensureProxyNetwork: up,
    ...(up || args.includes("build") ? { buildBase: [...compose, "build", "deno-base"] } : {}),
    command: [...compose, ...args],
  }
}
