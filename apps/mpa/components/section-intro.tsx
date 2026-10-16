import type { ComponentChildren, JSX } from "preact"

export interface SectionIntroProps {
  /** The `id` of the `h2`, for the band's `aria-labelledby`. */
  id: string
  /** A short label above the heading, in the accent colour. */
  eyebrow?: string
  title: ComponentChildren
  lead?: ComponentChildren
  center?: boolean
}

/** The top of a section: an eyebrow, the `h2` and a lead paragraph. */
export function SectionIntro(
  { id, eyebrow, title, lead, center = false }: SectionIntroProps,
): JSX.Element {
  return (
    <div class={`flex flex-col gap-4 ${center ? "items-center text-center" : ""}`}>
      {eyebrow && <p class="font-mono text-sm font-medium text-primary">{eyebrow}</p>}
      <h2 id={id} class="max-w-3xl text-2xl font-semibold tracking-tight text-balance lg:text-4xl">
        {title}
      </h2>
      {lead && <p class="max-w-2xl text-lg text-muted text-pretty">{lead}</p>}
    </div>
  )
}
