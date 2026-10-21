/**
 * What `deno task compose up -d` decides before and after it starts the whole project, so a deploy
 * does not leave the product down. Three things went wrong on a live server, each with the API,
 * the SPA and the website left in `Created`:
 *
 * - a host port the project publishes was held by another project's container;
 * - an optional service (Grafana) could not start, and Compose had not started the product yet;
 * - the project's network had to be recreated, and the containers Compose only restarted came
 *   back on it without their service names (`db`, `kv`).
 *
 * Everything here is a pure function over what Compose prints; `compose.ts` asks the engine.
 * Every parser returns `undefined` for output it does not understand (another Compose version,
 * `podman-compose`), and the caller then carries on as it did before these checks existed.
 *
 * @module
 */

/**
 * The services that serve requests. `deno task compose up -d` starts these first (Compose adds
 * what they depend on), then the rest, so a monitoring container or a console that cannot start
 * never leaves these stopped. Every service that is not named here is optional; `mpa` and
 * `admin` are started only when their profile is on.
 */
export const PRODUCT_SERVICES: readonly string[] = [
  `db`,
  `kv`,
  `migrate`,
  `api`,
  `worker`,
  `spa`,
  `mpa`,
  `admin`,
]

/** The only flags a staged start understands; anything else runs as one command, as before. */
const STAGED_FLAGS = [`-d`, `--detach`, `--build`, `--remove-orphans`]

/**
 * Whether `args` start the whole project in the background: `up` with `-d`, no service named and
 * no flag but the ones a deploy and the `compose up -d` runs of `docs/backups.md` and
 * `docs/deploy.md` use. Only such a run is checked and staged.
 */
export function startsWholeProject(args: string[]): boolean {
  const [command, ...flags] = args
  return command === `up` && flags.every((flag) => STAGED_FLAGS.includes(flag)) &&
    flags.some((flag) => flag === `-d` || flag === `--detach`)
}

/** One TCP port a service publishes on the host. */
export interface PublishedPort {
  service: string
  /** The host address it binds; `0.0.0.0` when the Compose file names none. */
  hostIp: string
  port: number
  /** The env variable that sets it, when the Compose file takes the port from one. */
  variable?: string
}

/** The project as `compose config --format json` describes it, profiles applied. */
export interface ProjectModel {
  /** The services this run starts. */
  services: string[]
  ports: PublishedPort[]
}

/** Parses JSON, or gives `undefined` for anything that is not an object. */
function parseObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === `object` && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The variable behind each published port, from `compose config --no-interpolate --format json`,
 * where a port is still written as in the file: `${GRAFANA_HOST_PORT:-127.0.0.1:3000}:3000`.
 * Keyed by `<service>:<container port>`; the first variable of the entry is the one to change.
 */
