import type { QueryHandler } from "@spy4x/platform/cqrs"
import { parseBoundedInteger } from "@spy4x/platform/universal/bounded-integer"
import {
  ACTIVITY_PAGE_DEFAULT,
  ACTIVITY_PAGE_MAX,
  type ActivityPageKey,
  type ActivityResult,
  assertCanViewActivity,
  GroupActivityQuery,
  type GroupActivityRepository,
  GroupError,
  type GroupRepository,
} from "@domain/groups"
import type { Actor } from "@domain/identity"

/**
 * A page of the group's activity. The role is read from the group's membership in Postgres and
 * checked first: an admin or the owner may, an editor or a viewer is refused, and a person who is
 * not a member is told the group does not exist.
 */
export function createGroupActivityHandler(
  groups: Pick<GroupRepository, "getForMember">,
  activity: GroupActivityRepository,
): QueryHandler<GroupActivityQuery> {
  return async ({ data }) => {
    const access = await groups.getForMember(data.groupId, data.actor.userId)
    assertCanViewActivity(access?.role ?? null)
    return await activity.list(data.groupId, data.page)
  }
}

/** What listing the activity needs from the app. */
export interface GroupActivityDependencies {
  list(query: GroupActivityQuery): Promise<ActivityResult>
  cursor: {
    encode(userId: number, groupId: string, pageKey: ActivityPageKey): Promise<string>
    decode(cursor: string, userId: number, groupId: string): Promise<ActivityPageKey>
  }
}

/** One page of a group's activity, in the shape `GET /api/groups/:groupId/activity` answers with. */
export async function listActivityPage(
  dependencies: GroupActivityDependencies,
  actor: Actor,
  groupId: string,
  page: { limit: number; cursor?: string },
) {
  const after = page.cursor
    ? await dependencies.cursor.decode(page.cursor, actor.userId, groupId)
    : undefined
  const result = await dependencies.list(
    new GroupActivityQuery({ actor, groupId, page: { limit: page.limit, after } }),
  )
  const nextCursor = result.nextPageKey
    ? await dependencies.cursor.encode(actor.userId, groupId, result.nextPageKey)
    : null
  return { events: result.events, nextCursor }
}

/** The `limit` of a request's query string, or the default; anything else is `INVALID_REQUEST`. */
export function parseActivityLimitParam(value: string | undefined): number {
  const limit = parseBoundedInteger(value, {
    fallback: ACTIVITY_PAGE_DEFAULT,
    max: ACTIVITY_PAGE_MAX,
  })
  if (limit === null) throw new GroupError("INVALID_REQUEST", "Activity limit is invalid")
  return limit
}
