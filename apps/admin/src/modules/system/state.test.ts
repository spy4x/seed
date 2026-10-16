import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import type { AdminFailedJob, AdminSystemSnapshot } from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createSystemState } from "./state.ts"

const ok = <T>(data: T) => ({ ok: true, status: 200, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

const job = {
  id: "01927f3e-6b2a-7c3d-8e4f-5a6b7c8d9e0f",
  kind: "mail.password_reset",
} as AdminFailedJob
const snapshot = { checkedAt: "2026-10-16T09:00:00.000Z" } as AdminSystemSnapshot

type Answer = (path: string, init?: RequestInit) => Promise<AdminApiResult<unknown>> | undefined

function fakeRequest(answer: Answer = () => undefined) {
  const calls: string[] = []
  const request = ((path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`)
    const fallback = path === `/api/admin/system` ? ok(snapshot) : ok({ retried: true })
    return answer(path, init) ?? Promise.resolve(fallback)
  }) as AdminFetch
  return { request, calls }
}

it("reads the stack, and keeps the last reading when a new one fails", async () => {
  let down = false
  const { request } = fakeRequest(() => down ? Promise.resolve(fail(500, `Down.`)) : undefined)
  const state = createSystemState(request, createToastStore())
  await state.refresh()
  down = true
  await state.refresh()

  expect(state.read.value).toEqual({ snapshot, pending: false, error: `Down.` })
})

it("runs the confirmed job again, says so, and reads the stack again", async () => {
  const { request, calls } = fakeRequest()
  const toasts = createToastStore()
  const state = createSystemState(request, toasts)
  state.openRetry(job)
  await state.confirmRetry()

  expect(calls).toEqual([
    `POST /api/admin/system/jobs/${job.id}/retry`,
    `GET /api/admin/system`,
  ])
  expect(state.retry.value.job).toBeNull()
  expect(toasts.list.value.map((toast) => toast.body)).toEqual([
    `mail.password_reset runs again.`,
  ])
})

it("keeps the dialog open with the API's reason when it refuses", async () => {
  const { request, calls } = fakeRequest((path) =>
    path.endsWith(`/retry`) ? Promise.resolve(fail(409, `A newer run waits.`)) : undefined
  )
  const state = createSystemState(request, createToastStore())
  state.openRetry(job)
  await state.confirmRetry()

  expect(state.retry.value).toEqual({ job, pending: false, error: `A newer run waits.` })
  expect(calls).toEqual([`POST /api/admin/system/jobs/${job.id}/retry`])
})

it("sends nothing without an open dialog, and will not close one whose request is in flight", async () => {
  let release: (value: AdminApiResult<unknown>) => void = () => {}
  const { request, calls } = fakeRequest((path) =>
    path.endsWith(`/retry`) ? new Promise((resolve) => (release = resolve)) : undefined
  )
  const state = createSystemState(request, createToastStore())
  await state.confirmRetry()
  expect(calls).toEqual([])

  state.openRetry(job)
  const sent = state.confirmRetry()
  state.closeRetry()
  expect(state.retry.value.job).toEqual(job)
  await state.confirmRetry()
  expect(calls).toHaveLength(1)
  release(ok({ retried: true }))
  await sent
  expect(state.retry.value.job).toBeNull()
})
