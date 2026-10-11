import { TagCreateCommand } from "@domain/tags"
import type { CommandHandler } from "@spy4x/platform/cqrs"
import { createTagCreateHandler } from "../../features/tags/handlers.ts"
import { tagDependencies } from "../tag-dependencies.ts"

export const tagCreateHandler: CommandHandler<TagCreateCommand> = createTagCreateHandler(
  tagDependencies,
)
