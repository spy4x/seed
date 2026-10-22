import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createEnvReader } from "@spy4x/server/config"
import { GroupRole } from "@domain/groups"
import { BillingGetQuery, BillingStatus, type StoredSubscription } from "@domain/billing"
import { readBillingSetup } from "@server/billing/setup.ts"
import { billingSettingsOf, createPlanOf, createSeatPriced } from "./config.ts"
import { createBillingGetHandler } from "./handlers.ts"

describe("billing configuration", () => {
  it("hands the billing handlers the trial card setting the setup read", () => {
    const settings = (value: string) =>
      billingSettingsOf(
        readBillingSetup(createEnvReader({ BILLING_TRIAL_REQUIRES_CARD: value }), "dev", {
          webhooks: true,
        }),
      )

    expect(settings("false").trialRequiresCard).toBe(false)
    expect(settings("true").trialRequiresCard).toBe(true)
  })

  describe("the API's plan clock, as the command bus and the billing read are wired", () => {
    const DAY = 24 * 60 * 60 * 1000
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
    /** A Pro subscription whose first payment failed `days` days before the system clock's now. */
    const pastDue = (days: number) => ({
      get: () =>
        Promise.resolve<StoredSubscription>({
          groupId,
          providerSubscriptionId: "sub_1",
          planId: "pro",
          status: BillingStatus.PastDue,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          pastDueSince: new Date(Date.now() - days * DAY),
          trialEnd: null,
          quantity: 1,
          everActive: true,
        }),
    })
    const setup = (graceDays?: string) =>
      readBillingSetup(
        createEnvReader(graceDays === undefined ? {} : { BILLING_GRACE_DAYS: graceDays }),
        "dev",
        { webhooks: true },
      )
    const billingRead = async (days: number, graceDays?: string) => {
      const configured = setup(graceDays)
      const handler = createBillingGetHandler({
        billing: {
          ...pastDue(days),
          lockedRoleOf: () => Promise.resolve(null),
          customerOf: () => Promise.resolve("cus_1"),
          membersOf: () => Promise.resolve(1),
          handedOver: () => Promise.resolve(false),
          claimTrial: () => Promise.resolve(true),
          trialGroupOf: () => Promise.resolve(null),
        },
        groups: { roleOf: () => Promise.resolve(GroupRole.OWNER) },
        provider: configured.provider,
        webAppUrl: "https://app.example.com",
        log: () => {},
        ...billingSettingsOf(configured),
      })
      const actor = { userId: 1 } as BillingGetQuery["data"]["actor"]
      return (await handler(new BillingGetQuery({ actor, groupId }))).billing.planId
    }

    it("gives the plan check the free plan for a group past due for eight days", async () => {
      expect(await createPlanOf(pastDue(8), setup())(groupId)).toBe("free")
      expect(await createPlanOf(pastDue(1), setup())(groupId)).toBe("pro")
    })

    it("gives the plan check the grace period the setup read", async () => {
      expect(await createPlanOf(pastDue(8), setup("10"))(groupId)).toBe("pro")
    })

    it("shows the billing read the free plan for a group past due for eight days", async () => {
      expect(await billingRead(8)).toBe("free")
      expect(await billingRead(1)).toBe("pro")
      expect(await billingRead(8, "10")).toBe("pro")
    })
  })

  describe("the price confirmation a new invitation needs", () => {
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
    const subscription = (planId: string, status: BillingStatus): StoredSubscription => ({
      groupId,
      providerSubscriptionId: "sub_1",
      planId,
      status,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      pastDueSince: null,
      trialEnd: null,
      quantity: 2,
      everActive: true,
    })
    const seatPriced = (
      stored: StoredSubscription | null,
      role: GroupRole | null,
      enabled = true,
    ) =>
      createSeatPriced(
        { get: () => Promise.resolve(stored) },
        () => Promise.resolve(role),
        enabled,
      )(groupId, 1)

    it("asks the owner and an admin of a group on a live per-member plan", async () => {
      const pro = subscription("pro", BillingStatus.Active)
      expect(await seatPriced(pro, GroupRole.OWNER)).toBe(true)
      expect(await seatPriced(pro, GroupRole.ADMIN)).toBe(true)
      expect(await seatPriced(subscription("pro", BillingStatus.PastDue), GroupRole.OWNER))
        .toBe(true)
    })

    it("asks nobody when billing is off, the group pays nothing or the plan is canceled", async () => {
      const pro = subscription("pro", BillingStatus.Active)
      expect(await seatPriced(pro, GroupRole.OWNER, false)).toBe(false)
      expect(await seatPriced(null, GroupRole.OWNER)).toBe(false)
      expect(await seatPriced(subscription("pro", BillingStatus.Canceled), GroupRole.OWNER))
        .toBe(false)
    })

    it("tells a viewer, an editor or a stranger nothing of the group's bill", async () => {
      const pro = subscription("pro", BillingStatus.Active)
      expect(await seatPriced(pro, GroupRole.EDITOR)).toBe(false)
      expect(await seatPriced(pro, GroupRole.VIEWER)).toBe(false)
      expect(await seatPriced(pro, null)).toBe(false)
    })
  })
})
