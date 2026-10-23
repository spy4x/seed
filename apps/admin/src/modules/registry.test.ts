import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { ADMIN_API_MODULES } from "../../../api/routes/admin/registry.ts"
import { ADMIN_USER_TABS } from "@ui/admin-user-screen.tsx"
import { ADMIN_MODULES, adminPersonTabs } from "./registry.ts"

it("registers every module once, with the API's ids in the API's order", () => {
  const ids = ADMIN_MODULES.map((module) => module.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids).toEqual(ADMIN_API_MODULES.map((module) => module.id))
})

it("puts the dashboard first and the users second in the sidebar", () => {
  expect(ADMIN_MODULES.slice(0, 2).map((module) => [module.nav.name, module.nav.href])).toEqual([
    ["Dashboard", "/"],
    ["Users", "/users"],
  ])
})

it("opens one of a module's own pages from its sidebar entry, and no page twice", () => {
  for (const module of ADMIN_MODULES) {
    expect(module.routes.map((route) => route.path)).toContain(module.nav.href)
  }
  const paths = ADMIN_MODULES.flatMap((module) => module.routes.map((route) => route.path))
  expect(new Set(paths).size).toBe(paths.length)
})

it("collects the modules' person tabs in registry order, each id once and none the page's", () => {
  const tabs = adminPersonTabs(ADMIN_MODULES)
  expect(tabs.map((tab) => tab.label)).toEqual([
    "Data exports",
    "API tokens",
    "Devices",
    "Notifications",
  ])
  const ids = [...ADMIN_USER_TABS, ...tabs.map((tab) => tab.id)]
  expect(new Set(ids).size).toBe(ids.length)
})
