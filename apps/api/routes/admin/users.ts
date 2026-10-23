import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { validate } from "@spy4x/validation"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { type CsvColumn, csvHeaderRow, csvRow } from "@spy4x/platform/universal/csv"
import {
  ADMIN_USERS_PAGE_SIZE,
  adminUserRoleSchema,
  type AdminUserRow,
  type DataExportView,
  parseAdminUserFilter,
  USER_ROLE_NAMES,
} from "@domain/identity"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import {
  type AdminActInput,
  AdminActionKind,
  AdminActOutcome,
  type AdminService,
  createAdmin,
} from "@api/services/admin.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { listDataExports } from "@server/auth/data-export.ts"
import { isUuid } from "@spy4x/platform/universal/uuid"
import type { StoredPicture } from "@server/auth/profile-pictures.ts"
import type { FileStore } from "@server/files/files.ts"
import { PICTURE_NOT_FOUND, pictureBody } from "../pictures.ts"
import { pictureObjectKey } from "@domain/identity"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"
import { codeForStatus, errorResponse, validationResponse } from "../../services/error-response.ts"

/** What the people routes call. */
export interface AdminUsersRouteDependencies {
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  admin: AdminService
  emit(event: UserSignedOutEvent): void
  /** The clock the export's file name reads. */
  now?: () => Date
  /** The person's data exports (#229), newest first: what and when, never the file. */
  dataExports(userId: number): Promise<DataExportView[]>
  /** Any live person's profile picture (#228), by its id. */
  picture(pictureId: string): Promise<StoredPicture | null>
  readFile: FileStore["read"]
}

export const ADMIN_USER_NOT_FOUND = "User not found"
export const ADMIN_SELF = "You cannot do this to your own account"
export const ADMIN_OUTRANKED = "You cannot do this to someone whose role is yours or higher"
export const ADMIN_ALREADY_BLOCKED = "This user is already blocked"
export const ADMIN_NOT_BLOCKED = "This user is not blocked"
export const ADMIN_SAME_ROLE = "This user already has that role"
export const ADMIN_NO_TELEGRAM = "This user has no Telegram account linked"
export const ADMIN_NO_PICTURE = "This user has no profile picture"
export const ADMIN_NOT_ADMINISTRATOR = "Only an administrator can change a role"
export const ADMIN_ROLE_TOO_HIGH = "You can only give a role below your own"
export const ADMIN_SESSION_NOT_FOUND = "Session not found"
export const ADMIN_EXPORT_CROSS_SITE = "The export opens only from the operator area"
/** A guest delete of a full account: support never deletes that one at once. */
export const ADMIN_NOT_GUEST =
  `This is not a guest account. Only a guest account can be deleted from here.`

export const ADMIN_NO_PASSWORD =
  "This user has no password with an address, so no reset link can reach them"
export const ADMIN_TOO_MANY_RESETS = "Too many reset links for this address, try again later."

/** Each refusal of an action: its status and message. `Unchanged` depends on the action. */
const REFUSALS: Partial<Record<AdminActOutcome, { status: 403 | 404 | 409; error: string }>> = {
  [AdminActOutcome.NotFound]: { status: 404, error: ADMIN_USER_NOT_FOUND },
  [AdminActOutcome.Self]: { status: 403, error: ADMIN_SELF },
  [AdminActOutcome.Outranked]: { status: 403, error: ADMIN_OUTRANKED },
  [AdminActOutcome.NotAdministrator]: { status: 403, error: ADMIN_NOT_ADMINISTRATOR },
  [AdminActOutcome.RoleTooHigh]: { status: 403, error: ADMIN_ROLE_TOO_HIGH },
  [AdminActOutcome.SessionNotFound]: { status: 404, error: ADMIN_SESSION_NOT_FOUND },
  [AdminActOutcome.NoPassword]: { status: 409, error: ADMIN_NO_PASSWORD },
  [AdminActOutcome.NotGuest]: { status: 409, error: ADMIN_NOT_GUEST },
}

/** What `Unchanged` means for each action that can end so. */
const UNCHANGED: Partial<Record<AdminActionKind, string>> = {
  [AdminActionKind.Block]: ADMIN_ALREADY_BLOCKED,
  [AdminActionKind.Unblock]: ADMIN_NOT_BLOCKED,
  [AdminActionKind.ChangeRole]: ADMIN_SAME_ROLE,
  [AdminActionKind.UnlinkTelegram]: ADMIN_NO_TELEGRAM,
  [AdminActionKind.RemovePicture]: ADMIN_NO_PICTURE,
}

const ACTIONS = {
  block: AdminActionKind.Block,
  unblock: AdminActionKind.Unblock,
  "sessions/end": AdminActionKind.EndSessions,
  "password-reset": AdminActionKind.SendPasswordReset,
  "guest/delete": AdminActionKind.DeleteGuest,
  "telegram/unlink": AdminActionKind.UnlinkTelegram,
  "picture/remove": AdminActionKind.RemovePicture,
} as const

