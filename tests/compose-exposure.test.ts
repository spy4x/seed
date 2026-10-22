/// <reference lib="deno.ns" />
/**
 * Holds the Compose files to what may be reached from outside the machine
 * (spy4x/template#353): the proxy serves no dashboard or API of its own, Grafana has no router
 * and is published on this machine only, as Postgres and Valkey are, Valkey
 * needs its password, the API's router drops a forged `CF-Connecting-IP` header, and in production
 * plain HTTP redirects to HTTPS.
 *
 * It also holds what lets two projects share one host (spy4x/template#354): every published port
 * can be moved through a variable, every container and built image is named after the project,
 * no network claims a fixed subnet, and a container on the shared `proxy` network reaches its own
 * project's services by their container names.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

interface ComposeService {
  build?: { args?: string[] }
  container_name?: string
  image?: string
  command?: string[]
  environment?: string[] | Record<string, string>
  labels?: string[]
  networks?: string[]
  ports?: string[]
  user?: string
  depends_on?: Record<string, { condition?: string }>
  healthcheck?: { test?: string[] }
}

interface ComposeFile {
  services?: Record<string, ComposeService>
  networks?: Record<string, Record<string, unknown> | null>
}

async function composeFile(name: string): Promise<ComposeFile> {
  const file = fromFileUrl(new URL(`../infra/compose/compose.${name}.yml`, import.meta.url))
  return parse(await Deno.readTextFile(file)) as ComposeFile
}

async function services(name: string): Promise<Record<string, ComposeService>> {
  const compose = await composeFile(name)
  if (!compose.services) throw new Error(`compose.${name}.yml has no services`)
  return compose.services
}

function label(service: ComposeService | undefined, key: string): string | undefined {
  const prefix = `${key}=`
  return service?.labels?.find((entry) => entry.startsWith(prefix))?.slice(prefix.length)
}

/** A service's environment as `NAME=value` entries, whichever of Compose's two forms it is in. */
function environment(service: ComposeService | undefined): string[] {
  const entries = service?.environment ?? []
  return Array.isArray(entries)
    ? entries
    : Object.entries(entries).map(([name, value]) => `${name}=${value}`)
}

/** The names of the routers a service's labels define. */
function routers(service: ComposeService | undefined): string[] {
  const names = (service?.labels ?? []).flatMap((entry) =>
    entry.match(/^traefik\.http\.routers\.([^.]+)\./)?.[1] ?? []
  )
  return [...new Set(names)]
}

Deno.test("the proxy's only router is the health ping: none serves its dashboard or API", async () => {
  const { traefik } = await services("proxy")
  expect(routers(traefik)).toEqual(["pingweb"])
  expect(label(traefik, "traefik.http.routers.pingweb.service")).toBe("ping@internal")
  expect(
    (traefik.labels ?? []).filter((entry) => entry.includes(".loadbalancer.")),
    "no route to the proxy's own port 8080",
  ).toEqual([])
})

Deno.test("the proxy does not turn on Traefik's unauthenticated API", async () => {
  const { traefik } = await services("proxy")
  if (!traefik.command?.length) throw new Error("the proxy has no command to check")
  expect(traefik.command.filter((flag) => flag.startsWith("--api"))).toEqual([])
  expect(traefik.ports, "only the two web ports are published").toEqual(["443:443", "80:80"])
})

for (const file of ["shared", "dev", "prod"]) {
  Deno.test(`Grafana has no router in compose.${file}.yml`, async () => {
    const all = await services(file)
    expect((all.grafana?.labels ?? []).filter((entry) => entry.startsWith("traefik."))).toEqual([])
  })
}

Deno.test("Grafana is published on this machine only by default", async () => {
  const { grafana } = await services("shared")
  expect(grafana.ports).toEqual(["${GRAFANA_HOST_PORT:-127.0.0.1:3000}:3000"])
  for (const file of ["dev", "prod"]) {
    const all = await services(file)
    expect(all.grafana?.ports, `compose.${file}.yml publishes Grafana nowhere else`)
      .toBeUndefined()
  }
})

