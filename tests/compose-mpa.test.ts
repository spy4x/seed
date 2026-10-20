/// <reference lib="deno.ns" />
/**
 * Holds the optional `mpa` service in `infra/compose/compose.shared.yml` to what docs/apps.md's
 * "The SPA and the MPA" section promises: it exists only under the `mpa` profile, so the default
 * deploy stays the SPA alone, and when it runs it serves `MPA_DOMAIN` only, never the SPA's
 * `DOMAIN` (spy4x/template#122, #265).
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE = fromFileUrl(new URL("../infra/compose/compose.shared.yml", import.meta.url))

interface ComposeService {
  profiles?: string[]
  labels?: string[]
  environment?: string[]
  networks?: string[]
}

const COMPOSE_PROD = fromFileUrl(new URL("../infra/compose/compose.prod.yml", import.meta.url))
const COMPOSE_DEV = fromFileUrl(new URL("../infra/compose/compose.dev.yml", import.meta.url))

async function services(file = COMPOSE): Promise<Record<string, ComposeService>> {
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

Deno.test("the MPA is in the mpa profile only, and the SPA is in no profile", async () => {
  const all = await services()
  expect(all.mpa?.profiles).toEqual(["mpa"])
  expect(all.spa?.profiles, "the default deploy keeps serving the SPA").toBeUndefined()
})

Deno.test("the MPA serves MPA_DOMAIN only and never takes the SPA's DOMAIN", async () => {
  const { mpa } = await services()
  const router = "traefik.http.routers.mpa-${PROJECT}"
  // `:-` and never a fallback to DOMAIN: Compose interpolates profiled services too, so `:?` would
  // break the default deploy, and the MPA itself refuses to start without MPA_DOMAIN.
  expect(label(mpa, `${router}.rule`)).toBe("Host(`${MPA_DOMAIN:-}`)")
  expect(label(mpa, `${router}.priority`), "nothing to outrank on its own host").toBeUndefined()
})

Deno.test("the MPA learns its own host, or it would refuse its own forms", async () => {
  const { mpa } = await services()
  expect(mpa?.environment).toContain("MPA_DOMAIN=${MPA_DOMAIN:-}")
})

Deno.test("the MPA gets the Umami pair from the env file, empty by default so no tracker loads", async () => {
  const { mpa } = await services()
  expect(mpa?.environment).toContain("MPA_UMAMI_ORIGIN=${MPA_UMAMI_ORIGIN:-}")
  expect(mpa?.environment).toContain("MPA_UMAMI_WEBSITE_ID=${MPA_UMAMI_WEBSITE_ID:-}")
})

Deno.test("in production the MPA is served over HTTPS on the port its image listens on", async () => {
  const { mpa } = await services(COMPOSE_PROD)
  const router = "traefik.http.routers.mpa-${PROJECT}"
  expect(label(mpa, `${router}.entrypoints`)).toBe("websecure")
  expect(label(mpa, `${router}.tls`)).toBe("true")
  expect(label(mpa, `${router}.tls.certresolver`)).toContain("TRAEFIK_CERT_RESOLVER")
  const shared = (await services()).mpa
  expect(label(shared, "traefik.http.services.mpa-${PROJECT}.loadbalancer.server.port")).toBe(
    "8080",
  )
})

// The API trusts the website's `X-Real-IP` by looking up `${PROJECT}-mpa` (PROXY_HOSTS). On two
// networks the website has two addresses, and the API could look up the one it is not called from.
Deno.test("the API trusts the client address of Traefik and its own website, on one network", async () => {
  const { api, mpa } = await services()
  expect(api?.environment).toContain("PROXY_HOSTS=traefik,${PROJECT}-mpa")
  expect(mpa?.networks).toEqual(["proxy"])
  for (const file of [COMPOSE_PROD, COMPOSE_DEV]) {
    expect((await services(file)).mpa?.networks, file).toBeUndefined()
  }
})
