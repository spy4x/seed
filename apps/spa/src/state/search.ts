import { isProxyAnswer, isUnreachable } from "@spy4x/realtime/read-cache"
import { createIndex, type SearchEntry, type SearchIndex } from "@spy4x/search"
import {
  NOTE_SEARCH_LIMIT,
  NOTE_SEARCH_MAX_LENGTH,
  type NoteSearchHit,
  trimNoteSnippet,
} from "@domain/notes"
import type { SearchNote, SearchNotesAnswer } from "@ui/search-palette.tsx"
import { RECENT_NOTES } from "@ui/search-palette.tsx"
import type { NoteItem } from "./notes.ts"

/** The note search's answer as the API sends it: dates are strings once they cross the wire. */
type WireHit = Omit<NoteSearchHit, "updatedAt"> & { updatedAt: string }

/** Where the palette's notes come from. Each is a port, so a test passes its own. */
export interface NoteSearchSources {
  /** Whether a call made now reaches the server (`canCall`). */
  canCall(): boolean
  /** `note.search` on the server. The text goes in the call's payload, never in a URL. */
  server(q: string, signal: AbortSignal): Promise<{ notes: readonly WireHit[] }>
  /** The groups the person belongs to now: the device's copy may still hold groups they left. */
  groupIds(): readonly string[]
  /** The group the notes pages show. */
  selectedGroupId(): string | null
  /** The notes the notes store holds for `groupId`, or `null` when it holds another group's. */
  loadedNotes(groupId: string): readonly NoteItem[] | null
  /** A group's notes saved on this device; empty when nothing is saved or the copy is off. */
  deviceNotes(groupId: string): Promise<readonly NoteItem[]>
}

/**
 * The palette's note search. With the empty query it answers the selected group's most recent
 * notes, from what the page already holds. Otherwise it asks the server, and when the server
 * cannot be reached (no connection, or a proxy answering for it) it searches the notes saved on
 * this device instead, in the person's current groups only, and says so with `onDevice`. A refusal
 * of the server, such as the rate limit, rejects: the palette shows it under Notes.
 */
export function createNoteSearch(
  sources: NoteSearchSources,
): (query: string, signal: AbortSignal) => Promise<SearchNotesAnswer> {
  const indexOf = noteIndex()
  return async (query, signal) => {
    if (query === "") return { notes: await recentNotes(sources), onDevice: !sources.canCall() }
    if (sources.canCall()) {
      try {
        const answer = await sources.server(query, signal)
        return { notes: answer.notes.map(fromWire), onDevice: false }
      } catch (error) {
        if (signal.aborted || !(isUnreachable(error) || isProxyAnswer(error))) throw error
      }
    }
    return { notes: await notesOnDevice(sources, indexOf, query), onDevice: true }
  }
}

/** The selected group's {@link RECENT_NOTES} most recently changed notes. */
async function recentNotes(sources: NoteSearchSources): Promise<SearchNote[]> {
  const groupId = sources.selectedGroupId()
  if (groupId === null || !sources.groupIds().includes(groupId)) return []
  const notes = sources.loadedNotes(groupId) ?? await readDevice(sources, groupId)
  return newestFirst(notes).slice(0, RECENT_NOTES).map(fromDevice)
}

/**
 * The saved notes of the person's groups that match `query`, best match first and the newest first
 * among equal matches, as the server ranks them. It matches word prefixes and forgives a typo and
 * the other keyboard layout. Only the first {@link NOTE_SEARCH_MAX_LENGTH} characters count, the
 * most the server takes, so pasted text cannot stall the page. A note whose body matched shows the
 * text around the match; one matched by its title shows the start of its body.
 */
async function notesOnDevice(
  sources: NoteSearchSources,
  indexOf: (notes: readonly NoteItem[]) => SearchIndex<NoteEntry>,
  query: string,
): Promise<SearchNote[]> {
  const saved = (await Promise.all(sources.groupIds().map((id) => readDevice(sources, id)))).flat()
  const words = Array.from(query).slice(0, NOTE_SEARCH_MAX_LENGTH).join(``)
  const { hits } = indexOf(saved).search(words, { limit: NOTE_SEARCH_LIMIT })
  return hits.map(({ entry, snippet }) => ({
    ...fromDevice(entry.note),
    ...(snippet && { snippet: snippet.map((part) => part.text).join(``) }),
  }))
}

/** A saved note as the search index holds it: the title is the label, the body the text. */
interface NoteEntry extends SearchEntry {
  note: NoteItem
}

/**
 * The index of the saved notes, kept between queries and built again only when a note's text,
 * group or date changes or the set of notes does: building it costs more than searching it.
 */
function noteIndex(): (notes: readonly NoteItem[]) => SearchIndex<NoteEntry> {
  let built: { key: string; index: SearchIndex<NoteEntry> } | undefined
  return (notes) => {
    const key = JSON.stringify(notes.map((n) => [n.id, n.groupId, n.updatedAt, n.title, n.body]))
    if (built?.key !== key) {
      const entries = newestFirst(notes).map((note) => ({
        label: note.title,
        text: note.body,
        note,
      }))
      built = { key, index: createIndex(entries) }
    }
    return built.index
  }
}

/** A group's saved notes, or none when the device cannot read them. */
async function readDevice(
  sources: NoteSearchSources,
  groupId: string,
): Promise<readonly NoteItem[]> {
  try {
    // A copy holds only the group it is saved under; a note moved since is dropped.
    return (await sources.deviceNotes(groupId)).filter((note) => note.groupId === groupId)
  } catch {
    return []
  }
}

function newestFirst(notes: readonly NoteItem[]): NoteItem[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function fromWire(hit: WireHit): SearchNote {
  return { id: hit.id, groupId: hit.groupId, title: hit.title, snippet: hit.snippet }
}

/** A saved note as a row, its snippet the body's start. */
function fromDevice(note: NoteItem): SearchNote {
  return {
    id: note.id,
    groupId: note.groupId,
    title: note.title,
    snippet: trimNoteSnippet(note.body, true, true),
  }
}
