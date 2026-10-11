import { TagListQuery } from "@domain/tags"
import type { QueryHandler } from "@spy4x/platform/cqrs"
import { createTagListHandler } from "../../features/tags/handlers.ts"
import { tagDependencies } from "../tag-dependencies.ts"

export const tagListHandler: QueryHandler<TagListQuery> = createTagListHandler(
  tagDependencies,
)
