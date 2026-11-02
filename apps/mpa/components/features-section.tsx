import type { ComponentChildren, JSX } from "preact"
import { IconArrowRight, IconCheck, IconCode, IconMinus } from "@spy4x/preact-icons"
import { StatusMark } from "@spy4x/preact-ui/status-mark"
import { useSite } from "../use-site.tsx"

/** A part of a feature that is not built yet, with the open issue that tracks it when one exists. */
export interface NotYet {
  label: string
  /** The issue's full address on GitHub. */
  issue?: string
}

export interface FeatureSectionProps {
  /** The section's anchor, such as `sign-in` for `/features#sign-in`. */
  id: string
  title: string
  /** What a person using the product notices. */
  lead: ComponentChildren
  /** What a developer gets, one concrete fact each. */
  facts: readonly ComponentChildren[]
  /** What is missing, shown next to the claims it limits. */
  notYet?: readonly NotYet[]
  /** Where to read the code behind the claims, on GitHub. */
  code: { label: string; href: string }
  /**
   * The feature's own page. With one, the whole text block is a link to it, its name the heading.
   * `language` marks a page in another language.
   */
  more?: { href: string; language?: string }
  /** The picture or code window beside the text. Without one, the facts spread over two columns. */
  visual?: ComponentChildren
  /** Puts the picture on the left from `xl`, so neighbouring sections alternate. */
  flip?: boolean
}

/**
 * One feature of `/features`: the heading, what people notice, what a developer gets, the honest
 * status, a quiet link to the code, and a picture beside the text from `xl` (below it on a phone).
 * With a page of its own, the whole text block is one link to it: the heading's link stretches over
 * the block, and every other link in it sits above that layer so it stays clickable.
 */
export function FeatureSection(
  { id, title, lead, facts, notYet = [], code, more, visual, flip = false }: FeatureSectionProps,
): JSX.Element {
  const { t } = useSite()
  const headingId = `${id}-title`
  const side = Boolean(visual)
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      class={`grid scroll-mt-16 gap-8 ${side ? "xl:grid-cols-2 xl:items-center" : ""}`}
      data-e2e={`feature-${id}`}
    >
      <div
        class={`flex min-w-0 flex-col gap-4 ${side && flip ? "xl:order-2" : ""} ${
          more
            ? "group relative -m-3 rounded-card p-3 transition-colors hover:bg-hover [&_a:not(h3_a)]:relative"
            : ""
        }`}
      >
        <h3 id={headingId} class="text-xl font-semibold tracking-tight text-balance lg:text-2xl">
          {more
            ? (
              <a
                href={more.href}
                hreflang={more.language}
                class="after:absolute after:inset-0 after:rounded-card group-hover:text-primary focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-focus"
                data-e2e="feature-more-link"
              >
                {title}
                <IconArrowRight
                  class="ms-2 inline size-5 align-[-0.125em] text-primary motion-safe:transition-transform motion-safe:group-hover:translate-x-1 rtl:motion-safe:group-hover:-translate-x-1"
                  aria-hidden="true"
                />
              </a>
            )
            : title}
        </h3>
        <p class="text-muted text-pretty">{lead}</p>
        <p class="font-mono text-sm font-medium text-muted">
          {t.t(`FeatureSection.forDevelopers`)}
        </p>
        <FactList facts={facts} columns={!visual} />
        {notYet.length > 0 && <NotYetList items={notYet} />}
        <a
          href={code.href}
          class="inline-flex min-h-11 items-center gap-2 self-start text-sm text-muted hover:text-foreground hover:underline"
          data-e2e="feature-code-link"
          data-umami-event="read-code"
          data-umami-event-from={id}
        >
          <IconCode class="size-4" aria-hidden="true" /> {code.label}
        </a>
      </div>
      {visual && (
        <div class={`min-w-0 max-w-2xl ${flip ? "xl:order-1" : ""}`}>
          {visual}
        </div>
      )}
    </section>
  )
}

/** What a developer gets, one check-marked fact a line; in two columns from `md` with `columns`. */
export function FactList(
  { facts, columns = false }: { facts: readonly ComponentChildren[]; columns?: boolean },
): JSX.Element {
  return (
    <ul class={`grid gap-3 ${columns ? "md:grid-cols-2 md:gap-x-8" : ""}`}>
      {facts.map((fact, index) => (
        <li key={index} class="flex items-start gap-2">
          <IconCheck class="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span class="text-pretty">{fact}</span>
        </li>
      ))}
    </ul>
  )
}

/** The parts not built yet, in a dashed box: a status word and shape, never colour alone. */
export function NotYetList({ items }: { items: readonly NotYet[] }): JSX.Element {
  const { t } = useSite()
  return (
    <div class="flex flex-col gap-2 rounded-card border border-dashed border-strong p-4 text-sm">
      <StatusMark status="wip" label={t.t(`HomeStatus.notBuilt`)} class="font-medium" />
      <ul class="flex flex-col gap-1 text-muted">
        {items.map((item) => (
          <li key={item.label} class="flex items-start gap-2">
            <IconMinus class="mt-1 size-4 shrink-0" aria-hidden="true" />
            <span class="text-pretty">
              {item.label}
              {item.issue && (
                <>
                  {" ("}
                  <a href={item.issue} class="underline hover:text-foreground">
                    {t.t(`FeatureSection.issue`, { number: item.issue.split(`/`).pop() ?? `` })}
                  </a>
                  {")"}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface FeatureTierProps {
  /** The tier's anchor and the base of its heading's id. */
  id: string
  eyebrow: string
  title: string
  lead: ComponentChildren
  /** The tier's one-line status: what works today and what limits it. */
  status: ComponentChildren
  /** More of the status line after "Works today", such as a part still in progress. */
  statusMore?: ComponentChildren
  /** The tier's feature sections. Left out, the tier is its heading block alone. */
  children?: ComponentChildren
}

/**
 * A group of features with one heading and one honest status line, such as "Settled for you":
 * the parts every product needs first.
 */
export function FeatureTier(
  { id, eyebrow, title, lead, status, statusMore, children }: FeatureTierProps,
): JSX.Element {
  const { t } = useSite()
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} class="flex scroll-mt-16 flex-col gap-12">
      <div
        class={children === undefined
          ? `flex flex-col gap-4`
          : `flex flex-col gap-4 border-b border-subtle pb-8`}
      >
        <p class="font-mono text-sm font-medium text-primary">{eyebrow}</p>
        <h2
          id={headingId}
          class="max-w-3xl text-2xl font-semibold tracking-tight text-balance lg:text-4xl"
        >
          {title}
        </h2>
        <p class="max-w-2xl text-lg text-muted text-pretty">{lead}</p>
        <p class="flex max-w-2xl flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <StatusMark status="ready" label={t.t(`HomeStatus.works`)} class="font-medium" />
          <span class="text-muted text-pretty">{status}</span>
          {statusMore}
        </p>
      </div>
      {children !== undefined && <div class="flex flex-col gap-12 lg:gap-16">{children}</div>}
    </section>
  )
}
