import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { IconArrowRight, IconGitHub } from "@spy4x/preact-icons"
import { TRY_ENTRY, TRY_REL } from "../site.tsx"
import { REPOSITORY_URL } from "../brand.ts"
import { Band } from "./band.tsx"
import { SectionIntro } from "./section-intro.tsx"

interface CtaBandText {
  title?: string
  lead?: string
}

/** The demo first, GitHub second: for a page about what the product does. */
interface DemoAsk extends CtaBandText {
  ask?: "demo"
  /** The app's `/try`: the live demo, opened as a guest account (#224). */
  demoHref: string
}

/** GitHub first, then a text link into the code: for a part the public demo does not show. */
interface CodeAsk extends CtaBandText {
  ask: "code"
  /** Where in the repository the page's subject lives. */
  code: { label: string; href: string }
}

export type CtaBandProps = DemoAsk | CodeAsk

/** The closing call to action of a developer page: try the demo, or read the code. */
export function CtaBand(props: CtaBandProps): JSX.Element {
  const {
    title = "See it working in a minute",
    lead =
      "The demo is the app you get on day one. Open it without signing up and start in groups full of sample notes.",
  } = props
  const github = (variant: "primary" | "outline") => (
    <Button
      href={REPOSITORY_URL}
      variant={variant}
      size="lg"
      data-e2e="cta-github"
      data-umami-event="github"
      data-umami-event-from="cta"
    >
      <IconGitHub class="size-5" aria-hidden="true" /> View on GitHub
    </Button>
  )
  return (
    <Band tone="glow" labelledBy="cta-title" class="border-t border-subtle">
      <div class="flex flex-col items-center gap-8">
        <SectionIntro id="cta-title" title={title} lead={lead} center />
        {props.ask === "code"
          ? (
            <div class="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row">
              <div class="flex w-full flex-col sm:w-auto">{github("primary")}</div>
              <a
                href={props.code.href}
                class="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
                data-e2e="cta-code"
                data-umami-event="read-code"
                data-umami-event-from="cta"
              >
                {props.code.label} <IconArrowRight class="size-4" aria-hidden="true" />
              </a>
            </div>
          )
          : (
            <div class="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
              <Button
                href={props.demoHref}
                rel={TRY_REL}
                size="lg"
                data-umami-event="try-demo"
                data-umami-event-from="cta"
              >
                {TRY_ENTRY.label}
              </Button>
              {github("outline")}
            </div>
          )}
      </div>
    </Band>
  )
}
