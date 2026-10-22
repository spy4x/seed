import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { type ListedTag, TagListQuery } from "@domain/tags"
import { actorFromAuth } from "../cqrs/actor.ts"
import type { APIContext } from "../_types.ts"
import { tagErrorResponse, TagFeatureError } from "../features/tags/errors.ts"

export interface TagsRouteDependencies {
  list(query: TagListQuery): Promise<{ tags: ListedTag[] }>
}

/**
 * The REST route of a group's tags, mounted at `/api/groups/:groupId/tags`: the list, which the SPA
 * reads with `apiAsUser`. Every tag command is an operation (`tag.create`, `tag.update`,
 * `tag.delete`) served by the socket and `POST /api/call/<name>`, so the route has no write.
 * Who may read is decided by the handler, never here.
 */
export function createTagsRoute(dependencies: TagsRouteDependencies): Hono<APIContext> {
  return new Hono<APIContext>()
    .onError((error, c) => tagErrorResponse(c, error))
    .use(requireAuthentication)
    .get("/", async (c) => {
      const result = await dependencies.list(
        new TagListQuery({ actor: actorFromAuth(c.get("auth")!), groupId: groupIdOf(c) }),
      )
      return c.json(result)
    })
}

/** Authentication only; the session gate on the bus decides whether the session is strong enough. */
const requireAuthentication: MiddlewareHandler<APIContext> = async (c, next) => {
  if (!c.get("auth")) {
    return tagErrorResponse(c, new TagFeatureError("AUTH_REQUIRED", "Missing session"))
  }
  return await next()
}

function groupIdOf(c: Context<APIContext>): string {
  const groupId = c.req.param("groupId")
  if (!isUuid(groupId)) throw new TagFeatureError("INVALID_REQUEST", "Group id is invalid")
  return groupId
}
