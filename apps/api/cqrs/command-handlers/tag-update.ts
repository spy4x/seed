import { TagUpdateCommand } from "@domain/tags"
import type { CommandHandler } from "@spy4x/platform/cqrs"
import { createTagUpdateHandler } from "../../features/tags/handlers.ts"
import { tagDependencies } from "../tag-dependencies.ts"

export const tagUpdateHandler: CommandHandler<TagUpdateCommand> = createTagUpdateHandler(
  tagDependencies,
)
