import { TagGetQuery } from "@domain/tags"
import type { QueryHandler } from "@spy4x/platform/cqrs"
import { createTagGetHandler } from "../../features/tags/handlers.ts"
import { tagDependencies } from "../tag-dependencies.ts"

export const tagGetHandler: QueryHandler<TagGetQuery> = createTagGetHandler(
  tagDependencies,
)
