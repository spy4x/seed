import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { IconGitHub } from "@spy4x/preact-icons"
import { REPOSITORY_URL } from "../brand.ts"
import { Band } from "./band.tsx"
import { SectionIntro } from "./section-intro.tsx"

export interface CtaBandProps {
  /** The SPA's sign-up page: the live demo. */
  demoHref: string
  title?: string
  lead?: string
}

/** The closing call to action of a developer page: try the demo, or read the code. */
export function CtaBand(
  {
    demoHref,
    title = "See it working in a minute",
    lead = "The demo is the app you get on day one. Sign up, create a group, invite yourself.",
  }: CtaBandProps,
): JSX.Element {
  return (
    <Band tone="glow" labelledBy="cta-title" class="border-t border-subtle">
      <div class="flex flex-col items-center gap-8">
        <SectionIntro id="cta-title" title={title} lead={lead} center />
        <div class="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
          <Button href={demoHref} size="lg">Try the live demo</Button>
          <Button href={REPOSITORY_URL} variant="outline" size="lg">
            <IconGitHub class="size-5" aria-hidden="true" /> View on GitHub
          </Button>
        </div>
      </div>
    </Band>
  )
}
