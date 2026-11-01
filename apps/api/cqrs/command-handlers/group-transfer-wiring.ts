import { GroupTransferCommand } from "@domain/groups"
import type { CommandHandler } from "@spy4x/platform/cqrs"
import type { AppDbBase } from "../../services/db-base.ts"
import type { SignIn } from "../../services/sign-in.ts"
import { createGroupTransferHandler } from "../../features/groups/handlers.ts"
import type { GroupOwnershipTransferredEvent } from "../events.ts"

/**
 * The group transfer handler over the API's services, apart from the singletons so a test can run
 * it with its own. The password goes through `checkPassword`, which counts a wrong one on the
 * account's one lock (#406), never through the uncounted `verifyPassword`.
 */
export function wireGroupTransferHandler(
  { db, signIn, eventBus }: {
    db: AppDbBase
    signIn: SignIn
    eventBus: { emit(event: GroupOwnershipTransferredEvent): void }
  },
): CommandHandler<GroupTransferCommand> {
  return createGroupTransferHandler(db.group, {
    checkPassword: (userId, password) => signIn.checkPassword(userId, password),
    emit: (event) => eventBus.emit(event),
  })
}
