import { TagDeleteCommand } from "@domain/tags"
import type { CommandHandler } from "@spy4x/platform/cqrs"
import { createTagDeleteHandler } from "../../features/tags/handlers.ts"
import { tagDependencies } from "../tag-dependencies.ts"

export const tagDeleteHandler: CommandHandler<TagDeleteCommand> = createTagDeleteHandler(
  tagDependencies,
)
