// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"

/** A page of another product's site that the comparison was checked against. */
export interface AlternativeSource {
  label: string
  href: string
}

/** One alternative to Seed: the facts that are not a yes or a no, when to pick it, and the sources. */
export interface Alternative {
  /** The anchor of its card, such as `shipfast`. */
  id: string
  name: string
  price: string
  licence: string
  stack: string
  hosting: string
  /** One or two sentences: the reader for whom this product is the better choice. */
  pickWhen: string
  /** The pages the facts come from. Empty for an option that is no product. */
  sources: readonly AlternativeSource[]
}

export interface CompareAlternativesProps {
  items: readonly Alternative[]
  /** The day the sources were read, as people read it, such as `16 Oct 2026`. */
  checkedOn: string
}

/**
 * One card per alternative to Seed: its price, licence, stack and hosting as a description list,
 * who should pick it instead, and the pages the facts were read on. Server-rendered, plain links.
 */
export function CompareAlternatives({ items, checkedOn }: CompareAlternativesProps): JSX.Element {
  return (
    <ul class="grid gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.id} class="flex">
          <article
            id={item.id}
            aria-labelledby={`${item.id}-title`}
            class="flex w-full scroll-mt-16 flex-col gap-4 rounded-card border border-subtle bg-canvas p-6"
            data-e2e="compare-alternative"
          >
            <h3 id={`${item.id}-title`} class="text-lg font-semibold">{item.name}</h3>
            <p class="text-pretty">
              <span class="font-medium">Pick it when</span> {item.pickWhen}
            </p>
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt class="text-muted">Price</dt>
              <dd>{item.price}</dd>
              <dt class="text-muted">Licence</dt>
              <dd>{item.licence}</dd>
              <dt class="text-muted">Stack</dt>
              <dd>{item.stack}</dd>
              <dt class="text-muted">Hosting</dt>
              <dd>{item.hosting}</dd>
            </dl>
            {item.sources.length > 0 && (
              <div class="mt-auto flex flex-col gap-1 border-t border-subtle pt-4 text-sm">
                <p class="text-muted">Pages read on {checkedOn}:</p>
                <ul class="flex flex-wrap gap-x-4">
                  {item.sources.map((source) => (
                    <li key={source.href}>
                      <a
                        href={source.href}
                        class="inline-block py-2 text-primary underline"
                        rel="noopener"
                        data-umami-event="compare-source"
                        data-umami-event-product={item.name}
                      >
                        {source.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        </li>
      ))}
    </ul>
  )
}
