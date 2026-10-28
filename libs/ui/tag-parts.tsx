// deno-lint-ignore-file ui-text/no-literal
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
  /** How many of the group's notes carry it; left out while the device has not been told. */
  noteCount?: number
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

/** "3 notes", "1 note" or "No notes": a tag's note count in words. */
export function noteCountText(count: number): string {
  return count === 0 ? "No notes" : count === 1 ? "1 note" : `${count} notes`
}

/**
 * What the confirmation of a tag's delete says: how many notes lose it, when the count is known,
 * and that the notes themselves stay.
 */
export function tagDeleteMessage(noteCount: number | undefined): string {
  if (noteCount === 0) return "No note carries it."
  if (noteCount === undefined) return "It comes off every note that has it. The notes stay."
  return `It comes off ${noteCountText(noteCount)}. The notes stay.`
}

/**
 * The tags of a note as labels, in the order given; ids of tags that are gone are left out. With
 * `max`, the labels past it collapse into one "+N" whose tooltip names them.
 */
export function NoteTags(
  { tagIds, tags, max }: {
    tagIds: readonly string[] | undefined
    tags: readonly TagRow[]
    max?: number
  },
): JSX.Element | null {
  const all = tags.filter((tag) => tagIds?.includes(tag.id))
  if (all.length === 0) return null
  const shown = max === undefined ? all : all.slice(0, max)
  const rest = all.slice(shown.length)
  return (
    <ul class="flex flex-wrap items-center gap-1" aria-label="Tags" data-e2e="note-tags">
      {shown.map((tag) => (
        <li key={tag.id} data-e2e="note-tag">
          <TagBadge tag={tag} />
        </li>
      ))}
      {rest.length > 0 && (
        <li
          class="text-xs text-muted"
          title={rest.map((tag) => tag.name).join(", ")}
          data-e2e="note-tags-more"
        >
          <span aria-hidden="true">+{rest.length}</span>
          <span class="sr-only">and {rest.map((tag) => tag.name).join(", ")}</span>
        </li>
      )}
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
 * A row of chips, one per tag in its colour, pressed for the tags in `value`: the note page's
 * tag picker. A colour that is no `#rrggbb` draws in the default gray, as on a `TagBadge`.
 *
 * On a phone the row scrolls sideways instead of wrapping into many lines, and runs to the edges
 * of the screen (out of the page's 16 px padding) so a cut-off chip shows there is more. From
 * `sm` up it wraps.
 */
export function TagChips(
  { tags, value, onChange, label, showLabel, dataE2E }: {
    tags: readonly TagRow[]
    value: readonly string[]
    onChange: (ids: string[]) => void
    label: string
    /** Draws `label` above the chips, as a form field's label, not only for screen readers. */
    showLabel?: boolean
    dataE2E: string
  },
): JSX.Element {
  return (
    <div class="flex flex-col gap-2" data-e2e={dataE2E}>
      {showLabel && <p class="text-sm font-medium text-foreground" aria-hidden="true">{label}</p>}
      <ToggleChips
        label={label}
        options={tags.map((tag) => ({
          value: tag.id,
          label: tag.name,
          color: isHexColor(tag.color) ? tag.color : DEFAULT_TAG_COLOR,
        }))}
        value={[...value]}
        onChange={onChange}
        class={CHIP_ROW}
      />
    </div>
  )
}
