import type { JSX } from "preact"
import { IconArrowRight, IconQuote, IconUpwork } from "@spy4x/preact-icons"
import { AUTHOR_URL } from "../brand.ts"
import { UPWORK_URL } from "../hire.ts"
import { Band } from "./band.tsx"
import { SectionIntro } from "./section-intro.tsx"

/**
 * Three client reviews, word for word as antonshubin.com shows them (checked on 2026-10-16), with
 * its ellipses. Each can be read in full on the Upwork profile. Never edit a quote.
 */
const REVIEWS = [
  {
    quote: `Anton was a terrific partner to me in developing an MVP of a web app I've been ` +
      `dreaming of for ages. … If you're looking for a fast, expert, transparent guide to help ` +
      `you bring a big idea to life, working with Anton is a great choice.`,
    name: `Lila King`,
    project: `Roley — Make a Movie! · 2023–2025`,
  },
  {
    quote: `A few months back, we were having major problems with the code that was ` +
      `implemented by our first back-end developer. … Anton helped us out and solved all of the ` +
      `problems we had.`,
    name: `Nastassia Ponomarenko`,
    project: `Corecircle · 2021`,
  },
  {
    quote: `Anton has helped our company build a world-class application, not only with his ` +
      `master class programming skills but also helping us find other amazing developers to ` +
      `join our team. … I highly recommend him and he is worth every cent.`,
    name: `Michael Distel`,
    project: `FoodRazor · 2018–2019`,
  },
] as const

/** The figures of the Upwork profile, as antonshubin.com quotes them (checked on 2026-10-16). */
const FIGURES = [
  { value: `Top 1%`, label: `Expert-Vetted on Upwork` },
  { value: `100%`, label: `Job Success on Upwork` },
  { value: `80`, label: `jobs on Upwork` },
  { value: `6,600+`, label: `hours on Upwork` },
] as const

/** Outcomes of past client work, as antonshubin.com describes them. */
const OUTCOMES = [
  `FoodRazor, where I was tech lead, was acquired in 2023.`,
  `Corecircle, where I was tech lead, was acquired in 2024.`,
  `SmartLite: built solo in 3 months; about 200 lamp poles in production since 2024.`,
] as const

/**
 * "What clients say": the reviews, the Upwork figures, outcomes of past work, and the person
 * behind them with a photo. Only proof that is already public, each piece linked to its source.
 */
export function MvpProof(): JSX.Element {
  return (
    <Band tone="alt" id="proof" labelledBy="proof-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="proof-title"
          eyebrow="Proof"
          title="What clients say"
          lead="Reviews from founders and teams I built for, word for word from my Upwork profile."
        />
        <div class="grid gap-4 md:gap-6 lg:grid-cols-3">
          {REVIEWS.map((review) => (
            <figure
              key={review.name}
              class="flex flex-col gap-4 rounded-card border border-subtle bg-canvas p-6"
            >
              <IconQuote class="size-6 text-primary" aria-hidden="true" />
              <blockquote class="text-pretty">
                <p>"{review.quote}"</p>
              </blockquote>
              <figcaption class="mt-auto flex flex-col gap-1 text-sm">
                <span class="font-semibold">{review.name}</span>
                <span class="text-muted">{review.project}</span>
                <a href={UPWORK_URL} class="self-start py-1 text-primary underline">
                  Reviewed on Upwork
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
        <dl class="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {FIGURES.map((figure) => (
            <div key={figure.label} class="flex flex-col gap-1">
              <dt class="order-2 text-sm text-muted">{figure.label}</dt>
              <dd class="order-1 font-mono text-2xl font-semibold tracking-tight">
                {figure.value}
              </dd>
            </div>
          ))}
        </dl>
        <div class="grid gap-8 rounded-card border border-subtle bg-canvas p-6 md:grid-cols-[auto_1fr] md:items-start">
          <img
            src="/img/anton-320.webp"
            width={320}
            height={320}
            alt="Anton Shubin, smiling, at a table by a window."
            loading="lazy"
            decoding="async"
            class="size-32 rounded-full object-cover md:size-40"
          />
          <div class="flex flex-col gap-4">
            <h3 class="text-lg font-semibold">Who you would be working with</h3>
            <p class="text-muted text-pretty">
              I'm Anton Shubin, a senior full-stack engineer and tech lead. I've built software
              since 2010 and worked with clients directly since 2013. Some of that work:
            </p>
            <ul class="flex flex-col gap-2">
              {OUTCOMES.map((outcome) => <li key={outcome} class="text-pretty">{outcome}</li>)}
            </ul>
            <ul class="flex flex-wrap gap-x-6 gap-y-2 font-medium">
              <li>
                <a
                  href={AUTHOR_URL}
                  class="inline-flex items-center gap-1 py-2 text-primary underline"
                  data-e2e="mvp-author"
                >
                  All reviews and projects on antonshubin.com{" "}
                  <IconArrowRight class="size-4" aria-hidden="true" />
                </a>
              </li>
              <li>
                <a
                  href={UPWORK_URL}
                  class="inline-flex items-center gap-1 py-2 text-primary underline"
                >
                  <IconUpwork class="size-4" aria-hidden="true" /> Upwork profile
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Band>
  )
}