// Everything that watches the project. A person opens Grafana only, on this machine's own address
// (the test above); none of them is the reverse proxy's to serve.
const MONITORING = [
  "vmagent",
  "vector",
  "socket-proxy",
  "postgres-prometheus-exporter",
  "victoriametrics",
  "victorialogs",
  "vmalert",
  "alertmanager",
  "grafana",
  "nodeexporter",
  "cadvisor",
]

Deno.test("no monitoring service joins the proxy network, has a Traefik label or is given a public address", async () => {
  const reachable: string[] = []
  let checked = 0
  for (const file of ["shared", "dev", "prod"]) {
    const all = await services(file)
    for (const name of MONITORING) {
      const service = all[name]
      if (!service) continue
      checked++
      if (service.networks?.includes("proxy")) reachable.push(`${file}: ${name} is on proxy`)
      for (const entry of service.labels ?? []) {
        if (entry.startsWith("traefik.")) reachable.push(`${file}: ${name} has ${entry}`)
      }
      for (const entry of environment(service)) {
        // A host under the product's domain, or Grafana's own setting for its public address.
        if (/DOMAIN\b/.test(entry) || /^GF_SERVER_(ROOT_URL|DOMAIN)=/.test(entry)) {
          reachable.push(`${file}: ${name} is told ${entry}`)
        }
      }
    }
  }
  expect(reachable).toEqual([])
  expect(checked).toBeGreaterThanOrEqual(MONITORING.length)
})

Deno.test("Postgres and Valkey are published on this machine only by default", async () => {
  const { db, kv } = await services("shared")
  expect(db.ports).toEqual(["${DB_HOST_PORT:-127.0.0.1:${DB_PORT}}:5432"])
  expect(kv.ports).toEqual(["${KV_HOST_PORT:-127.0.0.1:${KV_PORT}}:6379"])
  for (const file of ["dev", "prod"]) {
    const all = await services(file)
    expect(all.db?.ports, `compose.${file}.yml publishes Postgres nowhere else`).toBeUndefined()
    expect(all.kv?.ports, `compose.${file}.yml publishes Valkey nowhere else`).toBeUndefined()
  }
})

Deno.test("Valkey does not start without a password and asks for it on every connection", async () => {
  const { kv } = await services("shared")
  const password = environment(kv).find((entry) => entry.startsWith("KV_PASSWORD="))
  expect(password).toMatch(/^KV_PASSWORD=\$\{KV_PASSWORD:\?[^}]+\}$/)
  expect(kv.command?.join(" ")).toContain('--requirepass "$$KV_PASSWORD"')
})

Deno.test("the API's router drops a client's CF-Connecting-IP header, in production too", async () => {
  const middleware = "strip-cf-ip-${PROJECT}"
  const header =
    `traefik.http.middlewares.${middleware}.headers.customrequestheaders.CF-Connecting-IP`
  const shared = (await services("shared")).api
  expect(label(shared, header), "an empty value removes the header").toBe("")
  for (const api of [shared, (await services("prod")).api]) {
    expect(label(api, "traefik.http.routers.api-${PROJECT}.middlewares")).toBe(middleware)
  }
})

Deno.test("in production plain HTTP for the SPA's and the MPA's hosts redirects to HTTPS for good", async () => {
  const { spa, mpa } = await services("prod")
  const middleware = "https-redirect-${PROJECT}"
  expect(label(spa, `traefik.http.middlewares.${middleware}.redirectscheme.scheme`)).toBe("https")
  expect(label(spa, `traefik.http.middlewares.${middleware}.redirectscheme.permanent`)).toBe("true")
  const hosts: [ComposeService, string, string][] = [
    [spa, "http-${PROJECT}", "Host(`${DOMAIN}`)"],
    [mpa, "http-mpa-${PROJECT}", "Host(`${MPA_DOMAIN:-}`)"],
  ]
  for (const [service, name, rule] of hosts) {
    const router = `traefik.http.routers.${name}`
    expect(label(service, `${router}.rule`)).toBe(rule)
    expect(label(service, `${router}.entrypoints`)).toBe("web")
    expect(label(service, `${router}.middlewares`)).toBe(middleware)
  }
})

