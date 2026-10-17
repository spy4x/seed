import type { ComponentChildren, ComponentType, JSX } from "preact"
import { IconArrowRight, type IconProps } from "@spy4x/preact-icons"
import { Card } from "@spy4x/preact-ui/card"

export interface FeatureCardProps {
  /** The heading's id, so the card's "Learn more" link can name which feature it is about. */
  id: string
  title: string
  Icon: ComponentType<IconProps>
  /** Where "Learn more" goes, such as `/features#sign-in`. */
  href: string
  /** Spans two columns from `lg`, for a card that carries a picture. */
  wide?: boolean
  /** A picture under the text, such as a {@link Shot}. */
  media?: ComponentChildren
  children: ComponentChildren
}

/**
 * One feature on the home page: an icon, a heading, two lines of text and a link to the feature's
 * section on `/features`. Only the link is a link, so the text stays selectable.
 */
export function FeatureCard(
  { id, title, Icon, href, wide = false, media, children }: FeatureCardProps,
): JSX.Element {
  return (
    <Card
      role="article"
      aria-labelledby={id}
      class={`site-lift flex flex-col gap-4 overflow-hidden rounded-card p-6 ${
        wide ? "lg:col-span-2" : ""
      }`}
    >
      <span class="flex size-10 items-center justify-center rounded-control bg-selected-soft text-primary">
        <Icon class="size-5" />
      </span>
      <h3 id={id} class="text-lg font-semibold">{title}</h3>
      <p class="text-muted text-pretty">{children}</p>
      <a
        href={href}
        aria-describedby={id}
        class="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        Learn more <IconArrowRight class="size-4" />
      </a>
      {media && <div class="-mx-6 -mb-6 mt-2 border-t border-subtle">{media}</div>}
    </Card>
  )
}
