import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { ApiResult } from "@spy4x/platform/api"
import { createBillingStore } from "./billing.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"

interface Call {
  url: string
  method: string
  body: unknown
}

/** A store over a fake `apiFetch` that answers each call with the next of `answers`. */
function harness(...answers: (ApiResult<unknown> | Error)[]) {
  const calls: Call[] = []
  const left: string[] = []
  let release: () => void = () => {}
  const store = createBillingStore(
    <T>(url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      })
      const answer = answers.shift() ?? new Error("no answer left")
      if (answer instanceof Error) return Promise.reject(answer)
      return new Promise<ApiResult<T>>((resolve) => {
        release = () => resolve(answer as ApiResult<T>)
        if (!held) release()
      })
    },
    (url) => left.push(url),
  )
  let held = false
  return {
    store,
    calls,
    left,
    hold: () => (held = true),
    release: () => release(),
  }
}

const billingJson = {
  enabled: true,
  planId: "pro",
  status: 2,
  currentPeriodEnd: "2026-11-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  trialEnd: null,
  notice: null,
  canManage: true,
  subscribed: true,
  hasCustomer: true,
  seatPrice: { seats: 3, amount: 900, currency: "EUR" },
}

describe("billing store", () => {
  it("reads a group's billing and turns the period's end into a date", async () => {
    const { store, calls } = harness({ ok: true, status: 200, data: { billing: billingJson } })

    await store.load(groupId)

    expect(calls).toEqual([{
      url: `/api/groups/${groupId}/billing`,
      method: "GET",
      body: undefined,
    }])
    expect(store.current.value).toEqual({
      groupId,
      billing: { ...billingJson, currentPeriodEnd: new Date("2026-11-01T00:00:00Z") },
    })
  })

  it("turns the trial's end and the notice's date into dates", async () => {
    const trial = {
      ...billingJson,
      status: 1,
      trialEnd: "2026-10-15T10:00:00.000Z",
      notice: { kind: 1, at: "2026-10-15T10:00:00.000Z", daysLeft: 2 },
    }
    const { store } = harness({ ok: true, status: 200, data: { billing: trial } })

    await store.load(groupId)

    expect(store.current.value?.billing).toMatchObject({
      trialEnd: new Date("2026-10-15T10:00:00Z"),
      notice: { kind: 1, at: new Date("2026-10-15T10:00:00Z"), daysLeft: 2 },
    })
  })

  it("refuses an answer it cannot read, and keeps no billing from it", async () => {
    const { store } = harness({
      ok: true,
      status: 200,
      data: { billing: { ...billingJson, notice: { kind: 9, at: "x", daysLeft: 1 } } },
    })

    await store.load(groupId)

    expect(store.current.value).toBeNull()
    expect(store.error.value?.message).toBe("The plan could not be read.")
  })

  it("posts the chosen plan to the checkout and leaves for the provider's page", async () => {
    const { store, calls, left } = harness({
      ok: true,
      status: 200,
      data: { url: "https://checkout.stripe.com/c/pay/cs_1" },
    })

    await store.checkout(groupId, "pro")

    expect(calls).toEqual([{
      url: `/api/groups/${groupId}/billing/checkout`,
      method: "POST",
      body: { planId: "pro" },
    }])
    expect(left).toEqual(["https://checkout.stripe.com/c/pay/cs_1"])
    expect(store.pending.value).toBe(true)
  })

  it("opens one checkout at a time, however often the plan is chosen", async () => {
    const { store, calls, hold, release } = harness({
      ok: true,
      status: 200,
      data: { url: "https://pay.example/p" },
    })
    hold()

    const first = store.portal(groupId)
    await store.portal(groupId)
    release()
    await first

    expect(calls).toHaveLength(1)
  })

  it("shows a refusal for the group it was for and lets the owner try again", async () => {
    const { store, left } = harness({
      ok: false,
      status: 403,
      error: { status: 403, message: "Only the owner can manage the group's billing" },
    })

    await store.checkout(groupId, "pro")

    expect(store.error.value).toMatchObject({
      groupId,
      message: "Only the owner can manage the group's billing",
    })
    expect(store.pending.value).toBe(false)
    expect(left).toEqual([])
  })

  it("marks every refusal as new, even when its message repeats", async () => {
    const refusal = {
      ok: false as const,
      status: 409,
      error: { status: 409, message: "The group already has a subscription" },
    }
    const { store } = harness(refusal, refusal)

    await store.checkout(groupId, "pro")
    const first = store.error.value
    await store.checkout(groupId, "pro")

    expect(store.error.value?.message).toBe(first?.message)
    expect(store.error.value?.id).not.toBe(first?.id)
  })

  it("never leaves for a provider page that is not http or https", async () => {
    const { store, left } = harness({
      ok: true,
      status: 200,
      data: { url: "javascript:alert(1)" },
    })

    await store.portal(groupId)

    expect(left).toEqual([])
    expect(store.error.value?.message).toBe(
      "The payment provider answered with an address this app does not open.",
    )
    expect(store.pending.value).toBe(false)
  })

  it("says Stripe's page could not be opened when the call never arrives", async () => {
    const { store } = harness(new TypeError("Failed to fetch"))

    await store.portal(groupId)
    expect(store.error.value?.message).toBe(
      "Could not open Stripe's billing page. Check your connection and try again.",
    )
    expect(store.pending.value).toBe(false)

    await store.checkout(groupId, "pro")
    expect(store.error.value?.message).toBe(
      "Could not open Stripe's checkout. Check your connection and try again.",
    )
    expect(store.pending.value).toBe(false)
  })

  it("reads the person's own trial, and keeps none from an answer it cannot read", async () => {
    const trial = {
      enabled: true,
      used: true,
      groupId: "019a0000-0000-7000-8000-000000000001",
      days: 14,
    }
    const { store, calls } = harness(
      { ok: true, status: 200, data: { trial } },
      { ok: true, status: 200, data: { trial: { enabled: true, used: "no", days: 14 } } },
    )

    await store.loadTrial()
    expect(calls[0]).toEqual({ url: `/api/billing/trial`, method: "GET", body: undefined })
    expect(store.trial.value).toEqual(trial)

    await store.loadTrial()
    expect(store.trial.value).toBeNull()
  })

  it("forgets everything on sign-out", async () => {
    const { store } = harness({ ok: true, status: 200, data: { billing: billingJson } })
    await store.load(groupId)

    store.reset()

    expect([store.current.value, store.error.value, store.pending.value]).toEqual([
      null,
      null,
      false,
    ])
  })
})
