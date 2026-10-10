import type { Actor } from "@domain/identity"
import type { Operations } from "@spy4x/realtime/operations"
import { createGroupOperations } from "../features/groups/operations.ts"
import { createProfileOperations } from "../features/profile/operations.ts"
import { createPushOperations } from "../features/push/operations.ts"
import { createNoteOperations } from "../features/notes/operations.ts"
import { signIn } from "./auth.ts"
import { commandBus } from "./commandBus.ts"
import { db } from "./db.ts"
import { groupListCursor } from "./group-list-cursor.ts"
import { log } from "./log.ts"
import { noteListCursor } from "./note-list-cursor.ts"
import { queryBus } from "./queryBus.ts"
import { Realtime } from "./realtime.ts"

/**
 * Everything the API can be asked to do by name (`note.create`). Each aggregate lists its own
 * operations once, and two adapters serve this one table: the socket ({@link realtime}) and
 * `POST /api/call/<name>` (`routes/call.ts`).
 */
export const operations: Operations<Actor> = {
  ...createGroupOperations({
    create: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    get: (query) => queryBus.execute(query),
    select: (command) => commandBus.execute(command),
    selected: (query) => queryBus.execute(query),
    rename: (command) => commandBus.execute(command),
    updateDetails: (command) => commandBus.execute(command),
    delete: (command) => commandBus.execute(command),
    restore: (command) => commandBus.execute(command),
    deleted: (query) => queryBus.execute(query),
    members: (query) => queryBus.execute(query),
    setRole: (command) => commandBus.execute(command),
    removeMember: (command) => commandBus.execute(command),
    leave: (command) => commandBus.execute(command),
    moveAll: (command) => commandBus.execute(command),
    cursor: groupListCursor,
  }),
  ...createProfileOperations({
    get: (query) => queryBus.execute(query),
    update: (command) => commandBus.execute(command),
  }),
  ...createPushOperations({
    register: (command) => commandBus.execute(command),
    remove: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
  }),
  ...createNoteOperations({
    create: (command) => commandBus.execute(command),
    update: (command) => commandBus.execute(command),
    delete: (command) => commandBus.execute(command),
    restore: (command) => commandBus.execute(command),
    move: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    get: (query) => queryBus.execute(query),
    locate: (query) => queryBus.execute(query),
    cursor: noteListCursor,
  }),
}

/** The API's one realtime socket service; see {@link Realtime}. */
export const realtime = new Realtime({
  entitledSession: (sessionId) => signIn.entitledSession(sessionId),
  memberUserIds: (groupId) => db.group.listMemberUserIds(groupId),
  operations,
  log,
})
