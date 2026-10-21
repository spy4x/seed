import type { JSX } from "preact"
import { badgeClasses } from "@spy4x/preact-ui/badge"
import { COLOR_PRESETS } from "@spy4x/preact-ui/color-field"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
import { isHexColor, readableTextColor } from "@spy4x/platform/universal/color"
import { DEFAULT_TAG_COLOR, type TagColor } from "@domain/tags"

/** One tag as the screens show it. */
export interface TagRow {
  id: string
  name: string
  color: TagColor
}

/**
 * The fill and the text colour of anything drawn in `color`: a tag chip, a group mark. The text is
 * black or white, whichever reads better on the fill. A value that is no `#rrggbb` (a copy saved
 * on the device before colours were hex) draws in the default gray instead of failing.
 */
export function colorStyle(color: string): JSX.CSSProperties {
  const fill = isHexColor(color) ? color : DEFAULT_TAG_COLOR
  return { backgroundColor: fill, borderColor: fill, color: readableTextColor(fill) }
}

/** A colour in words: the preset's name ("Red"), or the hex code of a custom colour. */
export function colorName(color: string): string {
  return COLOR_PRESETS.find((preset) => preset.value === color.toLowerCase())?.label ?? color
}

/**
 * A tag as a small label in its colour; the case the person typed is kept. A name longer than the
 * room it has ends in an ellipsis instead of running over what sits beside it.
 */
export function TagBadge({ tag }: { tag: Pick<TagRow, "name" | "color"> }): JSX.Element {
  return (
    <span
      class={badgeClasses("gray", "filled", "max-w-full normal-case")}
      style={colorStyle(tag.color)}
      title={tag.name}
    >
      <span class="min-w-0 truncate">{tag.name}</span>
    </span>
  )
}

/** The tags of a note as labels, in the order given; ids of tags that are gone are left out. */
export function NoteTags(
  { tagIds, tags }: { tagIds: readonly string[] | undefined; tags: readonly TagRow[] },
): JSX.Element | null {
  const shown = tags.filter((tag) => tagIds?.includes(tag.id))
  if (shown.length === 0) return null
  return (
    <ul class="flex flex-wrap gap-1" aria-label="Tags" data-e2e="note-tags">
      {shown.map((tag) => (
        <li key={tag.id} data-e2e="note-tag">
          <TagBadge tag={tag} />
        </li>
      ))}
    </ul>
  )
}

/**
 * The chip row's layout: one line that scrolls on a phone, with room inside the scroll box for
 * the chips' focus rings; wrapping lines from `sm` up.
 */
const CHIP_ROW =
  "-mx-4 -my-1 flex-nowrap overflow-x-auto px-4 py-1 *:shrink-0 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"

/**
 * A row of chips, one per tag, pressed for the tags in `value`. It is the note page's picker and
 * the notes list's filter: only the group's label and the wording differ.
 *
 * On a phone the row scrolls sideways instead of wrapping into many lines, and runs to the edges
 * of the screen (out of the page's 16 px padding) so a cut-off chip shows there is more. From
 * `sm` up it wraps.
 */
export function TagChips(
  { tags, value, onChange, label, dataE2E }: {
    tags: readonly TagRow[]
    value: readonly string[]
    onChange: (ids: string[]) => void
    label: string
    dataE2E: string
  },
): JSX.Element {
  return (
    <div data-e2e={dataE2E}>
      <ToggleChips
        label={label}
        options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
        value={[...value]}
        onChange={onChange}
        class={CHIP_ROW}
      />
    </div>
  )
}
