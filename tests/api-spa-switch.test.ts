/// <reference lib="deno.ns" />
/**
 * `SPA=false` reaches the API's gate (docs/deploy.md, "Without the SPA"): `config.ts` reads it with
 * `isSpaOn`, whose parsing `apps/api/services/config-env.test.ts` checks, and `index.ts` hands it
 * to `createApiApp`, whose gate `apps/api/app.test.ts` checks. Both files run against the real
 * environment and database at import, so this reads their source instead of importing them.
 */

import { expect } from "@std/expect"

const read = (path: string) => Deno.readTextFile(new URL(`../${path}`, import.meta.url))

Deno.test("the API's config reads the SPA switch from its environment", async () => {
  const config = await read(`apps/api/services/config.ts`)
  expect(config).toMatch(/^\s+spa = isSpaOn\(env\)$/m)
})

Deno.test("the API's entry point gives the SPA switch to the app's gate", async () => {
  const index = await read(`apps/api/index.ts`)
  const call = index.slice(index.indexOf(`await createApiApp({`))
  const options = call.slice(0, call.indexOf(`\n})`))
  expect(options).toMatch(/^\s+spa: config\.spa,$/m)
})
