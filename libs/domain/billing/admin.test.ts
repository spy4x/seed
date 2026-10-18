import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  adminBillingActionRefusal,
  adminBillingCancelSchema,
  type AdminBillingCustomer,
  adminBillingFilterQuery,
  adminBillingRefundSchema,
  AdminBillingState,
  adminBillingStatus,
  adminBillingTimeSchema,
  BILLING_AUDIT_EVENT_TYPES,
  billingAuditIdentifier,
  billingAuditPrefix,
  BillingStatus,
  monthlyRevenue,
  noChargeUntil,
  parseAdminBillingFilter,
  PRO_PLAN_ID,
  readBillingAuditIdentifier,
} from "./+lib.ts"
import { type } from "arktype"

const NOW = new Date(`2026-10-17T12:00:00.000Z`)

function customer(overrides: Partial<AdminBillingCustomer> = {}): AdminBillingCustomer {
  return {
    groupId: `0199f0a0-0000-7000-8000-000000000001`,
    groupName: `Acme`,
    groupDeletedAt: null,
    owner: { id: 1, name: `Ann`, email: `ann@example.com` },
    planId: PRO_PLAN_ID,
    status: BillingStatus.Active,
    quantity: 1,
    currentPeriodEnd: `2026-11-12T00:00:00.000Z`,
    cancelAtPeriodEnd: false,
    trialEnd: null,
    pastDueSince: null,
    everActive: true,
    updatedAt: `2026-10-12T00:00:00.000Z`,
    ...overrides,
  }
}

describe(`admin billing filter`, () => {
  it(`shows paying customers on page one when the address names nothing`, () => {
    expect(parseAdminBillingFilter(new URLSearchParams())).toEqual({
      query: ``,
      status: `paying`,
      page: 1,
    })
  })

  it(`falls back to the default for a status or page it does not know`, () => {
    const filter = parseAdminBillingFilter(new URLSearchParams(`status=gold&page=-3`))
    expect(filter.status).toBe(`paying`)
    expect(filter.page).toBe(1)
  })

  it(`round-trips a filter through the query string, leaving defaults out`, () => {
    const filter = { query: `acme`, status: `trial` as const, page: 2 }
    const query = adminBillingFilterQuery(filter)
    expect(query).toBe(`q=acme&status=trial&page=2`)
    expect(parseAdminBillingFilter(new URLSearchParams(query))).toEqual(filter)
    expect(adminBillingFilterQuery({ query: ``, status: `paying`, page: 1 })).toBe(``)
  })
})

describe(`monthly revenue`, () => {
  it(`counts seats of active and past-due subscriptions, and nothing for trials or cancelled`, () => {
    const revenue = monthlyRevenue([
      { planId: PRO_PLAN_ID, quantity: 3, status: BillingStatus.Active },
      { planId: PRO_PLAN_ID, quantity: null, status: BillingStatus.PastDue },
      { planId: PRO_PLAN_ID, quantity: 5, status: BillingStatus.Trialing },
      { planId: PRO_PLAN_ID, quantity: 2, status: BillingStatus.Canceled },
      { planId: null, quantity: 9, status: BillingStatus.Active },
    ])
    expect(revenue).toEqual([{ amount: 900 * 4, currency: `EUR` }])
  })
})

describe(`status word and key date`, () => {
  it(`says an active subscription renews, and ends once it is set to cancel`, () => {
    expect(adminBillingStatus(customer(), NOW, 7)).toEqual({
      state: AdminBillingState.Active,
      date: { kind: `renews`, at: `2026-11-12T00:00:00.000Z` },
    })
    expect(adminBillingStatus(customer({ cancelAtPeriodEnd: true }), NOW, 7).date?.kind).toBe(
      `ends`,
    )
  })

  it(`says until when a past-due group keeps its plan, then since when it is on Free`, () => {
    const pastDue = customer({
      status: BillingStatus.PastDue,
      pastDueSince: `2026-10-15T00:00:00.000Z`,
    })
    expect(adminBillingStatus(pastDue, NOW, 7)).toEqual({
      state: AdminBillingState.PastDue,
      date: { kind: `plan_kept_until`, at: `2026-10-22T00:00:00.000Z` },
    })
    expect(adminBillingStatus(pastDue, new Date(`2026-10-23T00:00:00.000Z`), 7).date?.kind).toBe(
      `on_free_since`,
    )
  })

  it(`says a past-due group cancelled at a period's end before its grace end keeps it until then`, () => {
    const ending = customer({
      status: BillingStatus.PastDue,
      pastDueSince: `2026-11-08T00:00:00.000Z`,
      cancelAtPeriodEnd: true,
    })
    // Grace would run to Nov 15; the period ends on Nov 12, and the plan with it.
    expect(adminBillingStatus(ending, new Date(`2026-11-10T00:00:00.000Z`), 7).date).toEqual({
      kind: `plan_kept_until`,
      at: `2026-11-12T00:00:00.000Z`,
    })
  })

  it(`shows a trial's end date`, () => {
    const trial = customer({
      status: BillingStatus.Trialing,
      trialEnd: `2026-10-30T00:00:00.000Z`,
    })
    expect(adminBillingStatus(trial, NOW, 7)).toEqual({
      state: AdminBillingState.Trial,
      date: { kind: `trial_ends`, at: `2026-10-30T00:00:00.000Z` },
    })
  })
})

