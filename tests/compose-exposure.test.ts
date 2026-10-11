/// <reference lib="deno.ns" />
/**
 * Holds the Compose files to what may be reached from outside the machine
 * (spy4x/template#353): the proxy serves no dashboard or API of its own, the MinIO console and
 * Grafana have no router and are published on this machine only, as Postgres and Valkey are, Valkey
 * needs its password, the API's router drops a forged `CF-Connecting-IP` header, and in production
 * plain HTTP redirects to HTTPS.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

interface ComposeService {
  command?: string[]
  environment?: string[]
  labels?: string[]
  ports?: string[]
}

async function services(name: string): Promise<Record<string, ComposeService>> {
  const file = fromFileUrl(new URL(`../infra/compose/compose.${name}.yml`, import.meta.url))
  const compose = parse(await Deno.readTextFile(file)) as {
    services?: Record<string, ComposeService>
  }
  if (!compose.services) throw new Error(`${file} has no services`)
  return compose.services
}

function label(service: ComposeService | undefined, key: string): string | undefined {
  const prefix = `${key}=`
  return service?.labels?.find((entry) => entry.startsWith(prefix))?.slice(prefix.length)
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
  Deno.test(`the MinIO console and Grafana have no router in compose.${file}.yml`, async () => {
    const all = await services(file)
    for (const name of ["minio", "grafana"]) {
      expect(
        (all[name]?.labels ?? []).filter((entry) => entry.startsWith("traefik.")),
        name,
      ).toEqual([])
    }
  })
}

Deno.test("the MinIO console and Grafana are published on this machine only by default", async () => {
  const { minio, grafana } = await services("shared")
  expect(minio.ports).toEqual(["${MINIO_CONSOLE_HOST_PORT:-127.0.0.1:9001}:9001"])
  expect(grafana.ports).toEqual(["${GRAFANA_HOST_PORT:-127.0.0.1:3000}:3000"])
  for (const file of ["dev", "prod"]) {
    const all = await services(file)
    for (const name of ["minio", "grafana"]) {
      expect(all[name]?.ports, `compose.${file}.yml publishes ${name} nowhere else`).toBeUndefined()
    }
  }
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
  const password = kv.environment?.find((entry) => entry.startsWith("KV_PASSWORD="))
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
