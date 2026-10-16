import { type Context, Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import { isUuid } from "@spy4x/platform/universal/uuid"
import {
  ADMIN_GROUPS_PAGE_SIZE,
  type AdminGroupDetail,
  type AdminGroupListResponse,
  adminGroupTransferSchema,
  parseAdminGroupFilter,
} from "@domain/groups"
import { AdminGroupActOutcome, type AdminGroupOperator } from "@server/groups/admin-groups.ts"
import type { AppDbBase } from "@api/services/db-base.ts"
import { readFeatureJson } from "@api/services/json-body.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/** What the group routes call: the reads and the three actions, over the app's database. */
export interface AdminGroupsService {
  list(filter: ReturnType<typeof parseAdminGroupFilter>): Promise<AdminGroupListResponse>
  detail(groupId: string): Promise<AdminGroupDetail | null>
  revokeInvitation(
    operator: AdminGroupOperator,
    groupId: string,
    invitationId: string,
  ): Promise<AdminGroupActOutcome>
  removeMember(
    operator: AdminGroupOperator,
    groupId: string,
    userId: number,
  ): Promise<AdminGroupActOutcome>
  transferOwnership(
    operator: AdminGroupOperator,
    groupId: string,
    userId: number,
  ): Promise<AdminGroupActOutcome>
}

export interface AdminGroupsRouteDependencies {
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  groups: AdminGroupsService
}

export const ADMIN_GROUP_NOT_FOUND = `Group not found`

/** The answer to each outcome other than done: its status and the sentence the page shows. */
const REFUSALS: Record<
  Exclude<AdminGroupActOutcome, AdminGroupActOutcome.Done>,
  { status: 403 | 404 | 409; error: string }
> = {
  [AdminGroupActOutcome.NotFound]: { status: 404, error: ADMIN_GROUP_NOT_FOUND },
  [AdminGroupActOutcome.GroupDeleted]: {
    status: 409,
    error: `The group is in the trash. Nothing in it changes until its owner restores it.`,
  },
  [AdminGroupActOutcome.Self]: {
    status: 403,
    error: `You cannot do this to your own account or your own group`,
  },
  [AdminGroupActOutcome.Outranked]: {
    status: 403,
    error: `You cannot do this to someone whose role is yours or higher`,
  },
  [AdminGroupActOutcome.RoleTooLow]: {
    status: 403,
    error: `Only a supervisor or an admin can transfer a group`,
  },
  [AdminGroupActOutcome.Unchanged]: {
    status: 409,
    error: `Nothing to change: someone changed this a moment ago. Reload the group.`,
  },
  [AdminGroupActOutcome.IsOwner]: {
    status: 409,
    error: `The owner cannot be removed. Transfer the group to another member first.`,
  },
  [AdminGroupActOutcome.LastGroup]: {
    status: 409,
    error: `This is the person's only group, and everyone keeps at least one.`,
  },
  [AdminGroupActOutcome.SubscriptionRenews]: {
    status: 409,
    error: `The group's subscription still renews. Its owner cancels it before a transfer.`,
  },
}

/** A user id from the path, or `null` when it is no positive integer Postgres can hold. */
function userIdOf(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null
  const id = Number(raw)
  return id <= 2_147_483_647 ? id : null
}

function operatorOf(c: Context<APIContext>): AdminGroupOperator {
  const { user } = c.get(`auth`)!
  return { id: user.id, role: user.role }
}

/**
 * The group routes of the operator area (#426), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them.
 *
 * - `GET /groups?q=&status=&sort=&page=` lists groups: `{ groups, total, page, pageSize }`.
 * - `GET /groups/:id` is one group: its counts, subscription, members, invitations and activity.
 *   Never a note's text, a tag's name, the description, or a title from the activity log.
 * - `POST /groups/:id/invitations/:invitationId/revoke` and `/groups/:id/members/:userId/remove`
 *   take no body; `POST /groups/:id/transfer` takes `{ userId }`. Each answers the group's page,
 *   `{ group }`, as it reads after the change, and writes the group's audit row naming the
 *   operator. Like the people actions they ask for no password (owner's decision, 2026-10-15).
 */
export function createAdminGroupsRoutes(
  dependencies: AdminGroupsRouteDependencies,
): Hono<APIContext> {
  const { groups, limit } = dependencies

  /** The answer after an action: the group as it reads now, or the refusal. */
  async function answer(c: Context<APIContext>, groupId: string, outcome: AdminGroupActOutcome) {
    if (outcome !== AdminGroupActOutcome.Done) {
      const { status, error } = REFUSALS[outcome]
      return c.json({ error }, status)
    }
    const group = await groups.detail(groupId)
    if (!group) return c.json({ error: ADMIN_GROUP_NOT_FOUND }, 404)
    return c.json({ group })
  }

  return new Hono<APIContext>()
    .get(`/groups`, limit, async (c) => {
      return c.json(await groups.list(parseAdminGroupFilter(new URL(c.req.url).searchParams)))
    })
    .get(`/groups/:id`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      const detail = isUuid(groupId) ? await groups.detail(groupId) : null
      if (!detail) return c.json({ error: ADMIN_GROUP_NOT_FOUND }, 404)
      return c.json(detail)
    })
    .post(`/groups/:id/invitations/:invitationId/revoke`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      const invitationId = c.req.param(`invitationId`)
      if (!isUuid(groupId) || !isUuid(invitationId)) {
        return c.json({ error: ADMIN_GROUP_NOT_FOUND }, 404)
      }
      return await answer(
        c,
        groupId,
        await groups.revokeInvitation(operatorOf(c), groupId, invitationId),
      )
    })
    .post(`/groups/:id/members/:userId/remove`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      const userId = userIdOf(c.req.param(`userId`))
      if (!isUuid(groupId) || userId === null) {
        return c.json({ error: ADMIN_GROUP_NOT_FOUND }, 404)
      }
      return await answer(c, groupId, await groups.removeMember(operatorOf(c), groupId, userId))
    })
    .post(`/groups/:id/transfer`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      if (!isUuid(groupId)) return c.json({ error: ADMIN_GROUP_NOT_FOUND }, 404)
      let body: unknown
      try {
        body = await readFeatureJson(c, (message) => new Error(message))
      } catch (error) {
        return c.json({ error: (error as Error).message }, 400)
      }
      const input = adminGroupTransferSchema(body)
      if (input instanceof type.errors) return c.json({ error: input.summary }, 400)
      return await answer(
        c,
        groupId,
        await groups.transferOwnership(operatorOf(c), groupId, input.userId),
      )
    })
}

/** The operator area's group service over the app's database. It reads nothing until called. */
export function createAdminGroups(db: AppDbBase, pageSize: number): AdminGroupsService {
  return {
    async list(filter) {
      const { groups, total } = await db.adminGroups.list(filter, pageSize)
      return { groups, total, page: filter.page, pageSize }
    },
    detail: (groupId) => db.adminGroups.find(groupId),
    revokeInvitation: (operator, groupId, invitationId) =>
      db.adminGroups.revokeInvitation(operator, groupId, invitationId),
    removeMember: (operator, groupId, userId) =>
      db.adminGroups.removeMember(operator, groupId, userId),
    transferOwnership: (operator, groupId, userId) =>
      db.adminGroups.transferOwnership(operator, groupId, userId),
  }
}

/** The groups module: the list, one group and the operator's actions on it. */
export const groupsAdminModule: AdminApiModule = {
  id: `groups`,
  routes: ({ db, limit }) =>
    createAdminGroupsRoutes({ limit, groups: createAdminGroups(db, ADMIN_GROUPS_PAGE_SIZE) }),
}