/** The actions after which the person's sockets close: their sessions changed or ended. */
const CLOSES_SOCKETS: ReadonlySet<AdminActionKind> = new Set([
  AdminActionKind.Block,
  AdminActionKind.EndSessions,
  AdminActionKind.EndSession,
  AdminActionKind.DeleteGuest,
])

/**
 * The columns of the CSV export (#425): account facts only, never a secret. Every text cell goes
 * through `csvField`, which quotes it and puts a `'` before a cell that would open as a formula.
 */
export const ADMIN_EXPORT_COLUMNS: readonly CsvColumn<AdminUserRow>[] = [
  { key: "id", header: "ID" },
  { key: "firstName", header: "First name" },
  { key: "lastName", header: "Last name" },
  { key: "email", header: "Address" },
  { key: "role", header: "Role", format: (role) => USER_ROLE_NAMES[role as AdminUserRow["role"]] },
  { key: "blockedAt", header: "Status", format: (blockedAt) => blockedAt ? "blocked" : "active" },
  { key: "createdAt", header: "Created" },
  { key: "lastSeenAt", header: "Last seen" },
  { key: "blockedAt", header: "Blocked at" },
]

/** The file name the export downloads as, with the day it was made: `users-2026-10-16.csv`. */
export function exportFileName(now: Date): string {
  return `users-${now.toISOString().slice(0, 10)}.csv`
}

/** A user or session id from the path, or `null` when it is no positive integer Postgres can hold. */
function serialIdOf(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null
  const id = Number(raw)
  return id <= 2_147_483_647 ? id : null
}

/**
 * The people routes of the operator area (#146), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them.
 *
 * - `GET /users?q=&role=&blocked=&sort=&page=` lists people: `{ users, total, page, pageSize }`.
 *   `sort` is `key:direction` rules, such as `name:asc,createdAt:desc` (#424).
 * - `GET /users/:id` is one person: `{ user, methods, sessions, groups, audits }`.
 * - `GET /users/pictures/:pictureId` is any person's profile picture (#228), for the avatars of
 *   the operator area. It answers the bytes, not a redirect: the store is on the product's host,
 *   which this host's `img-src 'self'` does not allow.
 * - `GET /users/:id/data-exports` is the person's data exports (#229): `{ exports }`, their
 *   status, size and dates. The operator never gets the file: it holds the person's private notes.
 * - `GET /users/export.csv?q=&role=&blocked=&sort=` is every person the filter matches, on all its
 *   pages, as CSV, read in batches and streamed (#425). It writes an audit row on the operator, so
 *   it answers 403 unless `Sec-Fetch-Site` is `same-origin`: the session cookie is `SameSite=Lax`,
 *   which another site's link or top-level navigation still carries.
 * - `POST /users/:id/block`, `/unblock`, `/sessions/end`, `/password-reset`, `/guest/delete`
 *   (#224: a guest account only, deleted at once; the audit row is the operator's) and
 *   `/telegram/unlink` (#269: 409 when none is linked) and `/picture/remove` (#228: 409 when
 *   there is none; the worker deletes the file) take no body and answer `{ user }`.
 *   `/sessions/:sessionId/end` ends one session. `/role` takes `{ role }`.
 *   They ask for no fresh password or code: the owner chose the audit trail over a confirmation
 *   password (2026-10-15). Each writes an audit row on the person naming the operator. Block
 *   refuses every sign-in, ends every session and closes the person's sockets; ending sessions
 *   does the last two. A reset queues the mail "Forgot password" sends.
 *
 * An operator never acts on themselves (403) or on a role at or above their own (403). Only an
 * administrator changes a role, and only to one below their own (403).
 */
