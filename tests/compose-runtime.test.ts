/// <reference lib="deno.ns" />
/**
 * `APP_RUNTIME=node` or `bun` adds `infra/compose/compose.runtime-<runtime>.yml`
 * (`infra/scripts/compose-plan.ts`). Each file must move the three services that run the API's
 * image, `migrate`, `api` and `worker`, to that runtime's image and bundles, and leave every other
 * service alone, so the switch is one setting and the rest of the stack stays as on Deno.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"
import { APP_RUNTIMES } from "../infra/scripts/compose-plan.ts"

const DIR = fromFileUrl(new URL("../infra/compose/", import.meta.url))

interface Service {
  build?: { dockerfile?: string }
  command?: string[]
  healthcheck?: { test?: string[] }
}

async function servicesOf(runtime: string): Promise<Record<string, Service>> {
  const compose = parse(await Deno.readTextFile(`${DIR}compose.runtime-${runtime}.yml`)) as {
    services?: Record<string, Service>
  }
  if (!compose.services) throw new Error(`compose.runtime-${runtime}.yml has no services`)
  return compose.services
}

/** Every runtime but Deno, the default, which needs no file. */
const OTHER_RUNTIMES = APP_RUNTIMES.filter((runtime) => runtime !== "deno")

Deno.test("APP_RUNTIME knows Node and Bun besides Deno, the default", () => {
  expect(OTHER_RUNTIMES).toEqual(["node", "bun"])
})

Deno.test("a runtime's Compose file changes migrate, api and worker, and nothing else", async () => {
  for (const runtime of OTHER_RUNTIMES) {
    expect(Object.keys(await servicesOf(runtime)).sort()).toEqual(["api", "migrate", "worker"])
  }
})

Deno.test("a runtime's Compose file builds its own image and runs each bundle on that runtime", async () => {
  for (const runtime of OTHER_RUNTIMES) {
    const services = await servicesOf(runtime)
    const bundles = { migrate: "migrate", api: "api", worker: "worker" } as const
    for (const [name, bundle] of Object.entries(bundles)) {
      const service = services[name]
      expect({ runtime, name, dockerfile: service?.build?.dockerfile }).toEqual({
        runtime,
        name,
        dockerfile: `apps/api/dockerfile.${runtime}`,
      })
      expect(service?.command).toEqual([runtime, `dist/server/${bundle}.js`])
    }
    expect(services.api?.healthcheck?.test).toEqual([
      "CMD",
      runtime,
      "dist/server/healthcheck.js",
      "/api/health",
    ])
  }
})
