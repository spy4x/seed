import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import type { BillingProvider, CheckoutRequest, PortalRequest } from "@spy4x/billing"
import { GroupRole } from "@domain/groups"
import {
  BillingCheckoutCommand,
  BillingGetQuery,
  BillingNoticeKind,
  BillingPortalCommand,
  BillingStatus,
  BillingTrialQuery,
  type StoredSubscription,
} from "@domain/billing"
import { createSessionGate } from "../../cqrs/session-gate.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import { roles } from "../../_testing/memory-notes.ts"
import type { APIContext } from "../../_types.ts"
import { createBillingRoute, createBillingTrialRoute } from "../../routes/billing.ts"
import {
  createBillingCheckoutHandler,
  createBillingGetHandler,
  createBillingPortalHandler,
  createBillingTrialHandler,
} from "./handlers.ts"
import { apiError } from "../../_testing/api-error.ts"

/**
 * The billing route over the real handlers on buses with the session gate, as the API wires them.
 * Only the repository and the provider are stand-ins, so a route that skipped the buses, or a
 * handler that skipped the owner check, fails here.
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
/** Another group of the owner's, which their trial can go to instead. */
const OTHER_GROUP = "0199f0c4-6a1e-7c2d-9b3a-4d5e6f708192"
const OWNER = 1
const ADMIN = 2
const EDITOR = 3
const VIEWER = 4
const STRANGER = 5
/** The time the handlers read; a test that needs another passes it to `stack`. */
const NOW = new Date("2026-10-01T10:00:00Z")

interface Recorder {
  checkouts: CheckoutRequest[]
  portals: PortalRequest[]
}

function fakeProvider(recorder: Recorder): BillingProvider {
  return {
    createCheckout(request) {
      recorder.checkouts.push(request)
      return Promise.resolve({ ok: true, value: { id: "cs_1", url: "https://pay.example/cs_1" } })
    },
    createPortalSession(request) {
      recorder.portals.push(request)
      return Promise.resolve({ ok: true, value: { id: "bps_1", url: "https://pay.example/p" } })
    },
    updateQuantity: () => Promise.reject(new Error("not used")),
    parseEvent: () => Promise.reject(new Error("not used")),
  }
}

