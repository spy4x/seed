import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import type { WebsiteStatsResponse } from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createStatsState, statsPath } from "./state.ts"

const ok = <T>(data: T) => ({ ok: true, status: 200, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

const off = (missing: string[]): WebsiteStatsResponse => ({ state: `off`, missing })

/** A `request` whose answers the test settles one by one, in any order. */
function heldRequest() {
  const calls: { path: string; settle: (result: AdminApiResult<unknown>) => void }[] = []
  const request =
    ((path: string) =>
      new Promise<AdminApiResult<unknown>>((settle) => calls.push({ path, settle }))) as AdminFetch
  return { request, calls }
}

it("asks for the period, the chart's source and a fresh read in the query", () => {
  expect(statsPath({ days: 7, source: null })).toBe(`/api/admin/website-stats?days=7`)
  expect(statsPath({ days: 90, source: `zalo a`, fresh: true })).toBe(
    `/api/admin/website-stats?days=90&source=zalo+a&fresh=1`,
  )
})

it("keeps the last numbers on screen while the next read is pending", async () => {
  const { request, calls } = heldRequest()
  const state = createStatsState(request)
  const first = state.load({ days: 30, source: null })
  calls[0].settle(ok(off([`UMAMI_API_URL`])))
  await first

  const second = state.load({ days: 7, source: null })
  expect(state.stats.value).toEqual({
    response: off([`UMAMI_API_URL`]),
    pending: true,
    error: null,
  })
  calls[1].settle(ok(off([])))
  await second
  expect(state.stats.value).toEqual({ response: off([]), pending: false, error: null })
})

it("drops an answer that a later read replaced", async () => {
  const { request, calls } = heldRequest()
  const state = createStatsState(request)
  const older = state.load({ days: 30, source: null })
  const newer = state.load({ days: 7, source: null })
  calls[1].settle(ok(off([`UMAMI_API_TOKEN`])))
  await newer
  calls[0].settle(ok(off([`UMAMI_API_URL`])))
  await older

  expect(state.stats.value.response).toEqual(off([`UMAMI_API_TOKEN`]))
  expect(state.stats.value.pending).toBe(false)
})

it("keeps the old numbers and shows the error when our API fails", async () => {
  const { request, calls } = heldRequest()
  const state = createStatsState(request)
  const first = state.load({ days: 30, source: null })
  calls[0].settle(ok(off([])))
  await first
  const second = state.load({ days: 30, source: null, fresh: true })
  calls[1].settle(fail(500, `Server error`))
  await second

  expect(state.stats.value).toEqual({ response: off([]), pending: false, error: `Server error` })
})
