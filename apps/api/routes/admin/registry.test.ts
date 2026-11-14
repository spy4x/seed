import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono, type MiddlewareHandler } from "hono"
import { CATALOG_DEFAULT_SETTINGS } from "@domain/catalog"
import type { APIContext } from "../../_types.ts"
import { NOTES_OFF, NOTES_ON, type NotesSetup } from "@server/notes/setup.ts"
import type { AdminModuleContext } from "./module.ts"
import { adminModuleRoutes } from "./registry.ts"

const passThrough: MiddlewareHandler<APIContext> = (_c, next) => next()

/**
 * Every module's routes over a context that reads nothing, with the catalog `on` or off and the
 * notes as `notes` says (left out: on).
 */
function app(on: boolean, notes?: NotesSetup) {
  const context = {
    limit: passThrough,
    catalog: { on, settings: CATALOG_DEFAULT_SETTINGS },
    notes,
    websiteStats: { setup: null, missing: [], itemPath: `/{slug}` },
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

  it(`lists the notes among the modules while they are on, and when the setup leaves them out`, async () => {
    for (const notes of [NOTES_ON, undefined]) {
      const { ids } = await (await app(false, notes).request(`/modules`)).json()
      expect(ids).toContain(`notes`)
    }
  })

  it(`leaves the notes out of the modules while they are off`, async () => {
    const { ids } = await (await app(false, NOTES_OFF).request(`/modules`)).json()
    expect(ids).not.toContain(`notes`)
    expect(ids).toContain(`groups`)
  })
})
