import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono, type MiddlewareHandler } from "hono"
import { CATALOG_DEFAULT_SETTINGS } from "@domain/catalog"
import type { APIContext } from "../../_types.ts"
import type { AdminModuleContext } from "./module.ts"
import { adminModuleRoutes } from "./registry.ts"

const passThrough: MiddlewareHandler<APIContext> = (_c, next) => next()

/** Every module's routes over a context that reads nothing, with the catalog `on` or off. */
function app(on: boolean) {
  const context = {
    limit: passThrough,
    catalog: { on, settings: CATALOG_DEFAULT_SETTINGS },
  } as unknown as AdminModuleContext
  const app = new Hono<APIContext>()
  for (const routes of adminModuleRoutes(context)) app.route(`/`, routes)
  return app
}

describe(`operator area registry`, () => {
  it(`leaves the catalog out of the modules and mounts none of its routes while it is off`, async () => {
    const off = app(false)
    const { ids } = await (await off.request(`/modules`)).json()
    expect(ids).not.toContain(`catalog`)
    expect(ids).toContain(`blog`)
    expect((await off.request(`/catalog`)).status).toBe(404)
  })

  it(`lists the catalog among the modules once it is on`, async () => {
    const { ids } = await (await app(true).request(`/modules`)).json()
    expect(ids).toContain(`catalog`)
  })
})
