// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { IconExternalLink } from "@spy4x/preact-icons"
import { HIRE_PAGE_URL } from "../hire.ts"
import { Band } from "./band.tsx"

/**
 * The one band of a developer page that speaks to the other audience: founders who want their
 * product built on Seed, sent to antonshubin.com's MVP page.
 */
export function FoundersHandoff(): JSX.Element {
  return (
    <Band tone="accent" labelledBy="founders-title">
      <div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex max-w-3xl flex-col gap-3">
          <h2 id="founders-title" class="text-2xl font-semibold tracking-tight text-balance">
            Not a developer? I'll build your product on Seed.
          </h2>
          <p class="text-muted text-pretty">
            I'm Anton, the person who builds Seed. Founders hire me to turn an idea into a live
            product that people can sign up for and pay for. Because sign-up, groups and payments
            already exist, your budget goes to what makes your product different.
          </p>
        </div>
        <Button
          href={HIRE_PAGE_URL}
          variant="secondary"
          size="lg"
          class="shrink-0"
          data-e2e="home-founders"
          data-umami-event="hire-me"
          data-umami-event-from="home"
        >
          See how it works and what it costs <IconExternalLink class="size-5" aria-hidden="true" />
          <span class="sr-only">(opens antonshubin.com)</span>
        </Button>
      </div>
    </Band>
  )
}
