import { type Actor, GuestReminderKind } from "@domain/identity"
import { RealtimeRequestError } from "@spy4x/realtime"
import { guestRefusal } from "../middlewares/guest-limits.ts"
import type { Operations } from "@spy4x/realtime/operations"
import { createGroupOperations } from "../features/groups/operations.ts"
import { createOnboardingOperations } from "../features/onboarding/operations.ts"
import { createPreferencesOperations } from "../features/preferences/operations.ts"
import { createProfileOperations } from "../features/profile/operations.ts"
import { createPushOperations } from "../features/push/operations.ts"
import { createTagOperations } from "../features/tags/operations.ts"
import { createAttachmentOperations } from "../features/notes/attachments.ts"
import { createPictureOperations } from "../features/profile/picture.ts"
import { createNoteOperations } from "../features/notes/operations.ts"
import { createNoteWidgetOperations } from "../features/notes/widgets.ts"
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
  ...createOnboardingOperations({
    get: (query) => queryBus.execute(query),
    mark: (command) => commandBus.execute(command),
  }),
  ...createPreferencesOperations({
    get: (query) => queryBus.execute(query),
    save: (command) => commandBus.execute(command),
    device: (command) => commandBus.execute(command),
  }),
  ...createPushOperations({
    // A guest needs a sign-in method first (#224), on the socket as over REST.
    register: async (command) => {
      if (await db.guests.isGuest(command.data.actor.userId)) {
        const { error } = guestRefusal("push")
        throw new RealtimeRequestError(error.code, error.message, error.details, error)
      }
      return await commandBus.execute(command)
    },
    remove: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
  }),
  ...createNoteOperations({
    create: async (command) => {
      const created = await commandBus.execute(command)
      // A guest's first note gets the reminder to keep it (#224); sent once, and only to guests.
      await signIn.guests.remind(command.data.actor.userId, GuestReminderKind.FirstNote)
      return created
    },
    update: (command) => commandBus.execute(command),
    delete: (command) => commandBus.execute(command),
    restore: (command) => commandBus.execute(command),
    move: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    get: (query) => queryBus.execute(query),
    locate: (query) => queryBus.execute(query),
    search: (query) => queryBus.execute(query),
    cursor: noteListCursor,
  }),
  ...createNoteWidgetOperations({
    total: (query) => queryBus.execute(query),
    added: (query) => queryBus.execute(query),
    series: (query) => queryBus.execute(query),
  }),
  ...createAttachmentOperations({
    sign: (command) => commandBus.execute(command),
    confirm: (command) => commandBus.execute(command),
    cancel: (command) => commandBus.execute(command),
    remove: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    download: (query) => queryBus.execute(query),
  }),
  ...createPictureOperations({
    sign: (command) => commandBus.execute(command),
    confirm: (command) => commandBus.execute(command),
    cancel: (command) => commandBus.execute(command),
    remove: (command) => commandBus.execute(command),
  }),
  ...createTagOperations({
    create: (command) => commandBus.execute(command),
    update: (command) => commandBus.execute(command),
    delete: (command) => commandBus.execute(command),
    list: (query) => queryBus.execute(query),
    get: (query) => queryBus.execute(query),
  }),
}

/** The API's one realtime socket service; see {@link Realtime}. */
export const realtime = new Realtime({
  entitledSession: (sessionId) => signIn.entitledSession(sessionId),
  memberUserIds: (groupId) => db.group.listMemberUserIds(groupId),
  operations,
  log,
})
