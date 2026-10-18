import { assertRoomFor } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import {
  type DeletedNote,
  type GroupRoleLookup,
  type Note,
  type NoteCreateInput,
  type NoteDeleteInput,
  NoteError,
  type NoteListPage,
  type NoteListResult,
  type NoteMoveInput,
  type NoteRepository,
  type NoteRestoreInput,
  type NoteSearchHit,
  type NoteUpdateInput,
  NoteVersionConflictError,
  type NoteWriteResult,
} from "@domain/notes"

/**
 * Notes in memory, with the Postgres repository's version rules: an update or delete at another
 * version is refused with the current one. `writes` counts every write that changed something.
 */
export class MemoryNoteRepository implements NoteRepository {
  readonly notes = new Map<string, Note>()
  /** Deleted notes, kept as the database keeps them until a restore or the purge. */
  readonly deleted = new Map<string, Note>()
  writes = 0
  #sequence = 1
  /**
   * Whether the group has a tag with this id: what the Postgres repository reads from `tags`.
   * Without it no tag is known, so every tag id is ignored, as for an id the group never had.
   */
  knowsTag: (groupId: string, tagId: string) => boolean = () => false

  /** Who is in which group, for `groupIdOfForMember`; without it no one is a member. */
  constructor(private readonly groups?: GroupRoleLookup) {}

  list(groupId: string, page: NoteListPage, deleted = false): Promise<NoteListResult> {
    const notes = [...(deleted ? this.deleted : this.notes).values()].filter((note) =>
      note.groupId === groupId
    )
      .slice(0, page.limit)
    return Promise.resolve({ notes, nextPageKey: null })
  }

  get(groupId: string, id: string): Promise<Note | null> {
    const note = this.notes.get(id)
    return Promise.resolve(note && note.groupId === groupId ? note : null)
  }

  async groupIdOfForMember(id: string, userId: number): Promise<string | null> {
    const groupId = this.notes.get(id)?.groupId
    if (!groupId || !this.groups) return null
    return await this.groups.roleOf(groupId, userId) === null ? null : groupId
  }

  /**
   * Live notes in the user's groups whose title or body contains every word of `text`, newest
   * first. A stand-in for the full text query; the integration test covers the real one.
   */
  async searchForMember(userId: number, text: string, limit: number): Promise<NoteSearchHit[]> {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean)
    const hits: NoteSearchHit[] = []
    for (const note of this.notes.values()) {
      if (!this.groups || await this.groups.roleOf(note.groupId, userId) === null) continue
      const haystack = `${note.title} ${note.body}`.toLowerCase()
      if (!words.every((word) => haystack.includes(word))) continue
      hits.push({
        id: note.id,
        groupId: note.groupId,
        title: note.title,
        snippet: note.body.slice(0, 120),
        updatedAt: note.updatedAt,
      })
    }
    return hits.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, limit)
  }

  /** Drops a deleted tag from every note, as the foreign key does; no note's version moves. */
  forgetTag(tagId: string): void {
    for (const notes of [this.notes, this.deleted]) {
      for (const [id, note] of notes) {
        if (note.tagIds.includes(tagId)) {
          notes.set(id, { ...note, tagIds: note.tagIds.filter((existing) => existing !== tagId) })
        }
      }
    }
  }

  #real(groupId: string, tagIds: readonly string[] | undefined): string[] {
    return [...new Set(tagIds ?? [])].filter((id) => this.knowsTag(groupId, id)).sort()
  }

  create(
    input: NoteCreateInput,
    actorId: number,
    allowance: number | null,
  ): Promise<NoteWriteResult> {
    if (this.notes.has(input.id)) throw new NoteError("ID_ALREADY_EXISTS", "taken")
    const used = [...this.notes.values()].filter((note) => note.groupId === input.groupId).length
    assertRoomFor("maxNotes", allowance, used, GroupRole.EDITOR)
    const at = new Date("2026-10-02T10:00:00.000Z")
    const note: Note = {
      ...input,
      tagIds: this.#real(input.groupId, input.tagIds),
      version: 1,
      changeSequence: String(this.#sequence++),
      createdByUserId: actorId,
      updatedByUserId: actorId,
      createdAt: at,
      updatedAt: at,
    }
    this.notes.set(note.id, note)
    this.writes++
    return Promise.resolve({ note, created: true })
  }

  update(input: NoteUpdateInput, actorId: number): Promise<Note> {
    const note = this.#current(input.groupId, input.id, input.expectedVersion)
    const next: Note = {
      ...note,
      title: input.title,
      body: input.body,
      tagIds: input.tagIds === undefined ? note.tagIds : this.#real(note.groupId, input.tagIds),
      version: note.version + 1,
      changeSequence: String(this.#sequence++),
      updatedByUserId: actorId,
    }
    this.notes.set(next.id, next)
    this.writes++
    return Promise.resolve(next)
  }

  delete(input: NoteDeleteInput, _actorId: number): Promise<DeletedNote> {
    const note = this.#current(input.groupId, input.id, input.expectedVersion)
    const changeSequence = String(this.#sequence++)
    this.notes.delete(note.id)
    this.deleted.set(note.id, { ...note, version: note.version + 1, changeSequence })
    this.writes++
    return Promise.resolve({
      id: note.id,
      groupId: note.groupId,
      version: note.version + 1,
      changeSequence,
    })
  }

  restore(input: NoteRestoreInput, actorId: number, allowance: number | null): Promise<Note> {
    const note = this.deleted.get(input.id)
    if (!note || note.groupId !== input.groupId) throw new NoteError("NOTE_NOT_FOUND", "gone")
    const used = [...this.notes.values()].filter((live) => live.groupId === input.groupId).length
    assertRoomFor("maxNotes", allowance, used, GroupRole.EDITOR)
    const restored: Note = {
      ...note,
      version: note.version + 1,
      changeSequence: String(this.#sequence++),
      updatedByUserId: actorId,
    }
    this.deleted.delete(note.id)
    this.notes.set(restored.id, restored)
    this.writes++
    return Promise.resolve(restored)
  }

  move(input: NoteMoveInput, actorId: number, allowance: number | null): Promise<Note[]> {
    const notes = input.noteIds.map((id) => {
      const note = this.notes.get(id)
      if (!note || note.groupId !== input.fromGroupId) {
        throw new NoteError("NOTE_NOT_FOUND", "gone")
      }
      return note
    })
    const used = [...this.notes.values()].filter((note) => note.groupId === input.toGroupId).length
    assertRoomFor("maxNotes", allowance, used + notes.length - 1, GroupRole.EDITOR)
    const sequence = String(this.#sequence++)
    const moved = notes.map((note): Note => ({
      ...note,
      groupId: input.toGroupId,
      version: note.version + 1,
      changeSequence: sequence,
      updatedByUserId: actorId,
    }))
    for (const note of moved) this.notes.set(note.id, note)
    this.writes++
    return Promise.resolve(moved)
  }

  #current(groupId: string, id: string, expectedVersion: number): Note {
    const note = this.notes.get(id)
    if (!note || note.groupId !== groupId) throw new NoteError("NOTE_NOT_FOUND", "gone")
    if (note.version !== expectedVersion) throw new NoteVersionConflictError(note.version)
    return note
  }
}

/** Roles by `groupId:userId`; anyone not listed is not a member. */
export function roles(entries: Record<string, GroupRole>): GroupRoleLookup {
  return {
    roleOf: (groupId, userId) => Promise.resolve(entries[`${groupId}:${userId}`] ?? null),
  }
}
