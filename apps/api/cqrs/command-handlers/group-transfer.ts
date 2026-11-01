import { GroupTransferCommand } from "@domain/groups"
import { db } from "../../services/db.ts"
import { eventBus } from "../../services/eventBus.ts"
import { signIn } from "../../services/auth.ts"
import { wireGroupTransferHandler } from "./group-transfer-wiring.ts"
import type { CommandHandler } from "@spy4x/platform/cqrs"

export const groupTransferHandler: CommandHandler<GroupTransferCommand> = wireGroupTransferHandler(
  { db, signIn, eventBus },
)
