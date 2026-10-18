import { isProxyAnswer, isUnreachable } from "@spy4x/realtime/read-cache"
import { filterRows, search } from "@spy4x/platform/universal/text"
import { NOTE_SEARCH_LIMIT, type NoteSearchHit, trimNoteSnippet } from "@domain/notes"
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
 * of the server, such as the rate limit, rejects: the palette shows its error line.
 */
export function createNoteSearch(
  sources: NoteSearchSources,
): (query: string, signal: AbortSignal) => Promise<SearchNotesAnswer> {
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
    return { notes: await notesOnDevice(sources, query), onDevice: true }
  }
}

/** The selected group's {@link RECENT_NOTES} most recently changed notes. */
async function recentNotes(sources: NoteSearchSources): Promise<SearchNote[]> {
  const groupId = sources.selectedGroupId()
  if (groupId === null || !sources.groupIds().includes(groupId)) return []
  const notes = sources.loadedNotes(groupId) ?? await readDevice(sources, groupId)
  return newestFirst(notes).slice(0, RECENT_NOTES).map(fromDevice)
}

/** The saved notes of the person's groups that hold every word of `query`, newest first. */
async function notesOnDevice(sources: NoteSearchSources, query: string): Promise<SearchNote[]> {
  const saved = (await Promise.all(sources.groupIds().map((id) => readDevice(sources, id)))).flat()
  const found = filterRows(
    saved,
    query,
    (note, word) => search(note.title, word) || search(note.body, word),
  )
  return newestFirst(found).slice(0, NOTE_SEARCH_LIMIT).map(fromDevice)
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

/** A saved note as a row: the device has no match position, so the snippet is the body's start. */
function fromDevice(note: NoteItem): SearchNote {
  return {
    id: note.id,
    groupId: note.groupId,
    title: note.title,
    snippet: trimNoteSnippet(note.body, true, true),
  }
}
