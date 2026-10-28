import { matchEntry } from "@spy4x/platform/universal/text"
import type { SortDirection } from "@spy4x/preact-ui/filter-bar"

/** What the notes list is ordered by: the last change (the default), creation, or the title. */
export type NoteSort = "updated" | "created" | "title"

/** Whether a note needs any of the chosen tags (the default) or all of them. */
export type TagMatch = "any" | "all"

const DATE_DIRECTIONS = { asc: `NotesFilter.oldestFirst`, desc: `NotesFilter.newestFirst` }

/**
 * The orders the list offers, with the keys in the `app` catalog of the words the sort menu shows
 * for them and their directions.
 */
export const NOTE_SORTS: readonly {
  value: NoteSort
  label: string
  directions: Record<SortDirection, string>
}[] = [
  { value: "updated", label: `NotesFilter.sortUpdated`, directions: DATE_DIRECTIONS },
  { value: "created", label: `NotesFilter.sortCreated`, directions: DATE_DIRECTIONS },
  {
    value: "title",
    label: `NotesFilter.sortTitle`,
    directions: { asc: `NotesFilter.aToZ`, desc: `NotesFilter.zToA` },
  },
]

/** The direction an order starts in: dates newest first, titles A to Z. */
export function defaultDirection(sort: NoteSort): SortDirection {
  return sort === "title" ? "asc" : "desc"
}

/**
 * What the notes list is narrowed to and how it is ordered. The app keeps every field in the
 * address (`?q=`, `?tag=` repeated, `?match=all`, `?author=`, `?mine=1`, `?sort=`, `?dir=`).
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
  /** Which way `sort` runs; see {@link defaultDirection}. */
  direction: SortDirection
}

/** The list with nothing narrowed, newest change first. */
export const NO_NOTE_FILTERS: NoteFilters = {
  q: "",
  tagIds: [],
  match: "any",
  author: null,
  mine: false,
  sort: "updated",
  direction: "desc",
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

/** Milliseconds of an ISO timestamp, or `null` when there is none. */
function time(at: string | undefined): number | null {
  const value = at ? Date.parse(at) : Number.NaN
  return Number.isNaN(value) ? null : value
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
  const sign = filters.direction === "asc" ? 1 : -1
  // Undated notes go last whichever way the dates run.
  const byTime = (at: (note: N) => string | undefined) => (a: N, b: N) => {
    const x = time(at(a))
    const y = time(at(b))
    if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0)
    return sign * (x - y)
  }
  const order = {
    updated: byTime((note) => note.updatedAt),
    created: byTime((note) => note.createdAt ?? note.updatedAt),
    title: (a: N, b: N) => sign * TITLE_ORDER.compare(a.title, b.title),
  }[filters.sort]
  return kept.sort(order)
}
