import type { JSX } from "preact"

export interface OnThisPageProps {
  links: readonly { label: string; href: string }[]
}

/**
 * The anchors of a long page. From `lg` it is an open list in a side column; below `lg` it folds
 * into a `<details>`, so it works without JavaScript either way.
 */
export function OnThisPage({ links }: OnThisPageProps): JSX.Element {
  const list = (
    <ul class="flex flex-col gap-2 text-sm">
      {links.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            class="text-muted hover:text-foreground hover:underline"
            data-umami-event="on-this-page"
            data-umami-event-section={link.href.slice(1)}
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  )
  return (
    <nav aria-label="On this page">
      <details class="rounded-card border border-subtle bg-surface p-4 lg:hidden">
        <summary class="cursor-pointer font-medium">On this page</summary>
        <div class="mt-3">{list}</div>
      </details>
      <div class="hidden lg:sticky lg:top-24 lg:block">
        <p class="mb-3 text-sm font-semibold">On this page</p>
        {list}
      </div>
    </nav>
  )
}
