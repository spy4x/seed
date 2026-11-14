/// <reference lib="deno.ns" />
/**
 * Holds the `errors` profile (https://github.com/spy4x/seed/issues/496) to its decisions:
 * GlitchTip and its database setup start only with the profile, which the example env file leaves
 * off; GlitchTip waits for its own database and user, keeps out of the API's Valkey database and
 * Postgres connections, is reached on `ERRORS_DOMAIN` alone (HTTPS in production), and has its
 * sign-up and uptime checks off. Compose's general rules (names, ports, variables without a
 * default) are tests/compose-exposure.test.ts' and tests/compose-profiles.test.ts'.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"
import { parseEnvValues } from "../infra/scripts/env-file.ts"

interface ComposeService {
  profiles?: string[]
  image?: string
  labels?: string[]
  environment?: string[]
  networks?: string[]
  depends_on?: Record<string, { condition?: string }>
}

const read = (path: string) =>
  Deno.readTextFile(fromFileUrl(new URL(`../${path}`, import.meta.url)))

async function services(file: string): Promise<Record<string, ComposeService>> {
  const compose = parse(await read(`infra/compose/${file}`)) as {
    services?: Record<string, ComposeService>
  }
  if (!compose.services) throw new Error(`${file} has no services`)
  return compose.services
}

function label(service: ComposeService | undefined, key: string): string | undefined {
  const prefix = `${key}=`
  return service?.labels?.find((entry) => entry.startsWith(prefix))?.slice(prefix.length)
}

const ROUTER = "traefik.http.routers.errors-${PROJECT}"

Deno.test("GlitchTip and its database setup start only with the errors profile, off in the example", async () => {
  const all = await services("compose.shared.yml")
  const inErrors = Object.entries(all)
    .filter(([, service]) => service.profiles?.includes("errors"))
    .map(([name]) => name)
  expect(inErrors.sort()).toEqual(["errors", "errors-db"])
  for (const name of inErrors) expect(all[name].profiles, name).toEqual(["errors"])

  const example = parseEnvValues(await read("infra/envs/.env.example"), ".env.example")
  expect(example.COMPOSE_PROFILES.split(",")).not.toContain("errors")
})

Deno.test("GlitchTip starts only after its database and user exist, and Valkey answers", async () => {
  const { errors: glitchtip, "errors-db": setup } = await services("compose.shared.yml")
  expect(glitchtip.depends_on?.["errors-db"]?.condition).toBe("service_completed_successfully")
  expect(glitchtip.depends_on?.kv?.condition).toBe("service_healthy")
  expect(setup.depends_on?.db?.condition).toBe("service_healthy")
})

Deno.test("GlitchTip has a database and user of its own and Valkey's database 1, not the API's", async () => {
  const { errors: glitchtip } = await services("compose.shared.yml")
  const env = glitchtip.environment ?? []
  expect(env).toContain("DATABASE_NAME=glitchtip")
  expect(env).toContain("DATABASE_USER=glitchtip")
  expect(env).toContain("DATABASE_PASSWORD=${GLITCHTIP_DB_PASS:-}")
  // The API's cache selects no database, so it uses 0.
  expect(env).toContain("VALKEY_DATABASE=1")
})

Deno.test("GlitchTip's connection pool leaves Postgres' 30 connections room beside PgBouncer's 20", async () => {
  const { errors: glitchtip } = await services("compose.shared.yml")
  const pool = (glitchtip.environment ?? []).find((entry) =>
    entry.startsWith("DATABASE_POOL_MAX_SIZE=")
  )
  expect(pool).toBeDefined()
  expect(Number(pool!.split("=")[1])).toBeLessThanOrEqual(4)
})

Deno.test("GlitchTip's image is pinned by version and digest", async () => {
  const { errors: glitchtip } = await services("compose.shared.yml")
  expect(glitchtip.image).toMatch(
    /^docker\.io\/glitchtip\/glitchtip:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/,
  )
})

Deno.test("GlitchTip's sign-up, organization creation and uptime checks are off", async () => {
  const { errors: glitchtip } = await services("compose.shared.yml")
  for (
    const setting of [
      "ENABLE_USER_REGISTRATION",
      "ENABLE_ORGANIZATION_CREATION",
      "GLITCHTIP_ENABLE_UPTIME",
    ]
  ) {
    expect(glitchtip.environment).toContain(`${setting}=false`)
  }
})

Deno.test("the errors host reaches GlitchTip, and its DSNs name that host", async () => {
  const { errors: glitchtip } = await services("compose.shared.yml")
  expect(glitchtip.networks).toContain("proxy")
  expect(label(glitchtip, `${ROUTER}.rule`)).toBe("Host(`${ERRORS_DOMAIN:-}`)")
  expect(label(glitchtip, `${ROUTER}.service`)).toBe("errors-${PROJECT}")
  expect(label(glitchtip, "traefik.http.services.errors-${PROJECT}.loadbalancer.server.port"))
    .toBe("8000")
  expect(glitchtip.environment).toContain("GLITCHTIP_DOMAIN=http://${ERRORS_DOMAIN:-}")
})

Deno.test("in production the errors host is HTTPS only, plain HTTP redirects, and DSNs say https", async () => {
  const { errors: glitchtip } = await services("compose.prod.yml")
  expect(label(glitchtip, `${ROUTER}.entrypoints`)).toBe("websecure")
  expect(label(glitchtip, `${ROUTER}.tls`)).toBe("true")
  expect(label(glitchtip, `${ROUTER}.tls.certresolver`)).toContain("TRAEFIK_CERT_RESOLVER")
  const redirect = "traefik.http.routers.http-errors-${PROJECT}"
  expect(label(glitchtip, `${redirect}.rule`)).toBe("Host(`${ERRORS_DOMAIN:-}`)")
  expect(label(glitchtip, `${redirect}.entrypoints`)).toBe("web")
  expect(label(glitchtip, `${redirect}.middlewares`)).toBe("https-redirect-${PROJECT}")
  expect(glitchtip.environment).toContain("GLITCHTIP_DOMAIN=https://${ERRORS_DOMAIN:-}")
})

Deno.test("the database setup sends GlitchTip's password only inside set_config", async () => {
  // pg_stat_statements keeps a utility statement such as CREATE ROLE as written, and a SELECT with
  // its values replaced. So the password variable may appear in the SELECT alone.
  const sql = await read("infra/configs/glitchtip-db.sql")
  const uses = sql.split("\n").filter((line) => line.includes(":'glitchtip_password'"))
  expect(uses).toHaveLength(1)
  expect(uses[0]).toMatch(/^SELECT set_config\('seed\.glitchtip_password', :'glitchtip_password'/)
  expect(sql).not.toMatch(/PASSWORD\s+:'/i)
})
