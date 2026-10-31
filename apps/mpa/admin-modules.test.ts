import { expect } from "@std/expect"
import { siteEnglishText } from "@ui/site-text.ts"
import { ADMIN_MODULES } from "../admin/src/modules/registry.ts"
import { ADMIN_TOUR_MODULES } from "./admin-modules.ts"

Deno.test("the site shows a card for every admin module, in the rail's order, with its icon", () => {
  expect(ADMIN_TOUR_MODULES.map(({ id, Icon }) => ({ id, Icon }))).toEqual(
    ADMIN_MODULES.map(({ id, nav }) => ({ id, Icon: nav.Icon })),
  )
})

Deno.test("the site states the admin registry's module count on /admin and /features", () => {
  const t = siteEnglishText()
  const count = String(ADMIN_MODULES.length)
  for (const key of [`AdminTour.modulesTitle`, `FeatureAdmin.fact2`]) {
    expect(t.t(key, { count: ADMIN_TOUR_MODULES.length })).toMatch(new RegExp(`^${count} modules,`))
  }
})
