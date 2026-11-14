import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { BillingStatus, type Plan, PRO_PLAN_ID, toGroupBilling } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { GROUP_PATHS, NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { type Landing, landingPath } from "./HomeView.tsx"
import { TEST_PLANS, testLimits } from "../../../../libs/domain/billing/test-plans.ts"

const NOW = new Date("2026-11-04T10:00:00Z")
const [FREE, PRO] = TEST_PLANS

/** A catalog whose free plan allows nothing, as a product paid from sign-up sets it. */
const PAID_FROM_SIGN_UP: Plan[] = [
  {
    ...FREE,
    entitlements: {
      ...FREE.entitlements,
      limits: testLimits(0, { maxMembers: 1 }),
    },
  },
  PRO,
]

const never = toGroupBilling(null, GroupRole.OWNER, true, false, NOW, 7, 1, false, TEST_PLANS)
const paying = toGroupBilling(
  {
    groupId: "g",
    providerSubscriptionId: "sub_1",
    planId: PRO_PLAN_ID,
    status: BillingStatus.Active,
    currentPeriodEnd: new Date("2026-12-04T10:00:00Z"),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    trialEnd: null,
    quantity: 1,
    period: null,
    everActive: true,
  },
  GroupRole.OWNER,
  true,
  true,
  NOW,
  7,
  1,
  false,
  TEST_PLANS,
)

/** A new owner, signed in, alone in the first group sign-up gave them. */
const owner = (changes: Partial<Landing> = {}): Landing => ({
  signedIn: true,
  guest: false,
  groups: [{ id: "g", role: GroupRole.OWNER }],
  selectedGroupId: "g",
  billing: never,
  plans: PAID_FROM_SIGN_UP,
  ...changes,
})

describe("landingPath", () => {
  it("sends a new owner to the plan when the free plan allows nothing", () => {
    expect(landingPath(owner())).toBe(GROUP_PATHS.billing("g"))
  })

  it("opens the notes at once when the free plan allows something", () => {
    expect(landingPath(owner({ plans: TEST_PLANS, groups: null, billing: undefined })))
      .toBe(NOTE_PATHS.list)
  })

  it("never sends a member who joined someone else's group to the plan", () => {
    // Sign-up through an invitation still gives the person an empty first group of their own.
    const invited = owner({
      groups: [{ id: "g", role: GroupRole.OWNER }, { id: "family", role: GroupRole.VIEWER }],
    })
    expect(landingPath(invited)).toBe(NOTE_PATHS.list)
    expect(landingPath({ ...invited, selectedGroupId: "family" })).toBe(NOTE_PATHS.list)
  })

  it("never sends a guest to the plan", () => {
    expect(landingPath(owner({ guest: true }))).toBe(NOTE_PATHS.list)
  })

  it("opens the notes once the group pays, or when its billing cannot be read", () => {
    expect(landingPath(owner({ billing: paying }))).toBe(NOTE_PATHS.list)
    expect(landingPath(owner({ billing: null }))).toBe(NOTE_PATHS.list)
  })

  it("still sends a new owner to the plan when the notes are off", () => {
    expect(landingPath(owner({ notes: false }))).toBe(GROUP_PATHS.billing("g"))
  })

  it("waits for the groups, the selection and the billing", () => {
    expect(landingPath(owner({ groups: null }))).toBeNull()
    expect(landingPath(owner({ selectedGroupId: null }))).toBeNull()
    expect(landingPath(owner({ billing: undefined }))).toBeNull()
  })

  it("sends a signed-out visitor to sign-in, and a person with no group to the notes", () => {
    expect(landingPath(owner({ signedIn: false }))).toBe(SCREEN_PATHS.signIn)
    expect(landingPath(owner({ groups: [], selectedGroupId: null }))).toBe(NOTE_PATHS.list)
  })
})