Deno.test("every port a project publishes is on this machine by default and moves with a variable", async () => {
  const variables: string[] = []
  for (const file of ["shared", "dev", "prod"]) {
    for (const [name, service] of Object.entries(await services(file))) {
      for (const port of service.ports ?? []) {
        // `${NAME_HOST_PORT:-127.0.0.1:<port>}:<container port>`; the default may hold a variable.
        const match = port.match(
          /^\$\{([A-Z_]+_HOST_PORT):-127\.0\.0\.1:(\d+|\$\{[A-Z_]+\})\}:\d+$/,
        )
        expect({ file, name, port, movable: match !== null })
          .toEqual({ file, name, port, movable: true })
        variables.push(match![1])
      }
    }
  }
  // infra/scripts/deploy.test.ts holds these three names to infra/envs/.env.example.
  expect(variables.sort()).toEqual(
    ["DB_HOST_PORT", "GRAFANA_HOST_PORT", "KV_HOST_PORT"],
  )
})

Deno.test("no project network claims a fixed subnet, so a second project gets a free one", async () => {
  for (const file of ["shared", "dev", "prod"]) {
    const networks = (await composeFile(file)).networks ?? {}
    for (const [name, network] of Object.entries(networks)) {
      expect({ file, name, ipam: network?.ipam }).toEqual({ file, name, ipam: undefined })
    }
    // Only the proxy's network has one name for every project, and the engine owns its addresses.
    // The one other network is Vector's way to the Docker socket proxy, named after the project.
    expect(Object.keys(networks).filter((name) => name !== "proxy"))
      .toEqual(file === "shared" ? ["docker-socket"] : [])
    expect(networks.proxy).toEqual({ external: true })
  }
})

Deno.test("every container and every image a project builds is named after the project", async () => {
  const all = await services("shared")
  const base = "${PROJECT}/deno-base:${DENO_VERSION}"
  for (const [name, service] of Object.entries(all)) {
    expect({ name, container: service.container_name })
      .toEqual({ name, container: `\${PROJECT}-${name}` })
    if (!service.build) continue
    // The database and backup images start from Postgres instead: the test below holds them to it.
    if (name === "db" || name === "backup") continue
    // The base image is the one built image with a name; every other build starts from it.
    if (name === "deno-base") expect(service.image).toBe(base)
    else {expect({ name, args: service.build.args }).toEqual({
        name,
        args: expect.arrayContaining([`BASE_IMAGE=${base}`]),
      })}
  }
  for (const file of ["dev", "prod"]) {
    for (const [name, service] of Object.entries(await services(file))) {
      expect({ file, name, container: service.container_name, image: service.image })
        .toEqual({ file, name, container: undefined, image: undefined })
    }
  }
})

Deno.test("the backup image is built on the database's own Postgres image", async () => {
  // pg_dump refuses a server newer than itself, so the two must move together.
  const { db, backup } = await services("shared")
  expect(db.build?.args).toEqual([
    expect.stringMatching(/^POSTGRES_IMAGE=docker\.io\/library\/postgres:\d/),
  ])
  expect(backup.build?.args).toEqual(db.build?.args)
})

Deno.test("PgBouncer publishes no port and is on the project's own network only", async () => {
  for (const file of ["shared", "dev", "prod"]) {
    const pgbouncer = (await services(file)).pgbouncer
    if (file === "shared" && !pgbouncer) throw new Error("compose.shared.yml has no pgbouncer")
    expect({ file, ports: pgbouncer?.ports }).toEqual({ file, ports: undefined })
    expect({ file, networks: pgbouncer?.networks ?? ["default"] })
      .toEqual({ file, networks: ["default"] })
    expect((pgbouncer?.labels ?? []).filter((entry) => entry.startsWith("traefik."))).toEqual([])
  }
})

Deno.test("PgBouncer runs as its image's unprivileged user, from an image pinned by version and digest", async () => {
  const { pgbouncer } = await services("shared")
  expect(pgbouncer.user).toBe("70:70")
  expect(pgbouncer.image).toMatch(
    /^docker\.io\/edoburu\/pgbouncer:v\d+\.\d+\.\d+-p\d+@sha256:[0-9a-f]{64}$/,
  )
  // postgres.js prepares statements by name; under transaction pooling PgBouncer must track them.
  expect(environment(pgbouncer)).toEqual(
    expect.arrayContaining(["POOL_MODE=transaction", "MAX_PREPARED_STATEMENTS=200"]),
  )
})

