import type { JSX } from "preact"
import { IconArrowRight, IconCalendar } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { BOOK_CALL_URL, BRIEF_URL } from "../hire.ts"
import { Band } from "./band.tsx"
import { SectionIntro } from "./section-intro.tsx"

/**
 * The founders page's one ask, a free call on antonshubin.com's calendar, and the written brief
 * beside it for a founder who would rather write. `place` names the copy in its `data-e2e` hooks.
 */
export function MvpCallActions(
  { place, center = false }: { place: string; center?: boolean },
): JSX.Element {
  return (
    <div
      class={`flex w-full flex-col gap-4 sm:w-auto sm:flex-row sm:items-center ${
        center ? "sm:justify-center" : ""
      }`}
    >
      <Button href={BOOK_CALL_URL} size="lg" data-e2e={`mvp-book-${place}`}>
        <IconCalendar class="size-5" aria-hidden="true" /> Book a free 30-minute call
      </Button>
      <a
        href={BRIEF_URL}
        class="inline-flex items-center justify-center gap-1 py-2 font-medium text-primary underline-offset-4 hover:underline"
        data-e2e={`mvp-brief-${place}`}
      >
        Or send a written brief <IconArrowRight class="size-4" aria-hidden="true" />
      </a>
    </div>
  )
}

/** The founders page's closing call to action: what the call gives, and the two ways to start. */
export function MvpCallBand(): JSX.Element {
  return (
    <Band tone="glow" labelledBy="call-title" class="border-t border-subtle">
      <div class="flex flex-col items-center gap-8">
        <SectionIntro
          id="call-title"
          title="Tell me about your idea"
          lead="Thirty minutes, free, no obligation. You leave knowing what to build first and roughly what it costs, whether or not you hire me."
          center
        />
        <MvpCallActions place="closing" center />
      </div>
    </Band>
  )
}
