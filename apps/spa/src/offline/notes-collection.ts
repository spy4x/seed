import { RealtimeRequestError } from "@spy4x/realtime"
import {
  classifyByCode,
  type Collection,
  type CollectionDefinition,
  defineCollection,
} from "@spy4x/realtime/collections"
import type { OutboxStore } from "@spy4x/realtime/outbox"
import { isProxyAnswer, isRefusal, isUnreachable } from "@spy4x/realtime/read-cache"
import type { NoteItem, NotePage, NotesDependencies } from "../state/notes.ts"
import { TAGS_COLLECTION } from "./tags-collection.ts"
import { databasePrefix, type NoteEntry, type NotePayload, type NotesCache } from "./notes-cache.ts"

/**
 * The notes adapter: everything that is the notes' own about being offline-writable (ADR 003,
 * level 3). The queue, its order, the conflicts and the overlay are the library's
 * (`@spy4x/realtime/collections`); this file names the commands, the error codes, the wording and
 * the row a queued note shows as, and puts the queue in front of the notes store's dependencies.
 */

/** The notes store's own cap on pages, so a runaway cursor stops the same way in both. */
const MAX_PAGES = 20

/** The notes as a collection: a note is the entity and the row, its text the payload. */
export type NotesCollection = Collection<NotePayload, NoteItem, NoteItem>

/** What {@link notesCollection} is built from. */
export interface NotesCollectionOptions {
  /** The queue's owner: the database is named for them, and a queued note is shown as theirs. */
  userId: number
  /** The device's copy of the notes, kept in step with the server's answers. */
  cache: NotesCache
  /** A queue to use instead of IndexedDB: the tests, which have none. */
  store?: OutboxStore<NotePayload, NoteItem>
}

/**
 * Reads a failed note call: unreachable (try later) or the server's refusal and its code. A write
 * answered `unauthorized` stays queued: the library's default.
 */
export const classifyNoteError = classifyByCode({
  version: "VERSION_CONFLICT",
  notFound: "NOTE_NOT_FOUND",
  alreadyExists: "ID_ALREADY_EXISTS",
})

/**
 * The notes of one user as an offline-writable collection. The queue lives in
 * `offline:user:<id>:outbox`, the database it has always had, in the library's own entry shape, so
 * a write queued by an earlier version of this app is read and sent unchanged.
 */
export function notesCollection(
  { userId, cache, store }: NotesCollectionOptions,
): CollectionDefinition<NotePayload, NoteItem, NoteItem> {
  return defineCollection<NotePayload, NoteItem, NoteItem>({
    name: "notes",
    database: `${databasePrefix(userId)}:outbox`,
    store,
    toCall({ kind, entityId, payload, baseVersion }) {
      const base = { groupId: payload.groupId, id: entityId }
      if (kind === "delete") {
        return { name: "note.delete", payload: { ...base, version: baseVersion } }
      }
      const text = { title: payload.title, body: payload.body }
      // A note queued before tags existed has no `tagIds`; sending none leaves its tags alone.
      const tags = payload.tagIds === undefined ? {} : { tagIds: payload.tagIds }
      return kind === "create"
        ? { name: "note.create", payload: { ...base, ...text, tagIds: payload.tagIds ?? [] } }
        : { name: "note.update", payload: { ...base, ...text, ...tags, version: baseVersion } }
    },
    // The queued entry knows the note's group, which the read needs.
    toQuery: (id, payload) => ({ name: "note.get", payload: { groupId: payload.groupId, id } }),
    entityFrom: (answer) => (answer as { note?: NoteItem } | undefined)?.note,
    classify: classifyNoteError,
    // Keys of the `app` catalog, kept with the queued write. `OfflineStatus` shows the one a
    // conflict holds through `messageText`, in the person's language at that time; an entry queued
    // in English before #275 holds English, which it shows as it is.
    messages: { version: `NoteSync.version`, gone: `NoteSync.gone` },
    cache: {
      put: (note) => cache.putNote(note),
      remove: (noteId) => cache.removeNote(noteId),
    },
    itemId: (note) => note.id,
    // A note created offline shows with version 0: the server has not seen it.
    queuedItem: (entry) => ({
      id: entry.entityId,
      groupId: entry.payload.groupId,
      title: entry.payload.title,
      body: entry.payload.body,
      tagIds: entry.payload.tagIds ?? [],
      version: 0,
      changeSequence: "0",
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: entry.queuedAt,
      updatedAt: entry.queuedAt,
    }),
    applyEdit: (note, entry) => ({
      ...note,
      title: entry.payload.title,
      body: entry.payload.body,
      tagIds: entry.payload.tagIds ?? note.tagIds,
    }),
    // A note names its tags (ADR 003, section 5): it waits for a tag still in the queue, and loses
    // the reference when that tag will never exist. A delete names none.
    dependencies: {
      parents: [TAGS_COLLECTION],
      on: (entry) =>
        entry.kind === "delete" ? [] : (entry.payload.tagIds ?? []).map((entityId) => ({
          collection: TAGS_COLLECTION,
          entityId,
        })),
      without: (payload, parent) =>
        payload.tagIds === undefined
          ? payload
          : { ...payload, tagIds: payload.tagIds.filter((id) => id !== parent.entityId) },
    },
    inScope: (entry, groupId) => entry.payload.groupId === groupId,
  })
}

