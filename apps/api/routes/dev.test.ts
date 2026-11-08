/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { createDevRoute, type DevRouteDeps } from "./dev.ts"

/** The development route with the free plan answer and `isDev` given; nothing else is reached. */
function devRoute(freePlanAllowsNothing: boolean, isDev = true) {
  return createDevRoute({
    isDev,
    db: {} as DevRouteDeps["db"],
    sql: {} as DevRouteDeps["sql"],
    closeSockets: () => 0,
    forgetCodeBudget: () => Promise.resolve(),
    freePlanAllowsNothing,
  })
}

Deno.test("the free plan route tells the e2e specs whether the free plan allows nothing", async () => {
  for (const allowsNothing of [true, false]) {
    const response = await devRoute(allowsNothing).request("/free-plan")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ allowsNothing })
  }
})

Deno.test("the free plan route refuses outside development", async () => {
  const response = await devRoute(true, false).request("/free-plan")
  expect(response.status).toBe(403)
})
