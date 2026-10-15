/// <reference lib="deno.ns" />
/**
 * Holds the optional `admin` service in `infra/compose/compose.shared.yml` and its production
 * override to what spy4x/template#146 needs: the admin app runs only under the `admin` profile, on
 * `ADMIN_DOMAIN` alone, and that host's `/api` reaches the project's API, which learns the host so
 * it can serve the operator area there and nowhere else.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

interface ComposeService {
  profiles?: string[]
  labels?: string[]
  environment?: string[]
}

async function services(file: string): Promise<Record<string, ComposeService>> {
  const path = fromFileUrl(new URL(`../infra/compose/${file}`, import.meta.url))
  const compose = parse(await Deno.readTextFile(path)) as {
    services?: Record<string, ComposeService>
  }
  if (!compose.services) throw new Error(`${file} has no services`)
  return compose.services
}

function label(service: ComposeService | undefined, key: string): string | undefined {
  const prefix = `${key}=`
  return service?.labels?.find((entry) => entry.startsWith(prefix))?.slice(prefix.length)
}

const PAGE = "traefik.http.routers.admin-${PROJECT}"
const API = "traefik.http.routers.admin-api-${PROJECT}"

Deno.test("the admin app is in the admin profile only", async () => {
  const { admin } = await services("compose.shared.yml")
  expect(admin?.profiles).toEqual(["admin"])
})

Deno.test("the admin host serves the admin app, and its /api reaches the API with the header strip", async () => {
  const { admin } = await services("compose.shared.yml")
  expect(label(admin, `${PAGE}.rule`)).toBe("Host(`${ADMIN_DOMAIN:-}`) && !PathPrefix(`/api`)")
  expect(label(admin, `${PAGE}.service`)).toBe("admin-${PROJECT}")
  expect(label(admin, `${API}.rule`)).toBe("Host(`${ADMIN_DOMAIN:-}`) && PathPrefix(`/api`)")
  expect(label(admin, `${API}.service`)).toBe("api-${PROJECT}")
  expect(label(admin, `${API}.middlewares`)).toBe("strip-cf-ip-${PROJECT}")
})

Deno.test("the api container learns the admin host, or it would serve the operator area nowhere", async () => {
  const { api } = await services("compose.shared.yml")
  expect(api?.environment).toContain("ADMIN_DOMAIN=${ADMIN_DOMAIN:-}")
})

Deno.test("in production both admin routers are HTTPS only, and plain HTTP redirects for good", async () => {
  const { admin } = await services("compose.prod.yml")
  for (const router of [PAGE, API]) {
    expect(label(admin, `${router}.entrypoints`), router).toBe("websecure")
    expect(label(admin, `${router}.tls`), router).toBe("true")
    expect(label(admin, `${router}.tls.certresolver`), router).toContain("TRAEFIK_CERT_RESOLVER")
  }
  expect(label(admin, `${API}.middlewares`)).toBe("strip-cf-ip-${PROJECT}")
  const redirect = "traefik.http.routers.http-admin-${PROJECT}"
  expect(label(admin, `${redirect}.rule`)).toBe("Host(`${ADMIN_DOMAIN:-}`)")
  expect(label(admin, `${redirect}.entrypoints`)).toBe("web")
  expect(label(admin, `${redirect}.middlewares`)).toBe("https-redirect-${PROJECT}")
})
