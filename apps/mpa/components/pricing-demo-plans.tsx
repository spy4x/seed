import type { JSX } from "preact"
import { FREE_PLAN_ID, PLANS, PRO_PLAN_ID } from "@domain/billing"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { BillingInterval, type PricingPlan, PricingTable } from "@spy4x/preact-ui/billing"
import { Notice } from "@spy4x/preact-ui/notice"
import { code, useSite } from "../use-site.tsx"
import { Band } from "./band.tsx"
import { SectionIntro } from "./section-intro.tsx"

/**
 * The website's words for the demo's plans, by plan id, as keys of the `site` catalog: the plan
 * catalog (`PLANS`) is the app's data, in English. A plan with no entry here, as when a product
 * changes `PLANS`, shows its catalog's own words.
 */
const PLAN_TEXT: Readonly<Record<string, { description: string; features: readonly string[] }>> = {
  [FREE_PLAN_ID]: {
    description: `DemoPlan.freeDescription`,
    features: [`DemoPlan.freeNotes`, `DemoPlan.freeMembers`, `DemoPlan.freeFiles`],
  },
  [PRO_PLAN_ID]: {
    description: `DemoPlan.proDescription`,
    features: [
      `DemoPlan.proBilled`,
      `DemoPlan.proNotes`,
      `DemoPlan.proFiles`,
      `DemoPlan.proMembers`,
      `DemoPlan.proRoles`,
    ],
  },
}

/**
 * The demo app's plans, read from its catalog: a product that changes `PLANS` changes this list.
 * A plan with a trial says so first.
 */
function demoPlans(t: Translator<string>): PricingPlan[] {
  return PLANS.map((plan) => {
    const text = PLAN_TEXT[plan.id]
    const features = text && text.features.length === plan.features.length
      ? text.features.map((key) => t.t(key))
      : plan.features
    return {
      id: plan.id,
      name: plan.name,
      amount: plan.amount,
      currency: plan.currency,
      interval: BillingInterval.Month,
      description: text ? t.t(text.description) : plan.description,
      features: plan.trialDays > 0
        ? [t.t(`DemoPlans.trial`, { count: plan.trialDays }), ...features]
        : [...features],
      highlighted: plan.amount > 0,
      unit: plan.perSeat ? t.t(`DemoPlans.member`) : undefined,
    }
  })
}

/**
 * The demo app's plans as an example of the billing Seed ships, kept apart from Seed's own prices.
 * Each plan's button is a form that posts to `/pricing` in the page's language, which opens the
 * demo as a guest account (#224), so it works without JavaScript.
 */
export function PricingDemoPlans(): JSX.Element {
  const { t, href, rich } = useSite()
  return (
    <Band tone="alt" id="demo-plans" labelledBy="demo-plans-title">
      <div class="flex flex-col gap-8">
        <SectionIntro
          id="demo-plans-title"
          eyebrow={t.t(`DemoPlans.eyebrow`)}
          title={t.t(`DemoPlans.title`)}
        />
        <Notice title={t.t(`DemoPlans.noticeTitle`)}>{rich(`DemoPlans.notice`, { code })}</Notice>
        {/* The table draws its own forms: `/analytics.js` counts a submit inside this wrapper. */}
        <div data-analytics-submit="pricing-plan" data-analytics-field="planId">
          <PricingTable
            plans={demoPlans(t)}
            action={href(`/pricing`)}
            headingLevel={3}
            labels={{
              choose: t.t(`DemoPlans.choose`),
              // The name starts with the visible text, so speech input ("click Try in the demo")
              // finds the button, and the plan tells the buttons apart.
              chooseName: (name) => t.t(`DemoPlans.chooseName`, { name }),
              highlighted: t.t(`DemoPlans.recommended`),
            }}
          />
        </div>
        <p class="text-sm text-muted">{t.t(`DemoPlans.start`)}</p>
      </div>
    </Band>
  )
}
