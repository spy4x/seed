import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { ADMIN_AUDIT_NO_FILTER, type AdminAuditEntry, type AdminAuditPage } from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { auditPath, createAuditState } from "./state.ts"

const ok = <T>(data: T) => ({ ok: true, status: 200, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

const entry = (key: string) => ({ key }) as AdminAuditEntry

/** A `request` that answers each path from `pages`, and records the paths it was asked for. */
function fakeRequest(answer: (path: string) => Promise<AdminApiResult<unknown>>) {
  const calls: string[] = []
  const request = ((path: string) => {
    calls.push(path)
    return answer(path)
  }) as AdminFetch
  return { request, calls }
}

const page = (keys: string[], next: string | null) =>
  Promise.resolve(ok<AdminAuditPage>({ entries: keys.map(entry), next }))

it("reads the newest page with the filter in the query", async () => {
  const { request, calls } = fakeRequest(() => page(["a"], null))
  const state = createAuditState(request)
  await state.load({ ...ADMIN_AUDIT_NO_FILTER, person: "ada", ip: "192.0.2." })

  expect(calls).toEqual([`/api/admin/audit?person=ada&ip=192.0.2.`])
  expect(state.log.value).toMatchObject({ entries: [entry("a")], next: null, pending: false })
})

it("appends the older page it reads with the cursor, under the same filter", async () => {
  const { request, calls } = fakeRequest((path) =>
    path.includes(`cursor=`) ? page(["c"], null) : page(["a", "b"], "next+1")
  )
  const state = createAuditState(request)
  const filter = { ...ADMIN_AUDIT_NO_FILTER, operator: 7 }
  await state.load(filter)
  await state.more()

  expect(calls).toEqual([
    `/api/admin/audit?operator=7`,
    `/api/admin/audit?operator=7&cursor=next%2B1`,
  ])
  expect(state.log.value.entries).toEqual([entry("a"), entry("b"), entry("c")])
  expect(state.log.value.next).toBeNull()
})

it("asks for no older page at the oldest entry", async () => {
  const { request, calls } = fakeRequest(() => page(["a"], null))
  const state = createAuditState(request)
  await state.load(ADMIN_AUDIT_NO_FILTER)
  await state.more()

  expect(calls).toEqual([`/api/admin/audit`])
})

it("drops a page that arrives after the operator changed the filter", async () => {
  let release: (value: AdminApiResult<unknown>) => void = () => {}
  const { request } = fakeRequest((path) =>
    path.includes(`person=old`)
      ? new Promise((resolve) => (release = resolve))
      : page(["new"], null)
  )
  const state = createAuditState(request)
  const stale = state.load({ ...ADMIN_AUDIT_NO_FILTER, person: "old" })
  await state.load({ ...ADMIN_AUDIT_NO_FILTER, person: "new" })
  release(ok({ entries: [entry("old")], next: null }))
  await stale

  expect(state.log.value.entries).toEqual([entry("new")])
})

it("keeps the entries it has and shows why an older page failed", async () => {
  const { request } = fakeRequest((path) =>
    path.includes(`cursor=`) ? Promise.resolve(fail(400, `Start again.`)) : page(["a"], "n")
  )
  const state = createAuditState(request)
  await state.load(ADMIN_AUDIT_NO_FILTER)
  await state.more()

  expect(state.log.value).toMatchObject({
    entries: [entry("a")],
    error: `Start again.`,
    loadingMore: false,
  })
})

it("reads the operators once, and again after a failure", async () => {
  let fails = true
  const { request, calls } = fakeRequest(() =>
    Promise.resolve(fails ? fail(500, `Down.`) : ok({ operators: [{ id: 7 }] }))
  )
  const state = createAuditState(request)
  await state.loadOperators()
  fails = false
  await state.loadOperators()
  await state.loadOperators()

  expect(calls).toHaveLength(2)
  expect(state.operators.value).toEqual([{ id: 7 }])
})

it("builds the export's address from the filter alone", () => {
  expect(auditPath(`/api/admin/audit/export.csv`, ADMIN_AUDIT_NO_FILTER)).toBe(
    `/api/admin/audit/export.csv`,
  )
  expect(auditPath(`/api/admin/audit/export.csv`, { ...ADMIN_AUDIT_NO_FILTER, from: `2026-10-01` }))
    .toBe(`/api/admin/audit/export.csv?from=2026-10-01`)
})
