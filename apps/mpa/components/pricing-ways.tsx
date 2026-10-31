// Seed's own site: see docs/start-a-product.md
import type { ComponentChildren, JSX } from "preact"
import { IconExternalLink, IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { REPOSITORY_URL } from "../brand.ts"
import { HIRE_PAGE_URL, HIRE_PRICES } from "../hire.ts"
import { useSite } from "../use-site.tsx"
import { Band } from "./band.tsx"
import { SectionIntro } from "./section-intro.tsx"

interface WayCardProps {
  id: string
  title: string
  /** The price, set large. */
  price: string
  /** What the price is per, or what sets it, under the price. */
  unit: string
  /** The card of the offer a founder is sent to, drawn in the accent colour. */
  highlighted?: boolean
  /** The card's one button. */
  action: ComponentChildren
  children: ComponentChildren
}

function WayCard(
  { id, title, price, unit, highlighted = false, action, children }: WayCardProps,
): JSX.Element {
  return (
    <article
      aria-labelledby={id}
      class={`flex flex-col gap-4 rounded-card border bg-surface p-6 ${
        highlighted ? "border-primary" : "border-subtle"
      }`}
      data-e2e={id}
    >
      <h3 id={id} class="text-lg font-semibold">{title}</h3>
      <p class="flex flex-col gap-1">
        <span class="font-mono text-3xl font-semibold tracking-tight">{price}</span>
        <span class="text-sm text-muted">{unit}</span>
      </p>
      <p class="text-muted text-pretty">{children}</p>
      <div class="mt-auto pt-2">{action}</div>
    </article>
  )
}

/**
 * The three ways to use Seed and what each costs: the code (nothing), running it (one server) and
 * having it built (Anton's starting price). The last card sends a founder to
 * antonshubin.com's MVP page.
 */
export function PricingWays(): JSX.Element {
  const { t } = useSite()
  return (
    <Band id="costs" labelledBy="costs-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="costs-title"
          eyebrow={t.t(`PricingWays.eyebrow`)}
          title={t.t(`PricingWays.title`)}
          lead={t.t(`PricingWays.lead`)}
        />
        <div class="grid gap-4 md:gap-6 lg:grid-cols-3">
          <WayCard
            id="way-use"
            title={t.t(`PricingWays.useTitle`)}
            price="$0"
            unit={t.t(`PricingWays.useUnit`)}
            action={
              <Button
                href={REPOSITORY_URL}
                variant="outline"
                class="w-full"
                data-umami-event="github"
                data-umami-event-from="ways"
              >
                <IconGitHub class="size-5" aria-hidden="true" /> {t.t(`HomeHero.github`)}
              </Button>
            }
          >
            {t.t(`PricingWays.useText`)}
          </WayCard>
          <WayCard
            id="way-run"
            title={t.t(`PricingWays.runTitle`)}
            price={t.t(`PricingWays.runPrice`)}
            unit={t.t(`PricingWays.runUnit`)}
            action={
              <Button
                href={`${REPOSITORY_URL}/blob/main/docs/deploy.md`}
                variant="outline"
                class="w-full"
                data-umami-event="read-code"
                data-umami-event-from="deploy-guide"
              >
                {t.t(`PricingWays.runAction`)}
              </Button>
            }
          >
            {t.t(`PricingWays.runText`)}
          </WayCard>
          <WayCard
            id="way-hire"
            title={t.t(`PricingWays.hireTitle`)}
            price={t.t(`PricingWays.hirePrice`, { price: HIRE_PRICES.mvpFrom })}
            unit={t.t(`PricingWays.hireUnit`, {
              weeks: t.t(`Hire.weeks`, { count: HIRE_PRICES.mvpWeeks }),
            })}
            highlighted
            action={
              <Button
                href={HIRE_PAGE_URL}
                variant="primary"
                class="w-full"
                data-e2e="pricing-mvp"
                data-umami-event="hire-me"
                data-umami-event-from="pricing"
              >
                {t.t(`PricingWays.hireAction`)}{" "}
                <IconExternalLink class="size-5" aria-hidden="true" />
                <span class="sr-only">{t.t(`SiteNav.hireHint`)}</span>
              </Button>
            }
          >
            {t.t(`PricingWays.hireText`)}
          </WayCard>
        </div>
        <p class="max-w-3xl text-sm text-muted text-pretty">
          {t.t(`PricingWays.other`, {
            session: HIRE_PRICES.strategySession,
            hourly: HIRE_PRICES.hourly,
            retainer: HIRE_PRICES.retainerFrom,
          })}
        </p>
      </div>
    </Band>
  )
}
