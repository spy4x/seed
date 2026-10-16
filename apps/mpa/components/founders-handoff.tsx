import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { IconArrowRight } from "@spy4x/preact-icons"
import { Band } from "./band.tsx"

/**
 * The one band of a developer page that speaks to the other audience: founders who want their
 * product built on Seed, sent to `/mvp`.
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
            product that people can sign up for and pay for. Because sign-up, teams and payments
            already exist, your budget goes to what makes your product different.
          </p>
        </div>
        <Button
          href="/mvp"
          variant="secondary"
          size="lg"
          class="shrink-0"
          data-e2e="home-founders"
        >
          See how it works and what it costs <IconArrowRight class="size-5" aria-hidden="true" />
        </Button>
      </div>
    </Band>
  )
}
