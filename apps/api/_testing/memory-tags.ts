import {
  assertTagRoom,
  type DeletedTag,
  type ListedTag,
  type Tag,
  type TagCreateInput,
  type TagDeleteInput,
  TagError,
  type TagRepository,
  type TagUpdateInput,
  TagVersionConflictError,
  type TagWriteResult,
} from "@domain/tags"
import type { MemoryNoteRepository } from "./memory-notes.ts"

/**
 * Tags in memory, with the Postgres repository's rules: names are unique in a group without regard
 * to case, a group holds at most `TAG_MAX_PER_GROUP`, a write at another version is refused with
 * the current one, and deleting a tag removes it from the notes that carried it without moving
 * their version.
 */
export class MemoryTagRepository implements TagRepository {
  readonly tags = new Map<string, Tag>()
  writes = 0
  #sequence = 1

  /** Wires the notes to this repository, so they know which tags exist and lose deleted ones. */
  constructor(private readonly notes?: MemoryNoteRepository) {
    if (notes) notes.knowsTag = (groupId, id) => this.tags.get(id)?.groupId === groupId
  }

  /** The notes' count comes from the live notes only, as in Postgres; without notes it is 0. */
  list(groupId: string): Promise<ListedTag[]> {
    const live = [...(this.notes?.notes.values() ?? [])]
    return Promise.resolve(
      [...this.tags.values()].filter((tag) => tag.groupId === groupId)
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        .map((tag) => ({
          ...tag,
          noteCount: live.filter((note) => note.tagIds.includes(tag.id)).length,
        })),
    )
  }

  get(groupId: string, id: string): Promise<Tag | null> {
    const tag = this.tags.get(id)
    return Promise.resolve(tag && tag.groupId === groupId ? tag : null)
  }

  create(input: TagCreateInput, actorId: number): Promise<TagWriteResult> {
    const existing = this.tags.get(input.id)
    if (existing) {
      if (
        existing.groupId === input.groupId && existing.name === input.name &&
        existing.color === input.color && existing.createdByUserId === actorId
      ) {
        return Promise.resolve({ tag: existing, created: false })
      }
      throw new TagError("ID_ALREADY_EXISTS", "taken")
    }
    this.#assertNameFree(input.groupId, input.name, input.id)
    assertTagRoom([...this.tags.values()].filter((tag) => tag.groupId === input.groupId).length + 1)
    const at = new Date("2026-10-02T10:00:00.000Z")
    const tag: Tag = {
      id: input.id,
      groupId: input.groupId,
      name: input.name,
      color: input.color,
      version: 1,
      changeSequence: String(this.#sequence++),
      createdByUserId: actorId,
      updatedByUserId: actorId,
      createdAt: at,
      updatedAt: at,
    }
    this.tags.set(tag.id, tag)
    this.writes++
    return Promise.resolve({ tag, created: true })
  }

  update(input: TagUpdateInput, actorId: number): Promise<Tag> {
    const tag = this.#current(input.groupId, input.id, input.expectedVersion)
    this.#assertNameFree(input.groupId, input.name, input.id)
    const next: Tag = {
      ...tag,
      name: input.name,
      color: input.color,
      version: tag.version + 1,
      changeSequence: String(this.#sequence++),
      updatedByUserId: actorId,
    }
    this.tags.set(next.id, next)
    this.writes++
    return Promise.resolve(next)
  }

  delete(input: TagDeleteInput, _actorId: number): Promise<DeletedTag> {
    const tag = this.#current(input.groupId, input.id, input.expectedVersion)
    this.tags.delete(tag.id)
    this.notes?.forgetTag(tag.id)
    this.writes++
    return Promise.resolve({
      id: tag.id,
      groupId: tag.groupId,
      version: tag.version,
      changeSequence: String(this.#sequence++),
    })
  }

  #assertNameFree(groupId: string, name: string, exceptId: string): void {
    for (const tag of this.tags.values()) {
      if (
        tag.groupId === groupId && tag.id !== exceptId &&
        tag.name.toLowerCase() === name.toLowerCase()
      ) throw new TagError("TAG_NAME_TAKEN", "A tag with this name exists")
    }
  }

  #current(groupId: string, id: string, expectedVersion: number): Tag {
    const tag = this.tags.get(id)
    if (!tag || tag.groupId !== groupId) throw new TagError("TAG_NOT_FOUND", "gone")
    if (tag.version !== expectedVersion) throw new TagVersionConflictError(tag.version)
    return tag
  }
}
