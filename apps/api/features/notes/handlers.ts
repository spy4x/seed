import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import {
  assertCanReadNotes,
  assertCanWriteNotes,
  type GroupRoleLookup,
  NOTE_SEARCH_LIMIT,
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteError,
  NoteGetQuery,
  NoteListQuery,
  NoteLocateQuery,
  NoteMoveCommand,
  type NoteRepository,
  NoteRestoreCommand,
  NoteSearchQuery,
  NoteUpdateCommand,
} from "@domain/notes"

/** What every note handler needs: the notes, and the actor's role in the note's group. */
export interface NoteHandlerDependencies {
  notes: NoteRepository
  groups: GroupRoleLookup
}

/**
 * The note handlers. Each one decides who may act before it touches a note: every member of the
 * group reads, an editor or above writes, and a stranger is told the group does not exist.
 * Session strength is checked earlier, by the session gate on both buses, so REST and the socket
 * get the same answer from the same code.
 */
export function createNoteCreateHandler(
  { notes, groups }: NoteHandlerDependencies,
): CommandHandler<NoteCreateCommand> {
  return async (command) => {
    const { data, allowance } = command
    // The gate sets it on every create it lets through; without it the cap would go unchecked.
    if (allowance === undefined) {
      throw new Error("NoteCreateCommand reached its handler without the entitlement gate")
    }
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    return await notes.create(
      {
        groupId: data.groupId,
        id: data.id,
        title: data.title,
        body: data.body,
        tagIds: data.tagIds,
        requestId: data.requestId,
      },
      data.actor.userId,
      allowance,
    )
  }
}

export function createNoteUpdateHandler(
  { notes, groups }: NoteHandlerDependencies,
): CommandHandler<NoteUpdateCommand> {
  return async ({ data }) => {
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const note = await notes.update(
      {
        groupId: data.groupId,
        id: data.id,
        title: data.title,
        body: data.body,
        tagIds: data.tagIds,
        expectedVersion: data.version,
      },
      data.actor.userId,
    )
    return { note }
  }
}

export function createNoteDeleteHandler(
  { notes, groups }: NoteHandlerDependencies,
): CommandHandler<NoteDeleteCommand> {
  return async ({ data }) => {
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const note = await notes.delete(
      {
        groupId: data.groupId,
        id: data.id,
        expectedVersion: data.version,
        requestId: data.requestId,
      },
      data.actor.userId,
    )
    return { note }
  }
}

/**
 * Restoring needs an editor's rights, as a delete does, and the plan's cap on notes: the note is
 * live again, so it counts.
 */
export function createNoteRestoreHandler(
  { notes, groups }: NoteHandlerDependencies,
): CommandHandler<NoteRestoreCommand> {
  return async (command) => {
    const { data, allowance } = command
    // The gate sets it on every restore it lets through; without it the cap would go unchecked.
    if (allowance === undefined) {
      throw new Error("NoteRestoreCommand reached its handler without the entitlement gate")
    }
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const note = await notes.restore(
      { groupId: data.groupId, id: data.id, requestId: data.requestId },
      data.actor.userId,
      allowance,
    )
    return { note }
  }
}

/**
 * Moving needs an editor's rights in both groups. The source is checked first, so a person who
 * cannot write there is told so before anything about the target; a target the person does not
 * belong to is "group not found".
 */
export function createNoteMoveHandler(
  { notes, groups }: NoteHandlerDependencies,
): CommandHandler<NoteMoveCommand> {
  return async (command) => {
    const { data, allowance } = command
    // The gate sets it on every move it lets through; without it the target's cap goes unchecked.
    if (allowance === undefined) {
      throw new Error("NoteMoveCommand reached its handler without the entitlement gate")
    }
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    assertCanWriteNotes(await groups.roleOf(data.toGroupId, data.actor.userId))
    const moved = await notes.move(
      {
        fromGroupId: data.groupId,
        toGroupId: data.toGroupId,
        noteIds: data.noteIds,
        requestId: data.requestId,
      },
      data.actor.userId,
      allowance,
    )
    return { notes: moved }
  }
}

export function createNoteListHandler(
  { notes, groups }: NoteHandlerDependencies,
): QueryHandler<NoteListQuery> {
  return async ({ data }) => {
    assertCanReadNotes(await groups.roleOf(data.groupId, data.actor.userId))
    return await notes.list(data.groupId, data.page, data.deleted)
  }
}

export function createNoteGetHandler(
  { notes, groups }: NoteHandlerDependencies,
): QueryHandler<NoteGetQuery> {
  return async ({ data }) => {
    assertCanReadNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const note = await notes.get(data.groupId, data.id)
    if (!note) throw new NoteError("NOTE_NOT_FOUND", "Note not found")
    return { note }
  }
}

/**
 * The group of a note, for a person who is a member of it. A note that does not exist and a note
 * in a group the person is not in get the same `NOTE_NOT_FOUND`, so the answer never says whether
 * an id is taken.
 */
export function createNoteLocateHandler(
  { notes }: NoteHandlerDependencies,
): QueryHandler<NoteLocateQuery> {
  return async ({ data }) => {
    // One lookup that includes membership: every refusal costs the same, so timing tells nothing.
    const groupId = await notes.groupIdOfForMember(data.id, data.actor.userId)
    if (!groupId) throw new NoteError("NOTE_NOT_FOUND", "Note not found")
    return { groupId }
  }
}

/** What the search handler needs: the notes, and the person's search budget. */
export interface NoteSearchHandlerDependencies {
  notes: NoteRepository
  /** `true` while the person may search again; see `createNoteSearchLimit`. */
  searchAllowed(userId: number): Promise<boolean>
}

/**
 * Searches the live notes of every group the person is a member of now. Membership is decided by
 * the search query itself, so there is no group to check first. A person past the search budget
 * gets `SEARCH_RATE_LIMITED`.
 */
export function createNoteSearchHandler(
  { notes, searchAllowed }: NoteSearchHandlerDependencies,
): QueryHandler<NoteSearchQuery> {
  return async ({ data }) => {
    if (!await searchAllowed(data.actor.userId)) {
      throw new NoteError("SEARCH_RATE_LIMITED", "Too many searches. Wait a minute")
    }
    return { notes: await notes.searchForMember(data.actor.userId, data.q, NOTE_SEARCH_LIMIT) }
  }
}
