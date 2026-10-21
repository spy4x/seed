import { matchEntry } from "@spy4x/platform/universal/text"

/** How the notes list is ordered: newest change first (the default), newest first, or by title. */
export type NoteSort = "updated" | "created" | "title"

/** Whether a note needs any of the chosen tags (the default) or all of them. */
export type TagMatch = "any" | "all"

/** The orders the list offers, with the words the sort menu shows. */
export const NOTE_SORTS: readonly { value: NoteSort; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "created", label: "Date created" },
  { value: "title", label: "Title (A–Z)" },
]

/**
 * What the notes list is narrowed to and how it is ordered. The app keeps every field in the
 * address (`?q=`, `?tag=` repeated, `?match=all`, `?author=`, `?mine=1`, `?sort=`).
 */
export interface NoteFilters {
  /** The search: words to find in a note's title or text. */
  q: string
  /** The tags a note must carry: any of them, or all of them by `match`. */
  tagIds: readonly string[]
  match: TagMatch
  /** The id of the member who created the note, or `null` for anyone. */
  author: string | null
  /** "Created by me": only the notes the person created. */
  mine: boolean
  sort: NoteSort
}

/** The list with nothing narrowed, newest change first. */
export const NO_NOTE_FILTERS: NoteFilters = {
  q: "",
  tagIds: [],
  match: "any",
  author: null,
  mine: false,
  sort: "updated",
}

/** What a note needs for the list to filter and order it. */
export interface FilterableNote {
  title: string
  body: string
  tagIds?: readonly string[]
  /** The id of the member who created the note; `null` when that account is gone. */
  authorId?: string | null
  createdAt?: string
  updatedAt?: string
}

/** Milliseconds of an ISO timestamp, or 0 when there is none, so undated notes sort last. */
function time(at: string | undefined): number {
  const value = at ? Date.parse(at) : Number.NaN
  return Number.isNaN(value) ? 0 : value
}

const TITLE_ORDER = new Intl.Collator(undefined, { sensitivity: "base", numeric: true })

/**
 * The notes the list shows: those that pass every filter, in the chosen order. It reads only the
 * notes it is given, so it works the same on the device's copy offline.
 *
 * The search finds words in the title and the text in any order, by the start of a word, with one
 * typo, typed in the other keyboard layout, or in the other script (`matchEntry`). A tag filter
 * counts only tags in `knownTagIds`, so a link to a deleted tag does not empty the list.
 *
 * @param notes The group's notes.
 * @param filters What to keep and how to order it.
 * @param context `youId`, the person's own id for "Created by me"; `knownTagIds`, the group's tags.
 * @returns A new array; `notes` is left as it was.
 */
export function filterNotes<N extends FilterableNote>(
  notes: readonly N[],
  filters: NoteFilters,
  context: { youId: string | null; knownTagIds: readonly string[] },
): N[] {
  const tagIds = filters.tagIds.filter((id) => context.knownTagIds.includes(id))
  const query = filters.q.trim()
  const kept = notes.filter((note) => {
    if (tagIds.length > 0) {
      const has = (id: string) => note.tagIds?.includes(id) ?? false
      if (filters.match === "all" ? !tagIds.every(has) : !tagIds.some(has)) return false
    }
    if (filters.author !== null && note.authorId !== filters.author) return false
    if (filters.mine && (context.youId === null || note.authorId !== context.youId)) return false
    if (query === "") return true
    return matchEntry(query, { label: note.title, aliases: [`${note.title} ${note.body}`] }) !==
      null
  })
  const order = {
    updated: (a: N, b: N) => time(b.updatedAt) - time(a.updatedAt),
    created: (a: N, b: N) => time(b.createdAt ?? b.updatedAt) - time(a.createdAt ?? a.updatedAt),
    title: (a: N, b: N) => TITLE_ORDER.compare(a.title, b.title),
  }[filters.sort]
  return kept.sort(order)
}
