import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import { type AdminApiToken, ApiTokenAccess } from "@domain/api-tokens"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createApiTokensState } from "./state.ts"

const token: AdminApiToken = {
  id: "01920000-0000-7000-8000-000000000001",
  name: "CI",
  groupId: "01920000-0000-7000-8000-0000000000aa",
  groupName: "Family",
  access: ApiTokenAccess.WRITE,
  state: "live",
  createdAt: "2026-10-01T10:00:00.000Z",
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  owner: { id: 42, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
}

const ok = <T>(data: T) => ({ ok: true, status: 200, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

type Answer = (path: string) => Promise<AdminApiResult<unknown>> | undefined

/** A `request` that answers from `answer` (or a plain success) and records each call. */
function fakeRequest(answer: Answer = () => undefined) {
  const calls: string[] = []
  const request = ((path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`)
    const fallback = path.startsWith(`/api/admin/api-tokens`) && !path.endsWith(`/revoke`)
      ? ok({ tokens: [token], total: 1, page: 1, pageSize: 25, counts: {} })
      : path.endsWith(`/api-tokens`)
      ? ok({ tokens: [token] })
      : path.endsWith(`/devices`)
      ? ok({ devices: [] })
      : ok({ ok: true })
    return answer(path) ?? Promise.resolve(fallback)
  }) as AdminFetch
  return { request, calls }
}

it("reads the token page with the state and page in the query", async () => {
  const { request, calls } = fakeRequest()
  const state = createApiTokensState(request, createToastStore())
  await state.loadList({ state: "revoked", page: 2 })
  await state.loadList({ state: null, page: 1 })
  expect(calls).toEqual([
    `GET /api/admin/api-tokens?state=revoked&page=2`,
    `GET /api/admin/api-tokens`,
  ])
})

it("drops a person's tab answer that arrives after the page moved to another person", async () => {
  let answerFirst: (value: AdminApiResult<unknown>) => void = () => {}
  const { request } = fakeRequest((path) =>
    path === `/api/admin/users/42/devices`
      ? new Promise((resolve) => answerFirst = resolve)
      : undefined
  )
  const state = createApiTokensState(request, createToastStore())
  const late = state.loadDevices(42)
  await state.loadDevices(7)
  answerFirst(ok({ devices: [{ id: 1, label: "late", createdAt: "", updatedAt: "" }] }))
  await late
  expect(state.devices.value).toEqual({ userId: 7, data: [], error: null })
})

it("revokes the confirmed token, says so, and reads again the lists that showed it", async () => {
  const { request, calls } = fakeRequest()
  const toasts = createToastStore()
  const state = createApiTokensState(request, toasts)
  await state.loadList({ state: null, page: 1 })
  await state.loadTokens(42)
  calls.length = 0

  state.ask({ kind: "revoke", token })
  await state.confirmAction()

  expect(calls).toEqual([
    `POST /api/admin/api-tokens/${token.id}/revoke`,
    `GET /api/admin/api-tokens`,
    `GET /api/admin/users/42/api-tokens`,
  ])
  expect(state.confirm.value.target).toBeNull()
  expect(toasts.list.value.map((toast) => toast.body)).toEqual([`CI is revoked.`])
})

it("keeps the dialog open with the API's reason when a revoke is refused", async () => {
  const { request, calls } = fakeRequest((path) =>
    path.endsWith(`/revoke`) ? Promise.resolve(fail(403, "You cannot do this")) : undefined
  )
  const toasts = createToastStore()
  const state = createApiTokensState(request, toasts)
  state.ask({ kind: "revoke", token })
  await state.confirmAction()

  expect(state.confirm.value).toEqual({
    target: { kind: "revoke", token },
    error: "You cannot do this",
    pending: false,
  })
  expect(calls).toEqual([`POST /api/admin/api-tokens/${token.id}/revoke`])
  expect(toasts.list.value).toEqual([])
})

it("removes the confirmed device and reads the person's devices again", async () => {
  const { request, calls } = fakeRequest()
  const toasts = createToastStore()
  const state = createApiTokensState(request, toasts)
  state.ask({ kind: "remove-device", userId: 42, deviceId: 5, label: "phone123" })
  await state.confirmAction()

  expect(calls).toEqual([
    `POST /api/admin/users/42/devices/5/remove`,
    `GET /api/admin/users/42/devices`,
  ])
  expect(toasts.list.value.map((toast) => toast.body)).toEqual([`Device phone123 is removed.`])
})

it("sends one request however often the confirm is pressed, and cannot be closed meanwhile", async () => {
  let answer: (value: AdminApiResult<unknown>) => void = () => {}
  const { request, calls } = fakeRequest((path) =>
    path.endsWith(`/revoke`) ? new Promise((resolve) => answer = resolve) : undefined
  )
  const state = createApiTokensState(request, createToastStore())
  state.ask({ kind: "revoke", token })
  const first = state.confirmAction()
  await state.confirmAction()
  state.closeConfirm()
  expect(state.confirm.value.pending).toBe(true)
  answer(ok({ ok: true }))
  await first
  expect(calls.filter((call) => call.startsWith(`POST`))).toHaveLength(1)
})