export function createAdminUsersRoutes(
  dependencies: AdminUsersRouteDependencies,
): Hono<APIContext> {
  const { admin, emit, now = () => new Date() } = dependencies

  /** Runs `action` on the person in the path and answers what came of it. */
  async function act(c: Context<APIContext>, action: AdminActionKind, input?: AdminActInput) {
    const targetId = serialIdOf(c.req.param("id") ?? ``)
    if (targetId === null) return errorResponse(c, `not_found`, { message: ADMIN_USER_NOT_FOUND })
    const { outcome, user, retryAfterMs } = await admin.act(
      c,
      c.get("auth")!,
      targetId,
      action,
      input,
    )
    if (outcome === AdminActOutcome.TooManyResets) {
      c.header("Retry-After", String(Math.ceil((retryAfterMs ?? 0) / 1000)))
      return errorResponse(c, `rate_limited`, { message: ADMIN_TOO_MANY_RESETS })
    }
    if (outcome === AdminActOutcome.Unchanged) {
      return errorResponse(c, `conflict`, { message: UNCHANGED[action] ?? ADMIN_USER_NOT_FOUND })
    }
    const refusal = REFUSALS[outcome]
    if (refusal) {
      return errorResponse(c, codeForStatus(refusal.status), {
        message: refusal.error,
        status: refusal.status,
      })
    }
    if (CLOSES_SOCKETS.has(action)) {
      // Closes the person's sockets: their sessions are gone, and a blocked person has no right.
      emit(
        new UserSignedOutEvent({
          userId: targetId,
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
    }
    return c.json({ user })
  }

  const route = new Hono<APIContext>()
    .get(`/users`, dependencies.limit, async (c) => {
      const filter = parseAdminUserFilter(new URL(c.req.url).searchParams)
      return c.json(await admin.list(filter))
    })
    // Before `/users/:id`, which would otherwise take `export.csv` as an id.
    .get(`/users/export.csv`, dependencies.limit, async (c) => {
      // A GET the mutation guards let through, yet it writes an audit row in the operator's name.
      // The admin app's download link is same-origin; a missing header is refused too.
      if (c.req.header(`sec-fetch-site`) !== `same-origin`) {
        return errorResponse(c, `forbidden`, { message: ADMIN_EXPORT_CROSS_SITE })
      }
      const filter = parseAdminUserFilter(new URL(c.req.url).searchParams)
      const batches = await admin.export(c, c.get("auth")!, filter)
      const encoder = new TextEncoder()
      const iterator = batches[Symbol.asyncIterator]()
      const lines = (rows: AdminUserRow[]) =>
        encoder.encode(rows.map((row) => `${csvRow(ADMIN_EXPORT_COLUMNS, row)}\r\n`).join(""))
      // The first batch is read before the answer starts: a query that fails at once is a 500, not
      // a 200 with a file of headers only. A failure after it can only cut the download short.
      const first = await iterator.next()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          // The byte-order mark tells Excel the file is UTF-8.
          controller.enqueue(encoder.encode(`\uFEFF${csvHeaderRow(ADMIN_EXPORT_COLUMNS)}\r\n`))
          if (first.done) controller.close()
          else controller.enqueue(lines(first.value))
        },
        async pull(controller) {
          const next = await iterator.next()
          if (next.done) {
            controller.close()
            return
          }
          controller.enqueue(lines(next.value))
        },
        // The operator stopped the download: the cursor closes.
        async cancel() {
          await iterator.return?.()
        },
      })
      return c.body(body, 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFileName(now())}"`,
        "cache-control": "no-store",
      })
    })
    .get(`/users/:id`, dependencies.limit, async (c) => {
      const id = serialIdOf(c.req.param("id"))
      const detail = id === null ? null : await admin.detail(id)
      if (!detail) return errorResponse(c, `not_found`, { message: ADMIN_USER_NOT_FOUND })
      return c.json(detail)
    })
    .get(`/users/pictures/:pictureId`, dependencies.limit, async (c) => {
      const pictureId = c.req.param(`pictureId`)
      const picture = isUuid(pictureId) ? await dependencies.picture(pictureId) : null
      const bytes = picture && await dependencies.readFile(pictureObjectKey(picture.id))
      if (!picture || !bytes) {
        return errorResponse(c, `not_found`, { message: PICTURE_NOT_FOUND })
      }
      return pictureBody(picture, bytes)
    })
    .get(`/users/:id/data-exports`, dependencies.limit, async (c) => {
      const id = serialIdOf(c.req.param("id"))
      if (id === null) return errorResponse(c, `not_found`, { message: ADMIN_USER_NOT_FOUND })
      return c.json({ exports: await dependencies.dataExports(id) })
    })
    .post(`/users/:id/sessions/:sessionId/end`, dependencies.limit, async (c) => {
      const sessionId = serialIdOf(c.req.param("sessionId"))
      if (sessionId === null) {
        return errorResponse(c, `not_found`, { message: ADMIN_SESSION_NOT_FOUND })
      }
      return await act(c, AdminActionKind.EndSession, { sessionId })
    })
    .post(`/users/:id/role`, dependencies.limit, async (c) => {
      const validation = validate(adminUserRoleSchema, await readApiJson(c))
      if (validation.error) return validationResponse(c, validation.error.details)
      return await act(c, AdminActionKind.ChangeRole, { role: validation.data.role })
    })

  for (const [path, action] of Object.entries(ACTIONS)) {
    route.post(`/users/:id/${path}`, dependencies.limit, (c) => act(c, action))
  }
  return route
}

/** The people module: the list, one person and the actions on them. */
export const usersAdminModule: AdminApiModule = {
  id: `users`,
  routes: ({ db, sql, limit, resetByAddress, emit, now, readFile }) =>
    createAdminUsersRoutes({
      limit,
      emit,
      now,
      readFile,
      picture: (pictureId) => db.pictures.any(pictureId),
      dataExports: (userId) => listDataExports(sql, userId, now()),
      admin: createAdmin({ db, pageSize: ADMIN_USERS_PAGE_SIZE, resetByAddress, now }),
    }),
}
