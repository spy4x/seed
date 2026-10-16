import type { JSX } from "preact"
import { IconCheck } from "@spy4x/preact-icons"
import { HIRE_PRICES } from "../hire.ts"
import { Band } from "./band.tsx"
import { SectionIntro } from "./section-intro.tsx"

/** The five promises antonshubin.com makes, in the same words, so the two sites agree. */
const PROMISES = [
  {
    title: `You own everything from day one.`,
    text: `Code, accounts, servers and keys are in your name.`,
  },
  {
    title: `Five-day refund.`,
    text: `If in the first five days you feel this is not working, tell me and I refund what you ` +
      `paid.`,
  },
  {
    title: `A small first milestone.`,
    text: `One or two weeks, then either of us can stop, and you keep the work.`,
  },
  {
    title: `Weekly working software.`,
    text: `You see it every week, with a short written update.`,
  },
  {
    title: `Free bug fixes for 30 days.`,
    text: `Bugs in what I delivered are fixed free for 30 days after delivery.`,
  },
] as const

/** "What you can hold me to": the risk taken off the founder, then what happens after launch. */
export function MvpPromises(): JSX.Element {
  return (
    <Band id="promises" labelledBy="promises-title" width="3xl">
      <div class="flex flex-col gap-8">
        <SectionIntro id="promises-title" eyebrow="My promises" title="What you can hold me to" />
        <ul class="flex flex-col gap-4">
          {PROMISES.map((promise) => (
            <li key={promise.title} class="flex items-start gap-3">
              <IconCheck class="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
              <p class="text-pretty">
                <strong class="font-semibold">{promise.title}</strong>{" "}
                <span class="text-muted">{promise.text}</span>
              </p>
            </li>
          ))}
        </ul>
        <section aria-labelledby="after-launch-title" class="flex flex-col gap-2">
          <h3 id="after-launch-title" class="text-lg font-semibold">After launch</h3>
          <p class="text-muted text-pretty">
            If you want someone looking after the product once it is live, I do that too: by the
            hour at {HIRE_PRICES.hourly}, or on a monthly retainer from{" "}
            {HIRE_PRICES.retainerFrom}, which works out cheaper from about 20 hours a month.
          </p>
        </section>
      </div>
    </Band>
  )
}
