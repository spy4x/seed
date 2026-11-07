import { FREE_PLAN_ID, type LimitKey, type Plan, PRO_PLAN_ID, UNLIMITED } from "./+lib.ts"

type Limits = Record<LimitKey, number | null>

/**
 * Plan limits with every key the product defines (`UNLIMITED.limits`) set to `value`, then
 * `overrides`. A test spells out only the caps it is about, so a product that adds a limit key
 * edits no test of Seed's: `testLimits(0, { maxMembers: 1 })` is a free plan that allows nothing.
 */
export function testLimits(value: number | null, overrides: Partial<Limits> = {}): Limits {
  const limits = Object.fromEntries(Object.keys(UNLIMITED.limits).map((key) => [key, value]))
  return { ...limits, ...overrides } as Limits
}

/**
 * The entitlement gate's usage counts for a test: `counts`, and for every other limit key the
 * product defines a count that fails the test if the gate ever reads it.
 */
export function testUsage(
  counts: Partial<Record<LimitKey, (groupId: string) => Promise<number>>> = {},
): Record<LimitKey, (groupId: string) => Promise<number>> {
  const unread = () => Promise.reject(new Error("not part of this test"))
  const usage = Object.fromEntries(Object.keys(UNLIMITED.limits).map((key) => [key, unread]))
  return { ...usage, ...counts } as Record<LimitKey, (groupId: string) => Promise<number>>
}

/**
 * The plan catalog Seed's tests run on, whatever `PLANS` a product sells: a free plan with small
 * caps and a paid plan billed per member, with a trial. A test that needs a price or a cap reads it
 * from here, and passes this catalog where the code reads `PLANS`, so a product edits `PLANS` and
 * keeps every test passing (`docs/billing-plans.md`, "Replace the catalog in a product"). A limit
 * key the product adds is no cap on either plan here.
 *
 * No production code imports this file.
 */
export const TEST_FREE_PLAN: Plan = {
  id: FREE_PLAN_ID,
  name: "Free",
  amount: 0,
  yearlyAmount: null,
  currency: "EUR",
  description: "For trying things out.",
  features: ["Up to 10 notes", "Up to 3 members", "100 files, 200 MB in all"],
  entitlements: {
    features: { memberRoles: false },
    limits: testLimits(null, {
      maxMembers: 3,
      maxNotes: 10,
      maxAttachments: 100,
      storageBytes: 200 * 1024 * 1024,
    }),
  },
  attachments: { maxFileBytes: 2 * 1024 * 1024, maxPerNote: 10 },
  trialDays: 0,
  perSeat: false,
}

/** The test catalog's paid plan: per member, with a trial. */
export const TEST_PRO_PLAN: Plan = {
  id: PRO_PLAN_ID,
  name: "Pro",
  amount: 900,
  yearlyAmount: null,
  currency: "EUR",
  description: "For a group that relies on it.",
  features: [
    "Billed per member, the owner included",
    "Unlimited notes",
    "Unlimited files, 10 GB in all",
    "Up to 50 members",
    "Promote members to editor or admin",
  ],
  entitlements: {
    features: { memberRoles: true },
    limits: testLimits(null, { maxMembers: 50, storageBytes: 10 * 1024 * 1024 * 1024 }),
  },
  attachments: { maxFileBytes: 2 * 1024 * 1024, maxPerNote: 10 },
  trialDays: 14,
  perSeat: true,
}

/** Every plan of the test catalog, free first, as `PLANS` is. */
export const TEST_PLANS: readonly Plan[] = [TEST_FREE_PLAN, TEST_PRO_PLAN]

/** The test catalog's paid plans, as `PAID_PLANS` is. */
export const TEST_PAID_PLANS: readonly Plan[] = [TEST_PRO_PLAN]
