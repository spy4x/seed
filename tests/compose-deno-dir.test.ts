/// <reference lib="deno.ns" />
/**
 * Holds every service in `infra/compose/compose.shared.yml` to the Deno cache its image already
 * holds. `Dockerfile.base` runs `deno install --frozen` into the image's `DENO_DIR` (`/deno-dir`)
 * and hands it to user 1000, so a container that sets its own `DENO_DIR` starts on an empty cache
 * and downloads every JSR and npm package again on each start (spy4x/seed#947).
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE = fromFileUrl(new URL("../infra/compose/compose.shared.yml", import.meta.url))

type Environment = string[] | Record<string, unknown>

/** The names a service's `environment` sets, in either of compose's two forms. */
function names(environment: Environment | undefined): string[] {
  if (!environment) return []
  if (Array.isArray(environment)) return environment.map((entry) => entry.split(`=`)[0])
  return Object.keys(environment)
}

Deno.test("no compose service overrides the image's prefilled Deno cache", async () => {
  const compose = parse(await Deno.readTextFile(COMPOSE)) as {
    services?: Record<string, { environment?: Environment }>
  }
  const services = Object.entries(compose.services ?? {})
  // The services that run Deno from the base image; an empty or renamed list fails here instead of
  // passing with nothing checked.
  expect(services.map(([name]) => name)).toEqual(
    expect.arrayContaining([`migrate`, `api`, `worker`, `spa`]),
  )
  const overrides = services
    .filter(([, service]) => names(service.environment).includes(`DENO_DIR`))
    .map(([name]) => name)
  expect(overrides).toEqual([])
})