function portVariables(rawConfigJson: string | undefined): Map<string, string> {
  const variables = new Map<string, string>()
  const services = parseObject(rawConfigJson)?.services
  if (typeof services !== `object` || services === null) return variables
  for (const [service, definition] of Object.entries(services)) {
    const ports: unknown = definition?.ports
    if (!Array.isArray(ports)) continue
    for (const entry of ports) {
      if (typeof entry !== `string`) continue
      const variable = /\$\{([A-Za-z_][A-Za-z0-9_]*)/.exec(entry)?.[1]
      const target = /:(\d+)(?:\/\w+)?$/.exec(entry)?.[1]
      if (variable && target) variables.set(`${service}:${target}`, variable)
    }
  }
  return variables
}

/**
 * Reads the services a run starts and the TCP ports they publish from
 * `compose config --format json`. `rawConfigJson` (the same with `--no-interpolate`) adds the
 * variable names and may be missing. A port range and a UDP port are left out: neither is probed.
 */
export function parseProject(
  configJson: string | undefined,
  rawConfigJson?: string,
): ProjectModel | undefined {
  const services = parseObject(configJson)?.services
  if (typeof services !== `object` || services === null) return undefined
  const variables = portVariables(rawConfigJson)
  const ports: PublishedPort[] = []
  for (const [service, definition] of Object.entries(services)) {
    const published: unknown = definition?.ports
    if (!Array.isArray(published)) continue
    for (const entry of published) {
      const port = Number(entry?.published)
      if (!Number.isInteger(port) || port <= 0 || (entry.protocol ?? `tcp`) !== `tcp`) continue
      const variable = variables.get(`${service}:${entry.target}`)
      ports.push({
        service,
        hostIp: entry.host_ip || `0.0.0.0`,
        port,
        ...(variable ? { variable } : {}),
      })
    }
  }
  return { services: Object.keys(services), ports }
}

/** One container of the project, from `compose ps -a --format json`. */
export interface ProjectContainer {
  service: string
  /** `running`, `created`, `exited`, `restarting` and so on. */
  state: string
  exitCode: number
  /** The host ports it publishes. */
  ports: number[]
}

/**
 * Parses `compose ps -a --format json`: one JSON object per line, or one array in older Compose
 * versions. An empty output is a project with no containers.
 */
export function parseContainers(psOutput: string | undefined): ProjectContainer[] | undefined {
  if (psOutput === undefined) return undefined
  const text = psOutput.trim()
  if (text === ``) return []
  try {
    const rows: unknown[] = text.startsWith(`[`)
      ? JSON.parse(text)
      : text.split(`\n`).map((line) => JSON.parse(line))
    // deno-lint-ignore no-explicit-any
    return rows.map((row: any) => {
      if (typeof row?.Service !== `string` || typeof row.State !== `string`) {
        throw new Error(`not a container`)
      }
      const publishers: unknown[] = Array.isArray(row.Publishers) ? row.Publishers : []
      return {
        service: row.Service,
        state: row.State,
        exitCode: Number(row.ExitCode ?? 0),
        // deno-lint-ignore no-explicit-any
        ports: publishers.map((publisher: any) => Number(publisher?.PublishedPort)).filter((
          port,
        ) => port > 0),
      }
    })
  } catch {
    return undefined
  }
}

/**
 * The published ports that this project's running containers do not hold already, so something
 * else must not hold them either. A port of a running container of the project is its own: the
 * start replaces that container and keeps the port.
 */
export function portsToProbe(
  ports: PublishedPort[],
  containers: ProjectContainer[],
): PublishedPort[] {
  const own = new Set(
    containers.filter((container) => container.state === `running`).flatMap((container) =>
      container.ports
    ),
  )
  return ports.filter(({ port }) => !own.has(port))
}

/** Why the start is refused when `taken` ports are in use by something outside the project. */
export function portRefusal(taken: PublishedPort[], envFilePath: string): string {
  return [
    `Refusing to start: something that is not this project already listens on a port it publishes.`,
    ...taken.map(({ service, hostIp, port, variable }) =>
      `- ${hostIp}:${port} (service ${service}): ` + (variable
        ? `set ${variable} to a free address, such as 127.0.0.1:<port>, in the env file ` +
          `you deploy (${envFilePath} on this machine).`
        : `free it, or change the port in the Compose file.`)
    ),
    `No container was created, stopped or started: what ran before still runs.`,
  ].join(`\n`)
}

/**
 * The networks Compose would remove and create again, read from `compose --dry-run up -d`
 * (`Network app_default Removing`). Compose does that when a network was made from another
 * definition than the files hold now, and then starts the containers it did not recreate without
 * their service names (seen on Compose 2.40.3 and 5.5.1). A network that only has to be created
 * (a fresh machine) is not listed.
 */
export function networksToRecreate(dryRunOutput: string): string[] {
  const names = [...dryRunOutput.matchAll(/\bNetwork\s+(\S+)\s+Remov(?:ing|ed)\b/g)].map((match) =>
    match[1]
  )
  return [...new Set(names)]
}

/**
 * The services of `started` that are not up after a start: no container, or one that is neither
 * running nor finished with exit code 0 (the one-shot `migrate`).
 */
export function servicesNotUp(started: string[], containers: ProjectContainer[]): string[] {
  return started.flatMap((service) => {
    const own = containers.filter((container) => container.service === service)
    if (own.length === 0) return [`${service} (no container)`]
    const down = own.find((container) =>
      container.state !== `running` && !(container.state === `exited` && container.exitCode === 0)
    )
    return down ? [`${service} (${down.state})`] : []
  })
}
