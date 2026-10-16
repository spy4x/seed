import type { ComponentChildren, JSX } from "preact"

export interface PageHeroProps {
  eyebrow?: string
  title: ComponentChildren
  lead?: ComponentChildren
  /** The page's buttons, or a date line. */
  children?: ComponentChildren
}

/** The top of an inner page: eyebrow, the page's `h1`, a lead and its buttons, on the glow. */
export function PageHero({ eyebrow, title, lead, children }: PageHeroProps): JSX.Element {
  return (
    <div class="site-glow border-b border-subtle">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-12 pb-12 sm:px-6 lg:px-8 lg:pt-16 lg:pb-16">
        {eyebrow && <p class="font-mono text-sm font-medium text-primary">{eyebrow}</p>}
        <h1 class="max-w-3xl text-3xl font-semibold tracking-tight text-balance lg:text-5xl">
          {title}
        </h1>
        {lead && <p class="max-w-2xl text-lg text-muted text-pretty lg:text-xl">{lead}</p>}
        {children}
      </div>
    </div>
  )
}
