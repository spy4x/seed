import type { ChangesAnswer, ChangesCopy } from "@spy4x/realtime/changes"
import type { NoteItem } from "../state/notes.ts"
import type { TagItem } from "../state/tags.ts"
import type { ChangesRows } from "./device-copy.ts"

/**
 * The changes copy and a server's `group.changes` in memory, for the tests of the offline layer:
 * Deno has no IndexedDB. `device-copies.test.ts` runs the IndexedDB copy itself.
 */

const KINDS = ["notes", "tags"] as const

/** A {@link ChangesCopy} in memory with the IndexedDB one's behaviour, except that `clear` does not finish it. */
export function createMemoryChangesCopy(): ChangesCopy<ChangesRows> {
  const rows = new Map<string, Map<string, unknown>>()
  const cursors = new Map<string, number>()
  const scope = (kind: string, groupId: string) => JSON.stringify([kind, groupId])
  const of = (kind: string, groupId: string) => {
    const key = scope(kind, groupId)
    if (!rows.has(key)) rows.set(key, new Map())
    return rows.get(key)!
  }
  return {
    cursor: (groupId) => Promise.resolve(cursors.get(groupId)),
    read: (kind, groupId) =>
      Promise.resolve([...of(kind, groupId).values()].map((row) => structuredClone(row)) as never),
    apply(groupId, change) {
      for (const kind of KINDS) {
        for (const row of change.upserts[kind] ?? []) {
          of(kind, groupId).set(row.id, structuredClone(row))
        }
      }
      for (const gone of change.tombstones) of(gone.kind, groupId).delete(gone.id)
      cursors.set(groupId, change.through)
      return Promise.resolve()
    },
    replace(groupId, all, through) {
      for (const kind of KINDS) {
        rows.set(
          scope(kind, groupId),
          new Map((all[kind] ?? []).map((row) => [row.id, structuredClone(row)])),
        )
      }
      cursors.set(groupId, through)
      return Promise.resolve()
    },
    drop(groupId) {
      for (const kind of KINDS) rows.delete(scope(kind, groupId))
      cursors.delete(groupId)
      return Promise.resolve()
    },
    clear() {
      rows.clear()
      cursors.clear()
      return Promise.resolve()
    },
  }
}

/** A server's notes and tags, as a test sets them, answering `group.changes` for them. */
export interface ChangesServer {
  notes: NoteItem[]
  tags: TagItem[]
  /** The answer to `group.changes` of `groupId` after `after`. */
  answer(groupId: string, after: number): ChangesAnswer
}

/**
 * A server whose sequence moves whenever `notes` or `tags` changed since its last answer, and that
 * answers every cursor but the current one "too old": the device reads in full whenever anything
 * changed. Real cursors are covered by `device-copy.test.ts` and the integration tests.
 */
export function createChangesServer(
  initial: { notes?: NoteItem[]; tags?: TagItem[] } = {},
): ChangesServer {
  let current = 1
  let seen = ""
  const server: ChangesServer = {
    notes: initial.notes ?? [],
    tags: initial.tags ?? [],
    answer(groupId, after) {
      const now = JSON.stringify([server.notes, server.tags])
      if (seen !== "" && now !== seen) current++
      seen = now
      if (after !== 0 && after !== current) return { status: "too-old", current }
      const full = after === 0
      return {
        status: "changes",
        after,
        through: current,
        current,
        more: false,
        upserts: {
          notes: full ? server.notes.filter((note) => note.groupId === groupId) : [],
          tags: full ? server.tags.filter((tag) => tag.groupId === groupId) : [],
        },
        tombstones: [],
      }
    },
  }
  return server
}
