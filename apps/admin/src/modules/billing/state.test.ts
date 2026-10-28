import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { createToastStore } from "@spy4x/preact-signals/toast"
import { type AdminBillingDetail, BillingStatus, PRO_PLAN_ID } from "@domain/billing"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { type BillingClock, createBillingState } from "./state.ts"

const GROUP_ID = `0199c3a0-0000-7000-8000-000000000001`

function detail(updatedAt: string, overrides: Partial<AdminBillingDetail[`customer`]> = {}) {
  return {
    customer: {
      groupId: GROUP_ID,
      groupName: `Acme`,
      groupDeletedAt: null,
      owner: { id: 7, name: `Ada`, email: `ada@example.com` },
      planId: PRO_PLAN_ID,
      status: BillingStatus.Active,
      quantity: 4,
      currentPeriodEnd: `2026-11-12T12:00:00.000Z`,
      cancelAtPeriodEnd: false,
      trialEnd: null,
      pastDueSince: null,
      everActive: true,
      updatedAt,
      ...overrides,
    },
    customerSince: null,
    providerUrl: null,
    history: [],
    operatorIsMember: false,
    graceDays: 7,
  } satisfies AdminBillingDetail
}

const BEFORE = `2026-10-17T10:00:00.000Z`
const AFTER = `2026-10-17T10:00:30.000Z`

const ok = <T>(data: T, status = 200) => ({ ok: true, status, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string, reason?: string) =>
  ({ ok: false, status, error: { message, reason } }) as AdminApiResult<T>

type Answer = (path: string, init?: RequestInit) => AdminApiResult<unknown> | undefined

/** A `request` that answers from `answer` (or the stored customer) and records each call. */
function fakeRequest(answer: Answer = () => undefined) {
  const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = []
  const request = ((path: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? `GET`,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    const fallback = path.endsWith(`/payment`)
      ? ok({ payment: null })
      : init?.method === `POST`
      ? ok({ detail: detail(BEFORE) })
      : ok(detail(BEFORE))
    return Promise.resolve(answer(path, init) ?? fallback)
  }) as AdminFetch
  return { request, calls }
}

/** A clock whose sleep returns at once and moves time on by what it slept. */
function fakeClock(): BillingClock & { slept: number } {
  const clock = {
    slept: 0,
    now: () => clock.slept,
    sleep: (ms: number) => {
      clock.slept += ms
      return Promise.resolve()
    },
  }
  return clock
}

async function opened(answer?: Answer, clock = fakeClock()) {
  const fake = fakeRequest(answer)
  const state = createBillingState(fake.request, createToastStore(), clock)
  await state.loadCustomer(GROUP_ID)
  return { ...fake, state, clock }
}

it(`reads the customer list with the search, status chip and page in the query`, async () => {
  const { request, calls } = fakeRequest()
  const state = createBillingState(request, createToastStore(), fakeClock())
  await state.loadList({ query: `acme`, status: `trial`, page: 2 })
  expect(calls.map((call) => call.path)).toEqual([
    `/api/admin/billing/customers?q=acme&status=trial&page=2`,
  ])
})

it(`sends the key made when the dialog opened with every try, and a new one after reopening`, async () => {
  const { state, calls } = await opened((_path, init) =>
    init?.method === `POST`
      ? fail(502, `Stripe refused this: card. Nothing changed.`, `provider_refused`)
      : undefined
  )
  state.openDialog(`time`)
  await state.act({ kind: `time`, length: `1m`, note: `ticket 4411` })
  await state.act({ kind: `time`, length: `1m`, note: `ticket 4411` })
  state.closeDialog()
  state.openDialog(`time`)
  await state.act({ kind: `time`, length: `1m`, note: `` })

  const posts = calls.filter((call) => call.method === `POST`)
  expect(posts.map((call) => call.path)).toEqual(
    Array(3).fill(`/api/admin/billing/${GROUP_ID}/time`),
  )
  const [first, retry, reopened] = posts.map((call) => call.body!)
  expect(isUuid(String(first.idempotencyKey))).toBe(true)
  expect(retry.idempotencyKey).toBe(first.idempotencyKey)
  expect(reopened.idempotencyKey).not.toBe(first.idempotencyKey)
  expect(first).toEqual({ idempotencyKey: first.idempotencyKey, length: `1m`, note: `ticket 4411` })
  expect(reopened).toEqual({ idempotencyKey: reopened.idempotencyKey, length: `1m` })
})

it(`says the result of a refund that got no answer is unknown, never that nothing changed`, async () => {
  const { state } = await opened((_path, init) =>
    init?.method === `POST` ? fail(0, `Something went wrong. Try again.`) : undefined
  )
  state.openDialog(`refund`)
  await state.act({ kind: `refund`, paymentId: `pi_1`, note: `` })

  const { error, dialog } = state.dialog.value
  expect(dialog).toBe(`refund`)
  expect(error).toEqual({
    unknown: true,
    message: expect.stringContaining(`cannot tell whether this happened`),
  })
  expect(error!.message).not.toContain(`Nothing changed`)
  expect(error!.message).toContain(`Check the customer in Stripe`)
})

it(`marks the API's unclear answer as unknown, and Stripe's plain refusal as a refusal`, async () => {
  let answer = fail(502, `Stripe did not answer clearly`, `result_unknown`)
  const { state } = await opened((_path, init) => init?.method === `POST` ? answer : undefined)
  state.openDialog(`refund`)
  await state.act({ kind: `refund`, paymentId: `pi_1`, note: `` })
  expect(state.dialog.value.error?.unknown).toBe(true)

  answer = fail(502, `Stripe refused this: no. Nothing changed.`, `provider_refused`)
  await state.act({ kind: `refund`, paymentId: `pi_1`, note: `` })
  expect(state.dialog.value.error).toEqual({
    unknown: false,
    message: `Stripe refused this: no. Nothing changed.`,
  })
})

it(`waits after a cancel until the stored subscription changes, then shows it`, async () => {
  let reads = 0
  const { state, calls } = await opened((path, init) => {
    if (init?.method === `POST` || path.endsWith(`/payment`)) return undefined
    reads++
    // The first read opens the page; the poll's second read sees the webhook's change.
    return reads >= 3 ? ok(detail(AFTER, { cancelAtPeriodEnd: true })) : ok(detail(BEFORE))
  })
  state.openDialog(`cancel`)
  await state.act({ kind: `cancel`, when: `period_end`, note: `` })

  expect(calls.filter((call) => call.method === `POST`)[0].body?.when).toBe(`period_end`)
  expect(state.dialog.value.dialog).toBe(null)
  expect(state.customer.value.waiting).toBe(null)
  expect(state.customer.value.detail?.customer.cancelAtPeriodEnd).toBe(true)
  expect(reads).toBe(3)
})

it(`points to Stripe after two minutes without the webhook`, async () => {
  const clock = fakeClock()
  const { state } = await opened(undefined, clock)
  state.openDialog(`undo`)
  await state.act({ kind: `undo`, note: `` })

  expect(state.customer.value.waiting).toEqual({ timedOut: true })
  expect(clock.slept).toBe(2 * 60 * 1000)
})

it(`reads the last payment again after a refund instead of waiting for a webhook`, async () => {
  const { state, calls } = await opened()
  state.openDialog(`refund`)
  await state.act({ kind: `refund`, paymentId: `pi_1`, note: `` })

  expect(calls.at(-1)?.path).toBe(`/api/admin/billing/${GROUP_ID}/payment`)
  expect(state.customer.value.waiting).toBe(null)
})