Deno.test("the API and the worker query through PgBouncer and start once it is healthy", async () => {
  const all = await services("shared")
  expect(all.pgbouncer?.healthcheck?.test?.[0]).toBe("CMD")
  const hosts = { api: "DB_HOST=${PROJECT}-pgbouncer", worker: "DB_HOST=pgbouncer" }
  for (const [name, host] of Object.entries(hosts)) {
    const entries = environment(all[name])
    expect({ name, hosts: entries.filter((entry) => entry.startsWith("DB_HOST=")) })
      .toEqual({ name, hosts: [host] })
    expect({ name, pgbouncer: all[name]?.depends_on?.pgbouncer })
      .toEqual({ name, pgbouncer: { condition: "service_healthy" } })
  }
})

Deno.test("migrate, and the API's direct connection for LISTEN, are given Postgres itself, not PgBouncer", async () => {
  const all = await services("shared")
  expect(environment(all.migrate).filter((entry) => entry.startsWith("DB_HOST="))).toEqual([
    "DB_HOST=db",
  ])
  // apps/api/services/db-direct.ts: the client `LISTEN` runs on reads these two.
  expect(environment(all.api)).toEqual(
    expect.arrayContaining(["DB_DIRECT_HOST=${PROJECT}-db", "DB_DIRECT_PORT=5432"]),
  )
  for (const file of ["dev", "prod"]) {
    for (const name of ["api", "worker", "migrate"]) {
      const overridden = environment((await services(file))[name])
        .filter((entry) => /^DB_(DIRECT_)?(HOST|PORT)=/.test(entry))
      expect({ file, name, overridden }).toEqual({ file, name, overridden: [] })
    }
  }
})

/**
 * The hosts a value names: what stands where a URL or a `host:port` pair has its host. A variable
 * (`${PROJECT}-api`) is kept whole, so a per-project name never reads as a plain one.
 */
function hostsIn(value: string): string[] {
  return value.replace(/\$\{[^}]*\}/g, "VARIABLE").split(/[^A-Za-z0-9._-]+/)
}

Deno.test("a container on the shared proxy network reaches no service by a name another project also has", async () => {
  const files = await Promise.all(["shared", "dev", "prod"].map(services))
  const names = new Set(files.flatMap((file) => Object.keys(file)))
  const onProxy = [...names].filter((name) =>
    files.some((file) => file[name]?.networks?.includes("proxy"))
  )
  expect(onProxy).toEqual(expect.arrayContaining(["api", "mpa", "spa"]))

  // Docker answers a plain service name from every network a container is on, so on `proxy` the
  // name `api` is the API of whichever project answers first. `${PROJECT}-api` is one container.
  const plain: string[] = []
  for (const name of onProxy) {
    for (const file of files) {
      for (const entry of environment(file[name])) {
        const value = entry.slice(entry.indexOf("=") + 1)
        if (hostsIn(value).some((host) => names.has(host))) plain.push(`${name}: ${entry}`)
      }
    }
  }
  expect(plain).toEqual([])

  const shared = files[0]
  expect(shared.mpa?.environment).toContain("API_URL=http://${PROJECT}-api:${API_PORT}")
  expect(shared.api?.environment).toContain("DB_HOST=${PROJECT}-pgbouncer")
  expect(shared.api?.environment).toContain("DB_DIRECT_HOST=${PROJECT}-db")
  expect(shared.api?.environment).toContain("KV_HOSTNAME=${PROJECT}-kv")
  for (const service of ["api", "db", "kv", "pgbouncer"]) {
    expect(shared[service]?.container_name).toBe(`\${PROJECT}-${service}`)
  }
})

Deno.test("the proxy logs at info unless the env file asks for another level", async () => {
  const { traefik } = await services("proxy")
  expect(traefik?.command).toContain("--log.level=${PROXY_LOG_LEVEL:-info}")
})
