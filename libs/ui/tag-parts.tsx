import type { JSX } from "preact"
import { Badge } from "@spy4x/preact-ui/badge"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
import type { TagColor } from "@domain/tags"

/** One tag as the screens show it. */
export interface TagRow {
  id: string
  name: string
  color: TagColor
}

/** A tag as a small coloured label; the case the person typed is kept. */
export function TagBadge({ tag }: { tag: TagRow }): JSX.Element {
  return <Badge text={tag.name} color={tag.color} class="normal-case" />
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
