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
  /** The services this run keeps at no container, such as the SPA with `SPA=false`. */
  off: string[]
}

/**
 * Plans `deno task compose <args>`. The engine is the one `CONTAINER_PROVIDER` names and Docker
 * without it, as everywhere else ({@link containerProvider}); `ENV` picks the second Compose file.
 *
 * `SPA=false` keeps the SPA off: every `up` scales it to no container, which also stops and removes
 * one that runs, so Traefik has no router for its host. Scaling, not a profile, so a hand-typed
 * `docker compose up` and every product that never sets `SPA` start the SPA as before.
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
  const off = envVars["SPA"] === "false" ? ["spa"] : []
  const scale = up ? off.flatMap((service) => ["--scale", `${service}=0`]) : []
  const at = args.indexOf("up") + 1
  return {
    engine: containerProvider(envVars),
    ensureProxyNetwork: up,
    ...(up || args.includes("build") ? { buildBase: [...compose, "build", "deno-base"] } : {}),
    command: [...compose, ...args.slice(0, at), ...scale, ...args.slice(at)],
    off,
  }
}
