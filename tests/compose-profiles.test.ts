/// <reference lib="deno.ns" />
/**
 * Holds `COMPOSE_PROFILES` to the three modes docs/stack.md's "Optional parts" table promises
 * (https://github.com/spy4x/seed/issues/987): with no profile only the must-haves start, the
 * `telemetry` profile adds the shippers and no monitoring backend, and `monitoring` adds both.
 * CI steps have no container engine, so this reads the YAML and applies Compose's rule itself: a
 * service without `profiles` always starts, one with them starts when any of them is on.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const DIR = fromFileUrl(new URL("../infra/compose/", import.meta.url))

/** The second files `ENV` and `APP_RUNTIME` add (`infra/scripts/compose-plan.ts`). */
const OVERRIDES = [
  [`compose.dev.yml`],
  [`compose.prod.yml`],
  [`compose.prod.yml`, `compose.runtime-node.yml`],
  [`compose.prod.yml`, `compose.runtime-bun.yml`],
]

const MUST_HAVES = [`api`, `db`, `kv`, `migrate`, `pgbouncer`, `spa`, `worker`]
const SHIPPERS = [`postgres-prometheus-exporter`, `socket-proxy`, `vector`, `vmagent`]
const BACKENDS = [`alertmanager`, `grafana`, `victorialogs`, `victoriametrics`, `vmalert`]
const HOST_EXPORTERS = [`cadvisor`, `nodeexporter`]

interface Service {
  profiles?: string[]
  depends_on?: string[] | Record<string, unknown>
}

async function read(file: string): Promise<Record<string, Service>> {
  const compose = parse(await Deno.readTextFile(`${DIR}${file}`)) as {
    services?: Record<string, Service>
  }
  if (!compose.services) throw new Error(`${file} has no services`)
  return compose.services
}

/** compose.shared.yml with the given files over it, merged per service as Compose does. */
async function stack(overrides: string[]): Promise<Record<string, Service>> {
  const merged = await read(`compose.shared.yml`)
  for (const file of overrides) {
    for (const [name, service] of Object.entries(await read(file))) {
      merged[name] = { ...merged[name], ...service }
    }
  }
  return merged
}

/** The services `docker compose up` starts with these profiles on, sorted. */
function started(services: Record<string, Service>, profiles: string[]): string[] {
  return Object.entries(services)
    .filter(([, service]) =>
      !service.profiles || service.profiles.some((p) => profiles.includes(p))
    )
    .map(([name]) => name)
    .sort()
}

function dependencies(service: Service): string[] {
  const dependsOn = service.depends_on ?? []
  return Array.isArray(dependsOn) ? dependsOn : Object.keys(dependsOn)
}

for (const overrides of OVERRIDES) {
  const files = overrides.join(` + `)

  Deno.test(`${files}: with no profile only the must-haves start`, async () => {
    expect(started(await stack(overrides), [])).toEqual(MUST_HAVES)
  })

  Deno.test(`${files}: no must-have waits for a service in a profile`, async () => {
    const services = await stack(overrides)
    let checked = 0
    for (const name of MUST_HAVES) {
      for (const dependency of dependencies(services[name])) {
        expect(services[dependency], `${name} depends on ${dependency}`).toBeDefined()
        expect(services[dependency].profiles, `${name} depends on ${dependency}`).toBeUndefined()
        checked++
      }
    }
    expect(checked).toBeGreaterThan(3)
  })
}

Deno.test("the telemetry profile starts the shippers and no monitoring backend", async () => {
  expect(started(await stack([`compose.prod.yml`]), [`telemetry`]))
    .toEqual([...MUST_HAVES, ...SHIPPERS].sort())
})

Deno.test("the monitoring profile starts the shippers and the backends", async () => {
  const services = await stack([`compose.prod.yml`])
  const bundled = [...MUST_HAVES, ...SHIPPERS, ...BACKENDS].sort()
  expect(started(services, [`monitoring`])).toEqual(bundled)
  expect(started(services, [`monitoring`, `telemetry`])).toEqual(bundled)
})

Deno.test("the host-monitoring profile starts the host exporters and no shipper", async () => {
  expect(started(await stack([`compose.prod.yml`]), [`host-monitoring`]))
    .toEqual([...MUST_HAVES, ...HOST_EXPORTERS].sort())
})

Deno.test("the errors profile starts GlitchTip and its database setup, and nothing else", async () => {
  expect(started(await stack([`compose.prod.yml`]), [`errors`]))
    .toEqual([...MUST_HAVES, `errors`, `errors-db`].sort())
})

Deno.test("a service in a profile reads no variable bare that no must-have reads", async () => {
  // Compose interpolates every service, started or not, and an unset `${X}` in a resource limit
  // stops the whole project. So a profiled service gives each of its own variables a default
  // (`${X:-1}`), and an env file without that part's lines still starts the must-haves.
  const text = await Deno.readTextFile(`${DIR}compose.shared.yml`)
  const services = parse(text) as { services: Record<string, Service> }
  const bare = (service: unknown) =>
    [...JSON.stringify(service).matchAll(/(?<!\$)\$\{([A-Z_]+)\}/g)].map((match) => match[1])
  // Compose sets COMPOSE_PROJECT_NAME itself.
  const needed = new Set([
    `COMPOSE_PROJECT_NAME`,
    ...MUST_HAVES.flatMap((name) => bare(services.services[name])),
  ])
  let checked = 0
  for (const [name, service] of Object.entries(services.services)) {
    if (!service.profiles) continue
    for (const variable of bare(service)) {
      expect(needed.has(variable), `${name} reads \${${variable}} without a default`).toBe(true)
    }
    checked++
  }
  expect(checked).toBeGreaterThan(10)
})
