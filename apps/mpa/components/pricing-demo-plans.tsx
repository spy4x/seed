import type { JSX } from "preact"
import { PLANS } from "@domain/billing"
import { BillingInterval, type PricingPlan, PricingTable } from "@spy4x/preact-ui/billing"
import { Notice } from "@spy4x/preact-ui/notice"
import { Band } from "./band.tsx"
import { SectionIntro } from "./section-intro.tsx"

/**
 * The demo app's plans, read from its catalog: a product that changes `PLANS` changes this list.
 * A plan with a trial says so first.
 */
const DEMO_PLANS: PricingPlan[] = PLANS.map((plan) => ({
  id: plan.id,
  name: plan.name,
  amount: plan.amount,
  currency: plan.currency,
  interval: BillingInterval.Month,
  description: plan.description,
  features: plan.trialDays > 0
    ? [`The first ${plan.trialDays} days free`, ...plan.features]
    : [...plan.features],
  highlighted: plan.amount > 0,
  unit: plan.perSeat ? `member` : undefined,
}))

/**
 * The demo app's plans as an example of the billing Seed ships, kept apart from Seed's own prices.
 * Each plan's button is a form that posts to `/pricing`, which sends the visitor to the demo's
 * sign-up, so it works without JavaScript.
 */
export function PricingDemoPlans(): JSX.Element {
  return (
    <Band tone="alt" id="demo-plans" labelledBy="demo-plans-title">
      <div class="flex flex-col gap-8">
        <SectionIntro
          id="demo-plans-title"
          eyebrow="Billing, working"
          title="The demo's plans: an example of the billing you get"
        />
        <Notice title="These are not Seed's prices">
          They are the plans of the demo app, read from its plan catalog, so you can try checkout,
          trials and per-member billing. Your product sets its own plans in one file,{" "}
          <code class="font-mono">libs/domain/billing</code>.
        </Notice>
        <PricingTable
          plans={DEMO_PLANS}
          action="/pricing"
          headingLevel={3}
          labels={{
            choose: `Try in the demo`,
            chooseName: (name) => `Try ${name} in the demo`,
            highlighted: `Recommended`,
          }}
        />
        <p class="text-sm text-muted">
          In the demo you start on Free and change the plan on your group's billing page.
        </p>
      </div>
    </Band>
  )
}
