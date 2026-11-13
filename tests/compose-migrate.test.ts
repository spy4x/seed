/// <reference lib="deno.ns" />
/**
 * Holds `infra/compose/compose.shared.yml` to the deploy's migration order: the one-shot `migrate`
 * service applies pending migrations, and every other service built from the API's Dockerfile
 * (the API, the worker) starts only after it exits with 0. Without that order a deploy with a new
 * migration serves traffic on the old schema (spy4x/template#113). It also holds every
 * long-running service to a restart policy, so a reboot brings it back. Only this file is read: an
 * override file that changes these services with `!reset` or `!override` is not covered.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE = fromFileUrl(new URL("../infra/compose/compose.shared.yml", import.meta.url))
const APP_DOCKERFILE = "apps/api/dockerfile"

interface ComposeService {
  healthcheck?: { test?: string[] }
  build?: { dockerfile?: string }
  command?: string[]
  restart?: string
  profiles?: string[]
  depends_on?: Record<string, { condition?: string }>
}

async function services(): Promise<Record<string, ComposeService>> {
  const compose = parse(await Deno.readTextFile(COMPOSE)) as {
    services?: Record<string, ComposeService>
  }
  if (!compose.services) throw new Error(`${COMPOSE} has no services`)
  return compose.services
}

Deno.test("the migrate service applies migrations once, after the database is healthy", async () => {
  const migrate = (await services()).migrate
  expect(migrate?.command).toEqual(["deno", "task", "db:migrate"])
  expect(migrate?.restart).toBe("no")
  expect(migrate?.depends_on?.db?.condition).toBe("service_healthy")
})

Deno.test("every app service starts only after the migrations succeed", async () => {
  const apps = Object.entries(await services()).filter(([name, service]) =>
    name !== "migrate" && service.build?.dockerfile === APP_DOCKERFILE
  )
  expect(apps.map(([name]) => name).sort()).toEqual(["api", "worker"])
  for (const [name, service] of apps) {
    expect({ name, condition: service.depends_on?.migrate?.condition }).toEqual({
      name,
      condition: "service_completed_successfully",
    })
  }
})

Deno.test("the database counts as healthy only once it accepts TCP connections", async () => {
  // Without -h, pg_isready asks initdb's temporary socket-only server, which says ready and then
  // shuts down, so a migrate that starts on that answer fails (docs/handoff.md trap 3).
  const test = (await services()).db?.healthcheck?.test
  expect(test?.slice(0, 4)).toEqual(["CMD", "pg_isready", "-h", "127.0.0.1"])
})

Deno.test("every long-running service starts again after a reboot", async () => {
  // A service without a restart policy stays Exited after a host reboot or a Docker restart, as
  // the Postgres exporter did (spy4x/seed#560). The one-shot migrate and the never-started base
  // image are the only exceptions.
  const missing = Object.entries(await services())
    .filter(([name, service]) =>
      name !== "migrate" && !service.profiles?.includes(`donotstart`) &&
      service.restart !== `unless-stopped`
    )
    .map(([name]) => name)
  expect(missing).toEqual([])
})
