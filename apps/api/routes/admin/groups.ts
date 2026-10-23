import { type Context, Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import { isUuid } from "@spy4x/platform/universal/uuid"
import {
  ADMIN_GROUPS_PAGE_SIZE,
  type AdminGroupDetail,
  type AdminGroupFiles,
  type AdminGroupListResponse,
  adminGroupTransferSchema,
  parseAdminGroupFilter,
} from "@domain/groups"
import { AdminGroupActOutcome, type AdminGroupOperator } from "@server/groups/admin-groups.ts"
import type { AppDbBase } from "@api/services/db-base.ts"
import { readFeatureJson } from "@api/services/json-body.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"
import { NoteError, parseNoteWidgetRequest } from "@domain/notes"
import { entitlementsOf } from "@domain/billing"
import { createPlanOf } from "../../features/billing/config.ts"
import { NOTE_WIDGET_READERS, type NoteWidgetRequest } from "../../features/notes/widgets.ts"
import { codeForStatus, errorResponse, validationResponse } from "../../services/error-response.ts"

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
  /**
   * One overview widget's data for the group, as a member reads it: counts only. `null` for a
   * group or a widget that does not exist.
   */
  widget(groupId: string, widgetId: string, request: NoteWidgetRequest): Promise<unknown | null>
  /** The group's files and its plan's caps for them; `null` for a group that does not exist. */
  files(groupId: string): Promise<AdminGroupFiles | null>
  removeFile(
    operator: AdminGroupOperator,
    groupId: string,
    fileId: string,
  ): Promise<AdminGroupActOutcome>
}

export interface AdminGroupsRouteDependencies {
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  groups: AdminGroupsService
}

export const ADMIN_GROUP_NOT_FOUND = `Group not found`
export const ADMIN_GROUP_FILE_NOT_FOUND = `File not found. Someone may have removed it already.`

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
  [AdminGroupActOutcome.RecipientBlocked]: {
    status: 409,
    error: `This member is blocked. Unblock them before handing the group over.`,
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
 * - `GET /groups/:id/files` is the group's newest files and its room, `AdminGroupFiles`: each
 *   file's type, size, uploader and date, never its name or its note's title, and no download.
 *   `POST /groups/:id/files/:fileId/remove` removes one, from a note in the trash too, and answers
 *   the files as they read after it.
 * - `GET /groups/:id/widgets/:widgetId?from=&to=&timeZone=` is one overview widget's data in the
 *   default layout, the same counts a member's overview shows (#219). Never a member's layout.
 */
export function createAdminGroupsRoutes(
  dependencies: AdminGroupsRouteDependencies,
): Hono<APIContext> {
  const { groups, limit } = dependencies

  /** The answer after an action: the group as it reads now, or the refusal. */
  async function answer(c: Context<APIContext>, groupId: string, outcome: AdminGroupActOutcome) {
    if (outcome !== AdminGroupActOutcome.Done) {
      const { status, error } = REFUSALS[outcome]
      return errorResponse(c, codeForStatus(status), { message: error, status: status })
    }
    const group = await groups.detail(groupId)
    if (!group) return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
    return c.json({ group })
  }

  return new Hono<APIContext>()
    .get(`/groups`, limit, async (c) => {
      return c.json(await groups.list(parseAdminGroupFilter(new URL(c.req.url).searchParams)))
    })
    .get(`/groups/:id`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      const detail = isUuid(groupId) ? await groups.detail(groupId) : null
      if (!detail) return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
      return c.json(detail)
    })
    .get(`/groups/:id/widgets/:widgetId`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      if (!isUuid(groupId)) return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
      let request: NoteWidgetRequest
      try {
        request = parseNoteWidgetRequest({
          groupId,
          from: c.req.query(`from`),
          to: c.req.query(`to`),
          timeZone: c.req.query(`timeZone`),
        })
      } catch (error) {
        if (error instanceof NoteError) {
          return errorResponse(c, `bad_request`, { message: error.message })
        }
        throw error
      }
      const data = await groups.widget(groupId, c.req.param(`widgetId`), request)
      if (data === null) return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
      return c.json(data)
    })
    .get(`/groups/:id/files`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      const files = isUuid(groupId) ? await groups.files(groupId) : null
      if (!files) return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
      return c.json(files)
    })
    .post(`/groups/:id/files/:fileId/remove`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      const fileId = c.req.param(`fileId`)
      if (!isUuid(groupId) || !isUuid(fileId)) {
        return errorResponse(c, `not_found`, { message: ADMIN_GROUP_FILE_NOT_FOUND })
      }
      const outcome = await groups.removeFile(operatorOf(c), groupId, fileId)
      if (outcome === AdminGroupActOutcome.NotFound) {
        return errorResponse(c, `not_found`, { message: ADMIN_GROUP_FILE_NOT_FOUND })
      }
      if (outcome !== AdminGroupActOutcome.Done) {
        const { status, error } = REFUSALS[outcome]
        return errorResponse(c, codeForStatus(status), { message: error, status })
      }
      const files = await groups.files(groupId)
      if (!files) return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
      return c.json(files)
    })
    .post(`/groups/:id/invitations/:invitationId/revoke`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      const invitationId = c.req.param(`invitationId`)
      if (!isUuid(groupId) || !isUuid(invitationId)) {
        return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
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
        return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
      }
      return await answer(c, groupId, await groups.removeMember(operatorOf(c), groupId, userId))
    })
    .post(`/groups/:id/transfer`, limit, async (c) => {
      const groupId = c.req.param(`id`)
      if (!isUuid(groupId)) return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
      let body: unknown
      try {
        body = await readFeatureJson(c, (message) => new Error(message))
      } catch (error) {
        return errorResponse(c, `bad_request`, { message: (error as Error).message })
      }
      const input = adminGroupTransferSchema(body)
      if (input instanceof type.errors) return validationResponse(c, input)
      return await answer(
        c,
        groupId,
        await groups.transferOwnership(operatorOf(c), groupId, input.userId),
      )
    })
}

