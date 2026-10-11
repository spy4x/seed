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
    <ul class="mt-1 flex flex-wrap gap-1" aria-label="Tags" data-e2e="note-tags">
      {shown.map((tag) => (
        <li key={tag.id} data-e2e="note-tag">
          <TagBadge tag={tag} />
        </li>
      ))}
    </ul>
  )
}

/**
 * A row of chips, one per tag, pressed for the tags in `value`. It is the note page's picker and
 * the notes list's filter: only the group's label and the wording differ.
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
      />
    </div>
  )
}
