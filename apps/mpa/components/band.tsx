import type { ComponentChildren, JSX } from "preact"

/** How a {@link Band} sets itself apart from the bands around it. */
export type BandTone = "plain" | "alt" | "glow" | "accent"

const TONES: Record<BandTone, string> = {
  plain: "",
  alt: "bg-surface dark:bg-white/[0.04] border-y border-subtle",
  glow: "site-glow",
  accent: "bg-selected-soft border-y border-subtle",
}

export interface BandProps {
  tone?: BandTone
  /** The id of the band's heading, which names the band as a region. */
  labelledBy?: string
  /** An anchor other pages link to, such as `status` for `/#status`. */
  id?: string
  /** Narrower content, for reading text and forms: `3xl` or `md`. Defaults to the page width. */
  width?: "6xl" | "3xl" | "md"
  class?: string
  children: ComponentChildren
}

const WIDTHS = { "6xl": "max-w-6xl", "3xl": "max-w-3xl", md: "max-w-md" } as const

/**
 * One full-width section of a page: a background that runs edge to edge, and the content in the
 * page's column inside it. Bands stacked in `main` give a long page its rhythm.
 */
export function Band(
  { tone = "plain", labelledBy, id, width = "6xl", class: className = "", children }: BandProps,
): JSX.Element {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      class={`scroll-mt-16 py-12 lg:py-16 ${TONES[tone]} ${className}`}
    >
      <div class={`mx-auto w-full ${WIDTHS[width]} px-4 sm:px-6 lg:px-8`}>{children}</div>
    </section>
  )
}