/** The group's plan's caps on its files, `null` for none. */
export type AdminFileCaps = (
  groupId: string,
) => Promise<{ maxFiles: number | null; maxBytes: number | null }>

/** The operator area's group service over the app's database. It reads nothing until called. */
export function createAdminGroups(
  db: AppDbBase,
  pageSize: number,
  fileCaps: AdminFileCaps,
): AdminGroupsService {
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
    async files(groupId) {
      const files = await db.adminGroups.files(groupId)
      if (!files) return null
      const caps = await fileCaps(groupId)
      return { files: files.files, usage: { files: files.total, bytes: files.bytes, ...caps } }
    },
    removeFile: (operator, groupId, fileId) => db.adminGroups.removeFile(operator, groupId, fileId),
    async widget(groupId, widgetId, request) {
      // Every aggregate's readers, by widget id: the notes' are the only ones so far.
      const read = Object.hasOwn(NOTE_WIDGET_READERS, widgetId)
        ? NOTE_WIDGET_READERS[widgetId]
        : undefined
      const overview = db.noteOverview
      if (!read || await overview.startDay(groupId, request.timeZone) === null) return null
      return await read(overview, request)
    },
  }
}

/** The groups module: the list, one group and the operator's actions on it. */
export const groupsAdminModule: AdminApiModule = {
  id: `groups`,
  routes: ({ db, limit, billing }) => {
    // Read on the first call: the routes are built before any database is reached.
    const fileCaps: AdminFileCaps = async (groupId) => {
      const plan = await createPlanOf(db.billing, billing)(groupId)
      const { limits } = entitlementsOf(plan, billing.provider !== null)
      return { maxFiles: limits.maxAttachments, maxBytes: limits.storageBytes }
    }
    return createAdminGroupsRoutes({
      limit,
      groups: createAdminGroups(db, ADMIN_GROUPS_PAGE_SIZE, fileCaps),
    })
  },
}
