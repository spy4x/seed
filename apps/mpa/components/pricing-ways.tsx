// Seed's own site: see docs/start-a-product.md
import type { ComponentChildren, JSX } from "preact"
import { IconExternalLink, IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { REPOSITORY_URL } from "../brand.ts"
import { HIRE_PAGE_URL, HIRE_PRICES } from "../hire.ts"
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
  return (
    <Band id="costs" labelledBy="costs-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="costs-title"
          eyebrow="What you pay"
          title="Three ways to use Seed, and what each costs"
          lead="Seed has no paid tier and no licence key. I earn my living building client products on it, so the code stays free."
        />
        <div class="grid gap-4 md:gap-6 lg:grid-cols-3">
          <WayCard
            id="way-use"
            title="Use Seed yourself"
            price="$0"
            unit="MIT licence, no account"
            action={
              <Button
                href={REPOSITORY_URL}
                variant="outline"
                class="w-full"
                data-umami-event="github"
                data-umami-event-from="ways"
              >
                <IconGitHub class="size-5" aria-hidden="true" /> View on GitHub
              </Button>
            }
          >
            The full source under MIT, every feature, every update. Any number of products,
            commercial or not, client work included.
          </WayCard>
          <WayCard
            id="way-run"
            title="Run it in production"
            price="One server"
            unit="at your host's price"
            action={
              <Button
                href={`${REPOSITORY_URL}#production-certificates`}
                variant="outline"
                class="w-full"
                data-umami-event="read-code"
                data-umami-event-from="deploy-guide"
              >
                Read the deploy guide
              </Button>
            }
          >
            Seed runs on one Linux server you rent; several products can share it. Stripe, an email
            provider and Google or GitHub sign-in are optional, and each bills you directly.
          </WayCard>
          <WayCard
            id="way-hire"
            title="Have me build your MVP on it"
            price={`From ${HIRE_PRICES.mvpFrom}`}
            unit={`from ${HIRE_PRICES.mvpWeeks} to a live product`}
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
                See how it works <IconExternalLink class="size-5" aria-hidden="true" />
                <span class="sr-only">(opens antonshubin.com)</span>
              </Button>
            }
          >
            Your product from idea to live deployment, on servers in your name. A quote for your
            scope before any work starts.
          </WayCard>
        </div>
        <p class="max-w-3xl text-sm text-muted text-pretty">
          Other help is priced openly too: a 60-minute strategy session is{" "}
          {HIRE_PRICES.strategySession}, and ongoing work is {HIRE_PRICES.hourly} an hour or from
          {" "}
          {HIRE_PRICES.retainerFrom}{" "}
          a month. A price that says "from" becomes a fixed quote after a free call, before any work
          starts, and a change of scope gets its own quote first.
        </p>
      </div>
    </Band>
  )
}