/** What the notes dependencies need of the running layer. */
export interface NotesLayer {
  /** The device's copy of the notes. */
  cache: NotesCache
  /** The queue of note writes and its overlay. */
  notes: NotesCollection
}

/**
 * Puts the device's copy and the queue behind the notes store's dependencies:
 * - a read asks the server for the whole list, keeps it and answers with the queued writes
 *   applied; with the server unreachable (no connection, or a proxy's answer) it answers from
 *   what was kept, and a group the server refuses loses what was kept of it;
 * - a write is queued and sent at once when the server is reachable, and stays queued when it is
 *   not.
 *
 * Without a running layer every call goes to `online` untouched.
 */
export function offlineNotes(
  online: NotesDependencies,
  current: () => NotesLayer | null,
): NotesDependencies {
  /** The note as this person sees it, with the queued writes applied. */
  async function visible(layer: NotesLayer, groupId: string, id: string) {
    const notes = await layer.notes.overlay(await layer.cache.readNotes(groupId), groupId)
    return notes.find((note) => note.id === id)
  }

  return {
    ...online,
    async fetchPage(groupId, _cursor, deleted): Promise<NotePage> {
      const layer = current()
      // The deleted notes are read from the server only: the device keeps no copy of them.
      if (!layer || deleted) return await online.fetchPage(groupId, _cursor, deleted)
      let base: NoteItem[]
      try {
        base = []
        let cursor: string | null = null
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await online.fetchPage(groupId, cursor)
          base.push(...result.notes)
          cursor = result.nextCursor
          if (cursor === null) break
        }
        await layer.cache.replaceNotes(groupId, base)
      } catch (error) {
        // The person left the group, or it is gone: its notes must not come back offline later.
        if (isRefusal(error)) {
          await layer.cache.replaceNotes(groupId, []).catch((failure) =>
            console.warn(`The saved notes of group ${groupId} could not be deleted.`, failure)
          )
        }
        // A proxy's answer, such as a 502 during a deploy, is an unreachable server too.
        if (!isUnreachable(error) && !isProxyAnswer(error)) throw error
        base = await layer.cache.readNotes(groupId)
      }
      return { notes: await layer.notes.overlay(base, groupId), nextCursor: null }
    },
    async get(groupId, id) {
      const layer = current()
      if (!layer) return await online.get(groupId, id)
      try {
        const { note } = await online.get(groupId, id)
        await layer.cache.putNote(note)
        const [mine] = (await layer.notes.overlay([note], groupId)).filter((n) => n.id === id)
        return { note: mine ?? note }
      } catch (error) {
        // The server's "not found" is final, except for a note created here and not yet sent.
        const local = await visible(layer, groupId, id)
        if (local && (!(error instanceof RealtimeRequestError) || local.version === 0)) {
          return { note: local }
        }
        throw error
      }
    },
    async create(input) {
      const layer = current()
      if (!layer) return await online.create(input)
      const outcome = await layer.notes.outbox.submit({
        kind: "create",
        entityId: input.id,
        payload: {
          groupId: input.groupId,
          title: input.title,
          body: input.body,
          tagIds: input.tagIds,
        },
      })
      return await answer(layer, outcome, input.groupId, input.id)
    },
    async update(input) {
      const layer = current()
      if (!layer) return await online.update(input)
      const outcome = await layer.notes.outbox.submit({
        kind: "update",
        entityId: input.id,
        payload: {
          groupId: input.groupId,
          title: input.title,
          body: input.body,
          tagIds: input.tagIds,
        },
        version: input.version,
      })
      return await answer(layer, outcome, input.groupId, input.id)
    },
    async delete(input) {
      const layer = current()
      if (!layer) return await online.delete(input)
      const known = await visible(layer, input.groupId, input.id)
      const outcome = await layer.notes.outbox.submit({
        kind: "delete",
        entityId: input.id,
        payload: { groupId: input.groupId, title: known?.title ?? "", body: known?.body ?? "" },
        version: input.version,
      })
      if (outcome.kind === "failed") throw outcome.error
      return undefined
    },
    async restore(input) {
      const layer = current()
      // An Undo of a delete that has not left the device takes the queued delete back: no
      // network is needed, and nothing reaches the server.
      if (layer && await layer.notes.outbox.withdraw(input.id)) {
        const note = await visible(layer, input.groupId, input.id)
        if (note) return { note }
      }
      // Otherwise it needs the server, like a move: it is never queued, so a person offline is
      // told so.
      const result = await online.restore(input)
      if (layer) await layer.cache.putNote(result.note)
      return result
    },
    async move(input) {
      const result = await online.move(input)
      // The moved notes now belong to the other group on this device too. Writes still queued for
      // them were made in the old group, and the server refuses those as a conflict.
      const layer = current()
      if (layer) { for (const note of result.notes) await layer.cache.putNote(note) }
      return result
    },
    async readLocal(groupId) {
      const layer = current()
      if (!layer) return []
      return await layer.notes.overlay(await layer.cache.readNotes(groupId), groupId)
    },
  }

  async function answer(
    layer: NotesLayer,
    outcome: Awaited<ReturnType<NotesCollection["outbox"]["submit"]>>,
    groupId: string,
    id: string,
  ): Promise<{ note: NoteItem }> {
    if (outcome.kind === "failed") throw outcome.error
    const note = await visible(layer, groupId, id)
    if (!note) throw new Error("The note is not in the local store")
    return { note }
  }
}

export type { NoteEntry }
