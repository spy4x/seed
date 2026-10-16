import type { JSX } from "preact"
import {
  IconCog6Tooth,
  IconCreditCard,
  IconMinus,
  IconServer,
  IconShieldCheck,
  IconSparkle,
  IconUsers,
} from "@spy4x/preact-icons"
import { Band } from "./band.tsx"
import { SectionIntro } from "./section-intro.tsx"

/** What a founder's product has at launch, in their words rather than the stack's. */
const INCLUDED = [
  {
    id: `get-sign-in`,
    title: `Safe sign-up and sign-in`,
    Icon: IconShieldCheck,
    text: `With Google login, password reset and an optional second security step.`,
  },
  {
    id: `get-teams`,
    title: `Teams`,
    Icon: IconUsers,
    text: `Your customers invite colleagues and give them roles.`,
  },
  {
    id: `get-payments`,
    title: `Payments through Stripe`,
    Icon: IconCreditCard,
    text: `Subscriptions, free trials, and a price per team member if you want it.`,
  },
  {
    id: `get-yours`,
    title: `The features that make it yours`,
    Icon: IconSparkle,
    text: `Built on top. Anything Seed lacks for your product, I build as part of the quote.`,
  },
  {
    id: `get-admin`,
    title: `An admin area`,
    Icon: IconCog6Tooth,
    text: `Where you look up customers and handle their problems.`,
  },
  {
    id: `get-hosting`,
    title: `Hosting in your name`,
    Icon: IconServer,
    text: `On servers in your name, with daily backups and monitoring.`,
  },
] as const

/** Left out of the price, said up front so nothing surprises the founder later. */
const NOT_INCLUDED = [
  `Native iPhone or Android apps. The product works in the phone's browser and can be installed from it.`,
  `Integrations beyond Stripe, such as a CRM. They are quoted separately.`,
  `Custom illustrations and branding.`,
  `Ongoing maintenance, which is a separate monthly option.`,
] as const

/** "What you get": six outcomes as cards, what comes at handoff, and what the price leaves out. */
export function MvpIncludes(): JSX.Element {
  return (
    <Band id="what-you-get" labelledBy="get-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="get-title"
          eyebrow="What you get"
          title="A live product, not a prototype"
          lead="Free bug fixes for 30 days after delivery, and a walkthrough of everything at handoff."
        />
        <ul class="grid gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3">
          {INCLUDED.map(({ id, title, Icon, text }) => (
            <li
              key={id}
              class="flex flex-col gap-4 rounded-card border border-subtle bg-surface p-6"
            >
              <span class="flex size-10 items-center justify-center rounded-control bg-selected-soft text-primary">
                <Icon class="size-5" aria-hidden="true" />
              </span>
              <h3 id={id} class="text-lg font-semibold">{title}</h3>
              <p class="text-muted text-pretty">{text}</p>
            </li>
          ))}
        </ul>
        <section
          aria-labelledby="not-included-title"
          class="rounded-card border border-dashed border-strong p-6"
        >
          <h3 id="not-included-title" class="text-lg font-semibold">
            Not included, so there are no surprises
          </h3>
          <ul class="mt-4 grid gap-3 md:grid-cols-2">
            {NOT_INCLUDED.map((item) => (
              <li key={item} class="flex items-start gap-2">
                <IconMinus class="mt-1 size-4 shrink-0 text-muted" aria-hidden="true" />
                <span class="text-pretty">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Band>
  )
}
