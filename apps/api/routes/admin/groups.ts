import { type Context, Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import { isUuid } from "@spy4x/platform/universal/uuid"
import {
  ADMIN_GROUP_FILES_PAGE_SIZE,
  ADMIN_GROUPS_PAGE_SIZE,
  type AdminGroupDetail,
  type AdminGroupFileAccess,
  type AdminGroupFileFilter,
  type AdminGroupFiles,
  type AdminGroupListResponse,
  adminGroupTransferSchema,
  parseAdminGroupFileFilter,
  parseAdminGroupFilter,
} from "@domain/groups"
import {
  AdminGroupActOutcome,
  type AdminGroupOperator,
  type AdminGroupStoredFile,
} from "@server/groups/admin-groups.ts"
import { downloadDisposition } from "@server/files/files.ts"
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
  /**
   * One page of the group's files whose name matches the filter, and its plan's caps for them;
   * `null` for a group that does not exist.
   */
  files(groupId: string, filter: AdminGroupFileFilter): Promise<AdminGroupFiles | null>
  /** The file when it sits on a note of the group, in the trash or not; else `null`. */
  file(groupId: string, fileId: string): Promise<AdminGroupStoredFile | null>
  /** The bytes of a stored file, or `null` when the store no longer has it. */
  readFile(objectKey: string): Promise<Uint8Array | null>
  /** Writes the audit row of an operator opening or downloading the file. */
  recordFileAccess(
    operator: AdminGroupOperator,
    groupId: string,
    file: AdminGroupStoredFile,
    access: `open` | `download`,
  ): Promise<void>
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
export const ADMIN_GROUP_FILE_CROSS_SITE = `The file opens only from the operator area`

/**
 * The types a browser may show in place on the admin host: raster images, which run nothing. Any
 * other file, an SVG or a PDF among them, is only ever saved.
 */
const SHOWN_TYPES = new Set([`image/jpeg`, `image/png`, `image/webp`, `image/gif`])

/** The type without its parameters, in lower case. */
function bareType(contentType: string): string {
  return contentType.split(`;`)[0].trim().toLowerCase()
}

/**
 * A stored file's bytes on the admin host: its confirmed type, never sniffed. It sets the store's
 * sandbox policy, but the app-wide `securityHeaders` replaces it for now (spy4x/ts-libs#772); a
 * file that is markup is never shown in place, only saved.
 */
function fileBody(
  file: AdminGroupStoredFile,
  bytes: Uint8Array,
  disposition: `inline` | `attachment`,
  cacheControl: string,
): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "content-type": file.contentType,
      "content-disposition": downloadDisposition(file.contentType, file.name, disposition),
      "x-content-type-options": `nosniff`,
      "content-security-policy": `sandbox; default-src 'none'`,
      "cache-control": cacheControl,
    },
  })
}

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
 * - `GET /groups/:id/files?q=&page=` is one page of the group's files whose name holds `q`, newest
 *   first, with the group's room: `AdminGroupFiles`. Each file's name, type, size, uploader, date
 *   and its note's title (#478). `POST /groups/:id/files/:fileId/remove?q=&page=` removes one,
 *   from a note in the trash too, and answers that page of the files as it reads after it.
 * - `GET /groups/:id/files/:fileId/thumbnail` is the whole original image, shown as a 40 px tile, and
 *   writes no audit row;
 *   any other file is 404 here. `…/open` is the file shown in place (an image; anything else is
 *   saved) and `…/download` the file saved as an attachment: each writes an audit row naming the
 *   operator before it answers, and answers 403 unless `Sec-Fetch-Site` is `same-origin`, since a
 *   GET that writes the operator's audit row must not be one another site can start. A file is
 *   found only through its own group's path. Every answer carries the confirmed type and `nosniff`;
 *   its sandbox policy is replaced by the app's own for now (spy4x/ts-libs#772).
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

  /**
   * One file's bytes: an image's tile, the file shown in place, or saved. The file must sit in the
   * group of the path. Opening and downloading write the audit row first, once the bytes are in
   * hand: a file the store lost writes none, and a row that cannot be written serves nothing.
   */
  async function serveFile(c: Context<APIContext>, access: AdminGroupFileAccess) {
    const audited = access !== `thumbnail`
    // A GET the mutation guards let through, yet it writes an audit row in the operator's name.
    // The admin app's image and fetch are same-origin; a missing header is refused too.
    if (audited && c.req.header(`sec-fetch-site`) !== `same-origin`) {
      return errorResponse(c, `forbidden`, { message: ADMIN_GROUP_FILE_CROSS_SITE })
    }
    const groupId = c.req.param(`id`) ?? ``
    const fileId = c.req.param(`fileId`) ?? ``
    const file = isUuid(groupId) && isUuid(fileId) ? await groups.file(groupId, fileId) : null
    const shown = file !== null && SHOWN_TYPES.has(bareType(file.contentType))
    const bytes = file && (shown || access !== `thumbnail`)
      ? await groups.readFile(file.objectKey)
      : null
    if (!file || !bytes) {
      return errorResponse(c, `not_found`, { message: ADMIN_GROUP_FILE_NOT_FOUND })
    }
    if (access === `thumbnail`) return fileBody(file, bytes, `inline`, `private, max-age=86400`)
    await groups.recordFileAccess(operatorOf(c), groupId, file, access)
    const disposition = access === `open` && shown ? `inline` : `attachment`
    return fileBody(file, bytes, disposition, `no-store`)
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
      const filter = parseAdminGroupFileFilter(new URL(c.req.url).searchParams)
      const files = isUuid(groupId) ? await groups.files(groupId, filter) : null
      if (!files) return errorResponse(c, `not_found`, { message: ADMIN_GROUP_NOT_FOUND })
      return c.json(files)
    })
    .get(`/groups/:id/files/:fileId/thumbnail`, limit, (c) => serveFile(c, `thumbnail`))
    .get(`/groups/:id/files/:fileId/open`, limit, (c) => serveFile(c, `open`))
    .get(`/groups/:id/files/:fileId/download`, limit, (c) => serveFile(c, `download`))
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
      const filter = parseAdminGroupFileFilter(new URL(c.req.url).searchParams)
      const files = await groups.files(groupId, filter)
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
  readFile: AdminGroupsService[`readFile`],
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
    async files(groupId, filter) {
      const files = await db.adminGroups.files(groupId, filter, ADMIN_GROUP_FILES_PAGE_SIZE)
      if (!files) return null
      const caps = await fileCaps(groupId)
      return {
        files: files.files,
        total: files.total,
        page: filter.page,
        pageSize: ADMIN_GROUP_FILES_PAGE_SIZE,
        query: filter.query,
        usage: { files: files.all, bytes: files.bytes, ...caps },
      }
    },
    file: (groupId, fileId) => db.adminGroups.file(groupId, fileId),
    readFile,
    recordFileAccess: (operator, groupId, file, access) =>
      db.adminGroups.recordFileAccess(operator, groupId, file, access),
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
  routes: ({ db, limit, billing, readFile }) => {
    // Read on the first call: the routes are built before any database is reached.
    const fileCaps: AdminFileCaps = async (groupId) => {
      const plan = await createPlanOf(db.billing, billing)(groupId)
      const { limits } = entitlementsOf(plan, billing.provider !== null)
      return { maxFiles: limits.maxAttachments, maxBytes: limits.storageBytes }
    }
    return createAdminGroupsRoutes({
      limit,
      groups: createAdminGroups(db, ADMIN_GROUPS_PAGE_SIZE, fileCaps, readFile),
    })
  },
}