function stack(
  {
    subscription = null,
    customer = null,
    enabled = true,
    now = NOW,
    trialRequiresCard = true,
    members = 1,
    handedOver = false,
    trialGroup = null,
  }: {
    /** The group each person's one trial went to, as `users.trial_group_id` holds it. */
    trialGroup?: string | null
    subscription?: StoredSubscription | null
    members?: number
    customer?: string | null
    /** The group's customer was handed over by a transfer; `customer` is then the new owner's. */
    handedOver?: boolean
    enabled?: boolean
    now?: Date
    trialRequiresCard?: boolean
  } = {},
) {
  const recorder: Recorder = { checkouts: [], portals: [] }
  const groups = roles({
    [`${groupId}:${OWNER}`]: GroupRole.OWNER,
    [`${groupId}:${ADMIN}`]: GroupRole.ADMIN,
    [`${groupId}:${EDITOR}`]: GroupRole.EDITOR,
    [`${groupId}:${VIEWER}`]: GroupRole.VIEWER,
  })
  // One person's trial, kept the way `claimTrial` keeps it: the first group that claims it has it.
  const trials = new Map<number, string>()
  if (trialGroup) trials.set(OWNER, trialGroup)
  const dependencies = {
    billing: {
      claimTrial: (userId: number, id: string) => {
        if ((trials.get(userId) ?? id) !== id) return Promise.resolve(false)
        trials.set(userId, id)
        return Promise.resolve(true)
      },
      trialGroupOf: (userId: number) => Promise.resolve(trials.get(userId) ?? null),
      get: () => Promise.resolve(subscription),
      lockedRoleOf: (id: string, userId: number) => groups.roleOf(id, userId),
      customerOf: () => Promise.resolve(customer),
      membersOf: () => Promise.resolve(members),
      handedOver: () => Promise.resolve(handedOver),
    },
    groups,
    provider: enabled ? fakeProvider(recorder) : null,
    webAppUrl: "https://app.example.com",
    log: () => {},
    graceDays: 7,
    trialRequiresCard,
    now: () => now,
  }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.register(BillingCheckoutCommand, createBillingCheckoutHandler(dependencies))
  commands.register(BillingPortalCommand, createBillingPortalHandler(dependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(BillingGetQuery, createBillingGetHandler(dependencies))
  queries.register(BillingTrialQuery, createBillingTrialHandler(dependencies))
  const trialRoute = createBillingTrialRoute({ trial: (query) => queries.execute(query) })
  const route = createBillingRoute({
    get: (query) => queries.execute(query),
    checkout: (command) => commands.execute(command),
    portal: (command) => commands.execute(command),
    expectedOrigin: "http://local",
  })
  const call = (
    userId: number,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) => {
    const app = new Hono<APIContext>()
    app.use("*", async (c, next) => {
      c.set("requestId", "req-billing")
      c.set("auth", buildAuthData({ user: { id: userId }, session: { userId } }))
      await next()
    })
    app.route("/groups/:groupId/billing", route)
    app.route("/billing/trial", trialRoute)
    const url = path.startsWith("/billing/trial") ? path : `/groups/${groupId}/billing${path}`
    return app.request(`http://local${url}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: "http://local",
        "sec-fetch-site": "same-origin",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
  return { recorder, call, trials }
}

const PRO: StoredSubscription = {
  groupId,
  providerSubscriptionId: "sub_1",
  planId: "pro",
  status: BillingStatus.Active,
  currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
  cancelAtPeriodEnd: false,
  pastDueSince: null,
  trialEnd: null,
  quantity: 1,
  everActive: true,
}

async function code(response: Response): Promise<string> {
  return (await apiError(response)).reason ?? ``
}

describe("billing over REST", () => {
  for (
    const [name, userId] of [["admin", ADMIN], ["editor", EDITOR], ["viewer", VIEWER]] as const
  ) {
    it(`refuses checkout and the portal to an ${name} with 403 and never calls the provider`, async () => {
      const { recorder, call } = stack({ customer: "cus_1" })

      const checkout = await call(userId, "POST", "/checkout", { planId: "pro" })
      const portal = await call(userId, "POST", "/portal")

      expect([checkout.status, await code(checkout)]).toEqual([403, "ROLE_INSUFFICIENT"])
      expect([portal.status, await code(portal)]).toEqual([403, "ROLE_INSUFFICIENT"])
      expect(recorder).toEqual({ checkouts: [], portals: [] })
    })
  }

  it("answers a stranger as if the group did not exist", async () => {
    const { recorder, call } = stack({ customer: "cus_1" })

    const read = await call(STRANGER, "GET", "")
    const checkout = await call(STRANGER, "POST", "/checkout", { planId: "pro" })

    expect([read.status, await code(read)]).toEqual([404, "GROUP_NOT_FOUND"])
    expect([checkout.status, await code(checkout)]).toEqual([404, "GROUP_NOT_FOUND"])
    expect(recorder.checkouts).toEqual([])
  })

  it("opens the owner's checkout for the group with a seat per member, back to its pages, and answers the provider's URL", async () => {
    const { recorder, call } = stack({ customer: "cus_1", members: 3 })

    const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: "https://pay.example/cs_1" })
    expect(recorder.checkouts).toEqual([{
      planId: "pro",
      successUrl: `https://app.example.com/groups/${groupId}/billing?checkout=done`,
      cancelUrl: `https://app.example.com/groups/${groupId}/billing`,
      reference: groupId,
      quantity: 3,
      customerId: "cus_1",
    }])
  })

  it("starts a group's first checkout with the plan's 14-day trial, and no later one", async () => {
    const first = stack()
    const again = stack({ subscription: { ...PRO, status: BillingStatus.Canceled }, customer: "c" })

    await first.call(OWNER, "POST", "/checkout", { planId: "pro" })
    await again.call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(first.recorder.checkouts[0].trialDays).toBe(14)
    expect(again.recorder.checkouts[0]).not.toHaveProperty("trialDays")
  })

  it("starts the checkout without a trial when the owner's trial went to another group", async () => {
    const { recorder, call, trials } = stack({ trialGroup: OTHER_GROUP })

    const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(response.status).toBe(200)
    expect(recorder.checkouts[0]).not.toHaveProperty("trialDays")
    expect(trials.get(OWNER)).toBe(OTHER_GROUP)
  })

  it("gives the owner's trial to the first group they check out, and again to that group only", async () => {
    const { recorder, call, trials } = stack()

    await call(OWNER, "POST", "/checkout", { planId: "pro" })
    await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(trials.get(OWNER)).toBe(groupId)
    expect(recorder.checkouts.map((checkout) => checkout.trialDays)).toEqual([14, 14])
  })

  it("leaves the trial of a member whose checkout is refused unused", async () => {
    const { call, trials } = stack()

    await call(ADMIN, "POST", "/checkout", { planId: "pro" })

    expect(trials.has(ADMIN)).toBe(false)
  })

  it("tells a person whether their trial is used and by which group, and nothing of trials while billing is off", async () => {
    const fresh = await stack().call(VIEWER, "GET", "/billing/trial")
    const used = await stack({ trialGroup: OTHER_GROUP }).call(OWNER, "GET", "/billing/trial")
    const off = await stack({ enabled: false, trialGroup: OTHER_GROUP }).call(
      OWNER,
      "GET",
      "/billing/trial",
    )

    expect(await fresh.json()).toEqual({
      trial: { enabled: true, used: false, groupId: null, days: 14 },
    })
    expect(await used.json()).toEqual({
      trial: { enabled: true, used: true, groupId: OTHER_GROUP, days: 14 },
    })
    expect(await off.json()).toEqual({
      trial: { enabled: false, used: false, groupId: null, days: 0 },
    })
  })

  it("asks for a card to start a trial unless the setup says a trial needs none", async () => {
    const withCard = stack()
    const withoutCard = stack({ trialRequiresCard: false })

    await withCard.call(OWNER, "POST", "/checkout", { planId: "pro" })
    await withoutCard.call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(withCard.recorder.checkouts[0]).not.toHaveProperty("trialWithoutPaymentMethod")
    expect(withoutCard.recorder.checkouts[0]).toMatchObject({
      trialDays: 14,
      trialWithoutPaymentMethod: true,
    })
  })

  it("tells the owner, and no one else, that the trial ends soon", async () => {
    const trialEnd = new Date("2026-10-03T10:00:00Z")
    const { call } = stack({
      subscription: {
        ...PRO,
        status: BillingStatus.Trialing,
        trialEnd,
        currentPeriodEnd: trialEnd,
      },
    })

    const owner = await (await call(OWNER, "GET", "")).json()
    const admin = await (await call(ADMIN, "GET", "")).json()

    expect(owner.billing).toMatchObject({
      planId: "pro",
      trialEnd: trialEnd.toISOString(),
      notice: { kind: BillingNoticeKind.TrialEnding, at: trialEnd.toISOString(), daysLeft: 2 },
    })
    expect(admin.billing).toMatchObject({ trialEnd: trialEnd.toISOString(), notice: null })
  })

  it("refuses a checkout for the free plan or an unknown one", async () => {
    const { recorder, call } = stack()

    const free = await call(OWNER, "POST", "/checkout", { planId: "free" })
    const unknown = await call(OWNER, "POST", "/checkout", { planId: "gold" })

    expect([free.status, await code(free)]).toEqual([400, "UNKNOWN_PLAN"])
    expect([unknown.status, await code(unknown)]).toEqual([400, "UNKNOWN_PLAN"])
    expect(recorder.checkouts).toEqual([])
  })

  it("refuses a second checkout while the group pays", async () => {
    const { recorder, call } = stack({ subscription: PRO, customer: "cus_1" })

    const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect([response.status, await code(response)]).toEqual([409, "ALREADY_SUBSCRIBED"])
    expect(recorder.checkouts).toEqual([])
  })

  for (
    const [name, subscription] of [
      ["paused", { ...PRO, status: BillingStatus.Paused }],
      ["incomplete", { ...PRO, status: BillingStatus.Incomplete }],
      ["on a price no plan maps to", { ...PRO, planId: null }],
    ] as const
  ) {
    it(`refuses a second checkout while the group's subscription is ${name}, though it shows as free`, async () => {
      const { recorder, call } = stack({ subscription, customer: "cus_1" })

      const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

      expect([response.status, await code(response)]).toEqual([409, "ALREADY_SUBSCRIBED"])
      expect(recorder.checkouts).toEqual([])
    })
  }

  it("opens a new checkout once the group's subscription is cancelled", async () => {
    const { recorder, call } = stack({
      subscription: { ...PRO, status: BillingStatus.Canceled },
      customer: "cus_1",
    })

    const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(response.status).toBe(200)
    expect(recorder.checkouts).toHaveLength(1)
  })

  it("scopes the client's idempotency key to the group and the owner", async () => {
    const { recorder, call } = stack()

    await call(OWNER, "POST", "/checkout", { planId: "pro" }, { "idempotency-key": "key-1" })

    expect(recorder.checkouts[0].idempotencyKey).toBe(`${groupId}:${OWNER}:key-1`)
  })

  it("tells the owner whether the group has a live subscription and a customer", async () => {
    const paused = stack({ subscription: { ...PRO, status: BillingStatus.Paused }, customer: "c" })
    const lapsed = stack({
      subscription: { ...PRO, status: BillingStatus.Canceled },
      customer: "c",
    })

    const live = await (await paused.call(OWNER, "GET", "")).json()
    const ended = await (await lapsed.call(OWNER, "GET", "")).json()

    expect(live.billing).toMatchObject({ planId: "free", subscribed: true, hasCustomer: true })
    expect(ended.billing).toMatchObject({ planId: "free", subscribed: false, hasCustomer: true })
  })

  it("opens the owner's portal for the group's customer, back to its Plan and billing tab", async () => {
    const { recorder, call } = stack({ subscription: PRO, customer: "cus_1" })

    const response = await call(OWNER, "POST", "/portal")

    expect(await response.json()).toEqual({ url: "https://pay.example/p" })
    expect(recorder.portals).toEqual([{
      customerId: "cus_1",
      returnUrl: `https://app.example.com/groups/${groupId}/billing`,
    }])
  })

  describe("after a transfer of ownership", () => {
    /** The old owner's subscription, cancelled at the end of its period, as a transfer needs it. */
    const ENDING: StoredSubscription = { ...PRO, cancelAtPeriodEnd: true }

    it("opens the new owner's checkout with a new customer and a trial until the old period ends", async () => {
      // A setup that starts trials without a card still asks the new owner for one.
      const { recorder, call } = stack({
        subscription: ENDING,
        handedOver: true,
        trialRequiresCard: false,
        members: 2,
      })

      const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

      expect(response.status).toBe(200)
      // From 2026-10-01T10:00 to 2026-11-01T00:00 is 30 days and 14 hours: 31 whole days.
      expect(recorder.checkouts).toEqual([{
        planId: "pro",
        successUrl: `https://app.example.com/groups/${groupId}/billing?checkout=done`,
        cancelUrl: `https://app.example.com/groups/${groupId}/billing`,
        reference: groupId,
        quantity: 2,
        trialDays: 31,
      }])
    })

    it("refuses the new owner's checkout while the old owner's subscription still renews", async () => {
      const { recorder, call } = stack({ subscription: PRO, handedOver: true })

      const response = await call(OWNER, "POST", "/checkout", { planId: "pro" })

      expect([response.status, await code(response)]).toEqual([409, "ALREADY_SUBSCRIBED"])
      expect(recorder.checkouts).toEqual([])
    })

    it("opens a checkout with no trial once the old owner's subscription has ended", async () => {
      const { recorder, call } = stack({
        subscription: { ...ENDING, status: BillingStatus.Canceled },
        handedOver: true,
      })

      await call(OWNER, "POST", "/checkout", { planId: "pro" })

      expect(recorder.checkouts).toHaveLength(1)
      expect(recorder.checkouts[0]).not.toHaveProperty("trialDays")
      expect(recorder.checkouts[0]).not.toHaveProperty("customerId")
    })

    it("shows the new owner the plan, a checkout and no portal, notice or old customer", async () => {
      const { recorder, call } = stack({ subscription: ENDING, handedOver: true })

      const owner = await (await call(OWNER, "GET", "")).json()
      const portal = await call(OWNER, "POST", "/portal")

      expect(owner.billing).toMatchObject({
        planId: "pro",
        subscribed: false,
        hasCustomer: false,
        notice: null,
      })
      expect([portal.status, await code(portal)]).toEqual([409, "NO_SUBSCRIPTION"])
      expect(recorder.portals).toEqual([])
    })
  })

  it("refuses the portal of a group that never paid", async () => {
    const { call } = stack()

    const response = await call(OWNER, "POST", "/portal")

    expect([response.status, await code(response)]).toEqual([409, "NO_SUBSCRIPTION"])
  })

  it("shows every member the plan, and only the owner may manage it", async () => {
    const { call } = stack({ subscription: PRO })

    const owner = await (await call(OWNER, "GET", "")).json()
    const viewer = await (await call(VIEWER, "GET", "")).json()

    expect(owner.billing).toMatchObject({ enabled: true, planId: "pro", canManage: true })
    expect(viewer.billing).toMatchObject({ enabled: true, planId: "pro", canManage: false })
  })

  it("tells every member the per-member price and how many members the group pays for", async () => {
    const { call } = stack({ subscription: PRO, members: 4 })

    const viewer = await (await call(VIEWER, "GET", "")).json()

    expect(viewer.billing.seatPrice).toEqual({ seats: 4, amount: 900, currency: "EUR" })
  })

  it("shows a past-due group its plan through the seven-day grace period, then the free plan", async () => {
    const pastDue = { ...PRO, status: BillingStatus.PastDue, pastDueSince: NOW }
    const plan = async (now: Date) =>
      (await (await stack({ subscription: pastDue, now }).call(OWNER, "GET", "")).json())
        .billing.planId

    expect(await plan(new Date("2026-10-08T09:59:59.999Z"))).toBe("pro")
    expect(await plan(new Date("2026-10-08T10:00:00Z"))).toBe("free")
  })

  it("keeps every group on the free plan when billing is off, and answers checkout with 404", async () => {
    const { call } = stack({ subscription: PRO, enabled: false })

    const read = await (await call(OWNER, "GET", "")).json()
    const checkout = await call(OWNER, "POST", "/checkout", { planId: "pro" })

    expect(read.billing).toEqual({
      enabled: false,
      planId: "free",
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEnd: null,
      notice: null,
      canManage: false,
      subscribed: false,
      hasCustomer: false,
      seatPrice: null,
    })
    expect([checkout.status, await code(checkout)]).toEqual([404, "BILLING_DISABLED"])
  })

  it("refuses a cross-site checkout before it reaches the handler", async () => {
    const { recorder } = stack()
    const app = new Hono<APIContext>()
    app.use("*", async (c, next) => {
      c.set("requestId", "req-billing")
      c.set("auth", buildAuthData({ user: { id: OWNER }, session: { userId: OWNER } }))
      await next()
    })
    app.route(
      "/groups/:groupId/billing",
      createBillingRoute({
        get: () => Promise.reject(new Error("not reached")),
        checkout: () => Promise.reject(new Error("not reached")),
        portal: () => Promise.reject(new Error("not reached")),
        expectedOrigin: "http://local",
      }),
    )

    const response = await app.request(`http://local/groups/${groupId}/billing/checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ planId: "pro" }),
    })

    expect([response.status, await code(response)]).toEqual([403, "REQUEST_ORIGIN_INVALID"])
    expect(recorder.checkouts).toEqual([])
  })
})