describe(`time at no charge`, () => {
  it(`adds the length after the paid period of an active subscription`, () => {
    expect(noChargeUntil(customer(), `30d`, NOW).toISOString()).toBe(`2026-12-12T00:00:00.000Z`)
  })

  it(`adds the length after a trial's end, and counts from now when that end has passed`, () => {
    const trial = customer({ status: BillingStatus.Trialing, trialEnd: `2026-10-30T00:00:00.000Z` })
    expect(noChargeUntil(trial, `1m`, NOW).toISOString()).toBe(`2026-11-30T00:00:00.000Z`)
    const ended = { ...trial, trialEnd: `2026-10-01T00:00:00.000Z` }
    expect(noChargeUntil(ended, `7d`, NOW).toISOString()).toBe(`2026-10-24T12:00:00.000Z`)
  })

  it(`counts from now for a past-due subscription`, () => {
    const pastDue = customer({ status: BillingStatus.PastDue })
    expect(noChargeUntil(pastDue, `14d`, NOW).toISOString()).toBe(`2026-10-31T12:00:00.000Z`)
  })
})

describe(`action refusals`, () => {
  it(`refuses to cancel or give time to a cancelled subscription`, () => {
    const cancelled = customer({ status: BillingStatus.Canceled })
    expect(adminBillingActionRefusal(`cancel_now`, cancelled)).not.toBeNull()
    expect(adminBillingActionRefusal(`cancel_period_end`, cancelled)).not.toBeNull()
    expect(adminBillingActionRefusal(`time`, cancelled)).not.toBeNull()
  })

  it(`allows undo only while a cancellation waits for the period's end`, () => {
    expect(adminBillingActionRefusal(`undo`, customer())).not.toBeNull()
    expect(adminBillingActionRefusal(`undo`, customer({ cancelAtPeriodEnd: true }))).toBeNull()
    expect(adminBillingActionRefusal(`cancel_period_end`, customer({ cancelAtPeriodEnd: true })))
      .not.toBeNull()
  })
})

describe(`action bodies`, () => {
  it(`accepts a UUID idempotency key and refuses anything else`, () => {
    expect(adminBillingTimeSchema({ idempotencyKey: uuidV7(), length: `7d` })).not.toBeInstanceOf(
      type.errors,
    )
    expect(adminBillingTimeSchema({ idempotencyKey: `retry-1`, length: `7d` })).toBeInstanceOf(
      type.errors,
    )
  })

  it(`refuses a note longer than the audit row can hold, and unknown fields`, () => {
    const key = uuidV7()
    expect(adminBillingCancelSchema({ idempotencyKey: key, when: `now`, note: `x`.repeat(201) }))
      .toBeInstanceOf(type.errors)
    expect(adminBillingRefundSchema({ idempotencyKey: key, paymentId: `pi_1`, amount: 1 }))
      .toBeInstanceOf(type.errors)
  })
})

describe(`audit event numbers`, () => {
  it(`continue the account audit log from 25, one per action`, () => {
    expect(BILLING_AUDIT_EVENT_TYPES).toEqual([25, 26, 27, 28, 29])
  })
})

describe(`billing audit identifier`, () => {
  it(`reads back every fact it wrote, the note last with any text`, () => {
    const facts = {
      groupId: `0199f0a0-0000-7000-8000-000000000001`,
      objectId: `pi_123`,
      amount: { amount: 900, currency: `EUR`, decimals: 2 },
      until: `2026-11-30T00:00:00.000Z`,
      note: `asked by mail: note: "x"`,
    }
    expect(readBillingAuditIdentifier(billingAuditIdentifier(facts))).toEqual(facts)
  })

  it(`cuts a long note so the identifier fits its column`, () => {
    const identifier = billingAuditIdentifier({
      groupId: `0199f0a0-0000-7000-8000-000000000001`,
      objectId: `sub_${`x`.repeat(200)}`,
      note: `n`.repeat(200),
    })
    expect(identifier.length).toBe(320)
    expect(identifier.startsWith(billingAuditPrefix(`0199f0a0-0000-7000-8000-000000000001`)))
      .toBe(true)
  })
})
