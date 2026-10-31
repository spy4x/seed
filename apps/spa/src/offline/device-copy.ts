import { type } from "arktype"
import {
  type ChangesCopy,
  type ChangesKinds,
  createChangesCopy,
  createChangesPull,
} from "@spy4x/realtime/changes"
import type { OutboxLock } from "@spy4x/realtime/outbox"
import { isProxyAnswer, isRefusal, isUnreachable } from "@spy4x/realtime/read-cache"
import type { NoteItem } from "../state/notes.ts"
import type { TagItem } from "../state/tags.ts"
import { databasePrefix, type NotesCache } from "./notes-cache.ts"
import type { TagsCache } from "./tags-cache.ts"

/**
 * The device's copy of each group's notes and tags, kept by the changes pull of
 * `@spy4x/realtime/changes` (`docs/offline.md`, "Reads: the device first"). One database per user
 * holds every group's rows and the sequence they are complete through, written together, so a
 * read after a pull asks the server only for what changed since the last one.
 */

/** The rows the pull keeps, by the kind names the server sends (`group.changes`). */
export interface ChangesRows {
  notes: NoteItem
  tags: TagItem
}

const stamps = {
  id: "string",
  groupId: "string",
  version: "number",
  changeSequence: "string",
  createdByUserId: "number | null",
  updatedByUserId: "number | null",
  createdAt: "string",
  updatedAt: "string",
} as const
const noteRow = type({ ...stamps, title: "string", body: "string", tagIds: "string[]" })
const tagRow = type({ ...stamps, name: "string", color: "string" })

/** How the pull checks each kind of row the server sends. */
export const CHANGES_KINDS: ChangesKinds<ChangesRows> = {
  notes: { row: { assert: (value) => noteRow.assert(value) }, id: (note) => note.id },
  tags: { row: { assert: (value) => tagRow.assert(value) as TagItem }, id: (tag) => tag.id },
}

/** The name of a user's copy database. */
export function changesDatabase(userId: number): string {
  return `${databasePrefix(userId)}:changes`
}

/** The user's copy on this browser's IndexedDB; a test passes its own factory. */
export function openChangesCopy(userId: number, indexedDB?: IDBFactory): ChangesCopy<ChangesRows> {
  return createChangesCopy({ name: changesDatabase(userId), kinds: CHANGES_KINDS, indexedDB })
}

/** One user's copy as the layer uses it: the pull, and a notes and a tags view over it. */
export interface DeviceCopy {
  /** Brings the group's copy up to the server's current sequence. A refusal rejects. */
  pull(groupId: string): Promise<void>
  /** Deletes the group's copy, for a group the person may no longer read. */
  drop(groupId: string): Promise<void>
  /** Deletes every group's copy, for sign-out. A write that arrives later saves nothing. */
  clear(): Promise<void>
  notes: NotesCache
  tags: TagsCache
}

/** What {@link deviceCopy} is built from. */
export interface DeviceCopyOptions {
  copy: ChangesCopy<ChangesRows>
  /** Asks the server for `group.changes` after `after`; a refusal rejects. */
  fetch(groupId: string, after: number): Promise<unknown>
  /** One pull at a time across the tabs that share the copy. */
  lock?: OutboxLock
}

/** Newest change first, as the server lists notes (`updated_at DESC, id`). */
function byNewest(a: NoteItem, b: NoteItem): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const NO_ROWS = { notes: [], tags: [] }

/**
 * The copy behind the notes and tags views. A row a write answered with (`putNote`, `putTag`) is
 * put at the cursor the group already has, never past it: a change another member made meanwhile
 * still arrives with the next pull. A group with no copy yet (its first pull failed) keeps the row
 * at cursor `0`, so the write the person just made still shows, and the next pull reads every
 * change from the start. A row older than the one held (a slow answer that a pull overtook) is
 * ignored.
 *
 * A put that runs beside a pull may store the cursor the pull just moved past. The next pull then
 * reads those changes again, which puts the same rows and deletes the same ids: nothing is lost.
 */
export function deviceCopy({ copy, fetch, lock }: DeviceCopyOptions): DeviceCopy {
  const pullGroup = createChangesPull({ kinds: CHANGES_KINDS, copy, fetch, lock })
  /** The groups read since the copy opened: where a removed row may be held. */
  const known = new Set<string>()

  async function put<K extends keyof ChangesRows & string>(kind: K, row: ChangesRows[K]) {
    // A moved row leaves every other group this device read.
    for (const other of known) if (other !== row.groupId) await remove(kind, row.id, other)
    known.add(row.groupId)
    const through = await copy.cursor(row.groupId) ?? 0
    const held = (await copy.read(kind, row.groupId)).find((existing) => existing.id === row.id)
    if (held && held.version > row.version) return
    await copy.apply(row.groupId, {
      upserts: { ...NO_ROWS, [kind]: [row] },
      tombstones: [],
      through,
    })
  }

  async function remove(kind: keyof ChangesRows & string, id: string, groupId: string) {
    const through = await copy.cursor(groupId)
    if (through === undefined) return
    await copy.apply(groupId, { upserts: NO_ROWS, tombstones: [{ kind, id }], through })
  }

  async function removeEverywhere(kind: keyof ChangesRows & string, id: string) {
    for (const groupId of known) await remove(kind, id, groupId)
  }

  return {
    async pull(groupId) {
      known.add(groupId)
      await pullGroup(groupId)
    },
    drop: (groupId) => copy.drop(groupId),
    clear: () => copy.clear(),
    notes: {
      async readNotes(groupId) {
        known.add(groupId)
        const [notes, tags] = await Promise.all([
          copy.read("notes", groupId),
          copy.read("tags", groupId),
        ])
        // A deleted tag takes its links but moves no note (ADR 003, section 5, rule 3): a note
        // names only the tags the copy still holds.
        const held = new Set(tags.map((tag) => tag.id))
        return notes
          .map((note) => ({ ...note, tagIds: note.tagIds.filter((id) => held.has(id)) }))
          .sort(byNewest)
      },
      putNote: (note) => put("notes", note),
      removeNote: (noteId) => removeEverywhere("notes", noteId),
      clear: () => copy.clear(),
    },
    tags: {
      async readTags(groupId) {
        known.add(groupId)
        const [tags, notes] = await Promise.all([
          copy.read("tags", groupId),
          copy.read("notes", groupId),
        ])
        // The pull sends no counts: the copy holds every live note, so it counts them itself.
        const counts = new Map<string, number>()
        for (const note of notes) {
          for (const id of note.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1)
        }
        return tags.map((tag) => ({ ...tag, noteCount: counts.get(tag.id) ?? 0 }))
      },
      putTag: (tag) => put("tags", tag),
      removeTag: (tagId) => removeEverywhere("tags", tagId),
      clear: () => copy.clear(),
    },
  }
}

/**
 * Pulls the group's changes into the device's copy. A refusal (the person left the group, or it is
 * gone) deletes the group's copy, so its notes and tags never come back offline, and rejects. An
 * unreachable server, or a proxy answering for it such as a 502 during a deploy, leaves the copy as
 * it is for the caller to read. The notes and the tags reads call it.
 */
export async function pullOrKeep(
  layer: { copy: Pick<DeviceCopy, "pull" | "drop"> },
  groupId: string,
): Promise<void> {
  try {
    await layer.copy.pull(groupId)
  } catch (error) {
    if (isRefusal(error)) {
      await layer.copy.drop(groupId).catch((failure) =>
        console.warn(`The saved copy of group ${groupId} could not be deleted.`, failure)
      )
    }
    if (!isUnreachable(error) && !isProxyAnswer(error)) throw error
  }
}
