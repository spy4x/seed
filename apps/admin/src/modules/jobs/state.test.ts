import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import {
  ADMIN_JOB_NO_FILTER,
  type AdminJobDetail,
  AdminJobState,
  type AdminRepeatingJob,
} from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createJobsState, JOB_ACTION_FAILED } from "./state.ts"

const ID = `01920000-0000-7000-8000-000000000001`

const job: AdminJobDetail = {
  id: ID,
  kind: `auth.password-reset-mail`,
  label: `Password reset email`,
  state: AdminJobState.Failed,
  attempts: 20,
  maxAttempts: 20,
  createdAt: `2026-10-20T10:00:00.000Z`,
  dueAt: `2026-10-20T10:00:00.000Z`,
  startedAt: `2026-10-20T10:00:00.000Z`,
  finishedAt: `2026-10-20T11:00:00.000Z`,
  errorCode: `MailSendError`,
  repeats: null,
  sendsMail: true,
  cancellable: true,
  about: null,
  keptUntil: `2026-11-19T11:00:00.000Z`,
}

const cleanup: AdminRepeatingJob = {
  kind: `outbox.cleanup`,
  label: `Nightly cleanup`,
  schedule: `Every day`,
  sendsMail: false,
  lastRunAt: null,
  lastFailed: false,
  nextId: ID,
  nextRunAt: `2026-10-21T03:00:00.000Z`,
  running: false,
}

const ok = <T>(data: T) => ({ ok: true, status: 200, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

type Answer = (call: string) => AdminApiResult<unknown> | undefined

/** A `request` that answers from `answer`, or the job and the cleanup, and records each call. */
function fakeRequest(answer: Answer = () => undefined) {
  const calls: string[] = []
  const request = ((path: string, init?: RequestInit) => {
    const call = `${init?.method ?? `GET`} ${path}`
    calls.push(call)
    const fallback = path.endsWith(`/repeating`)
      ? ok({ jobs: [cleanup] })
      : call.startsWith(`POST`)
      ? ok({ job: { ...job, state: AdminJobState.Due } })
      : ok(job)
    return Promise.resolve(answer(call) ?? fallback)
  }) as AdminFetch
  return { request, calls }
}

const bodies = (toasts: ReturnType<typeof createToastStore>) =>
  toasts.list.value.map((toast) => toast.body)

it("asks for the list with its filter in the query, and drops an answer for a filter left behind", async () => {
  const { request, calls } = fakeRequest((call) =>
    call.includes(`/api/admin/jobs?`) ? ok({ jobs: [], total: 0 }) : undefined
  )
  const state = createJobsState(request, createToastStore())
  const old = { ...ADMIN_JOB_NO_FILTER, state: `failed` as const }
  const pending = state.loadList(old)
  const next = { ...ADMIN_JOB_NO_FILTER, query: `reset` }
  state.list.value = { ...state.list.value, filter: next }
  await pending

  expect(calls).toEqual([`GET /api/admin/jobs?state=failed`])
  expect(state.list.value.list).toBeNull()
})

it("runs a failed job again and shows the run as the API answered it", async () => {
  const { request, calls } = fakeRequest()
  const toasts = createToastStore()
  const state = createJobsState(request, toasts)
  await state.loadJob(ID)
  state.openDialog(`retry`)
  await state.act(`retry`)

  expect(calls.at(-1)).toBe(`POST /api/admin/jobs/${ID}/retry`)
  expect(state.dialog.value.dialog).toBeNull()
  expect(state.job.value.detail?.state).toBe(AdminJobState.Due)
  expect(bodies(toasts)).toEqual([`Password reset email started.`])
})

it("closes the dialog, says why and reads the run again when the run changed meanwhile", async () => {
  const { request, calls } = fakeRequest((call) =>
    call.endsWith(`/cancel`) ? fail(409, `This job changed while you looked at it.`) : undefined
  )
  const toasts = createToastStore()
  const state = createJobsState(request, toasts)
  await state.loadJob(ID)
  state.openDialog(`cancel`)
  await state.act(`cancel`)

  expect(state.dialog.value.dialog).toBeNull()
  expect(bodies(toasts)).toEqual([`This job changed while you looked at it.`])
  expect(calls.at(-1)).toBe(`GET /api/admin/jobs/${ID}`)
})

it("keeps the dialog open with a message when the action failed for another reason", async () => {
  const { request } = fakeRequest((call) =>
    call.startsWith(`POST`) ? fail(500, `Internal.`) : undefined
  )
  const toasts = createToastStore()
  const state = createJobsState(request, toasts)
  await state.loadJob(ID)
  state.openDialog(`cancel`)
  await state.act(`cancel`)

  expect(state.dialog.value).toEqual({ dialog: `cancel`, pending: false, error: JOB_ACTION_FAILED })
  expect(bodies(toasts)).toEqual([])
})

it("sends one action at a time", async () => {
  const { request, calls } = fakeRequest()
  const state = createJobsState(request, createToastStore())
  await state.loadJob(ID)
  await Promise.all([state.act(`runNow`), state.act(`runNow`)])

  expect(calls.filter((call) => call.startsWith(`POST`))).toHaveLength(1)
})

it("runs every failed job again after the confirmation and counts them in the toast", async () => {
  const { request, calls } = fakeRequest((call) =>
    call.endsWith(`/retry-failed`)
      ? ok({ retried: 3 })
      : call.includes(`/api/admin/jobs?`)
      ? ok({ jobs: [] })
      : undefined
  )
  const toasts = createToastStore()
  const state = createJobsState(request, toasts)
  await state.loadList({ ...ADMIN_JOB_NO_FILTER, state: `failed` })
  state.openConfirm({ kind: `retryAll`, count: 3 })
  await state.confirmOpen()

  expect(state.confirm.value.confirm).toBeNull()
  expect(bodies(toasts)).toEqual([`3 failed jobs started again.`])
  expect(calls.slice(-2)).toEqual([
    `POST /api/admin/jobs/retry-failed`,
    `GET /api/admin/jobs?state=failed`,
  ])
})

it("runs a repeating job now, then reads the repeating jobs again", async () => {
  const { request, calls } = fakeRequest()
  const toasts = createToastStore()
  const state = createJobsState(request, toasts)
  expect(await state.runRepeating(cleanup)).toBe(true)

  expect(calls).toEqual([
    `POST /api/admin/jobs/repeating/outbox.cleanup/run-now`,
    `GET /api/admin/jobs/repeating`,
  ])
  expect(bodies(toasts)).toEqual([`Nightly cleanup started.`])
  expect(state.repeating.value.starting).toBeNull()
})
