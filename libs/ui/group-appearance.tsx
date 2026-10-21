import type { JSX } from "preact"
import { badgeClasses } from "@spy4x/preact-ui/badge"
import type { GroupColor } from "@domain/groups"
import { colorStyle } from "./tag-parts.tsx"

/** The group's colour and emoji, as the lists and the headers carry them. */
export interface GroupAppearance {
  color?: GroupColor | null
  emoji?: string | null
}

/**
 * A group's mark: its emoji on its colour, a plain swatch when it has a colour and no emoji, and
 * the emoji on grey when it has no colour. A group with neither has no mark, so an unstyled group
 * takes no room. The mark is decoration: the group's name always sits beside it.
 */
export function GroupMark(
  { color, emoji, size = "md", class: className }: GroupAppearance & {
    size?: "sm" | "md"
    class?: string
  },
): JSX.Element | null {
  if (!color && !emoji) return null
  const box = size === "sm" ? "size-5 text-xs" : "size-7 text-base"
  return (
    <span
      class={badgeClasses(
        "gray",
        "filled",
        `${box} shrink-0 justify-center rounded-md p-0 leading-none normal-case ${className ?? ""}`,
      )}
      style={color ? colorStyle(color) : undefined}
      aria-hidden="true"
      data-e2e="group-mark"
      data-color={color ?? undefined}
    >
      {emoji}
    </span>
  )
}

/** The group's name with its emoji in front, for a field that can show text only. */
export function groupLabel({ name, emoji }: { name: string; emoji?: string | null }): string {
  return emoji ? `${emoji} ${name}` : name
}
