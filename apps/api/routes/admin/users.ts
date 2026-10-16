import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { ADMIN_USERS_PAGE_SIZE, parseAdminUserFilter } from "@domain/identity"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import {
  AdminActionKind,
  AdminActOutcome,
  type AdminService,
  createAdmin,
} from "@api/services/admin.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/** What the people routes call. */
export interface AdminUsersRouteDependencies {
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  admin: AdminService
  emit(event: UserSignedOutEvent): void
}

export const ADMIN_USER_NOT_FOUND = "User not found"
export const ADMIN_SELF = "You cannot do this to your own account"
export const ADMIN_OUTRANKED = "You cannot do this to someone whose role is yours or higher"
export const ADMIN_ALREADY_BLOCKED = "This user is already blocked"
export const ADMIN_NOT_BLOCKED = "This user is not blocked"

const ACTIONS = {
  block: AdminActionKind.Block,
  unblock: AdminActionKind.Unblock,
  "sessions/end": AdminActionKind.EndSessions,
} as const

/** A user id from the path, or `null` when it is no positive integer Postgres can hold. */
function userIdOf(raw: string): number | null {
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
 * - `POST /users/:id/block`, `/unblock` and `/sessions/end` take no body and answer `{ user }`.
 *   They ask for no fresh password or code: the owner chose the audit trail over a confirmation
 *   password (2026-10-15). Each writes an audit row on the person naming the operator. Block
 *   refuses every sign-in, ends every session and closes the person's sockets; ending sessions
 *   does the last two.
 *
 * An operator never acts on themselves (403) or on a role at or above their own (403).
 */
export function createAdminUsersRoutes(
  dependencies: AdminUsersRouteDependencies,
): Hono<APIContext> {
  const { admin, emit } = dependencies
  const route = new Hono<APIContext>()
    .get(`/users`, dependencies.limit, async (c) => {
      const filter = parseAdminUserFilter(new URL(c.req.url).searchParams)
      return c.json(await admin.list(filter))
    })
    .get(`/users/:id`, dependencies.limit, async (c) => {
      const id = userIdOf(c.req.param("id"))
      const detail = id === null ? null : await admin.detail(id)
      if (!detail) return c.json({ error: ADMIN_USER_NOT_FOUND }, 404)
      return c.json(detail)
    })

  for (const [path, action] of Object.entries(ACTIONS)) {
    route.post(`/users/:id/${path}`, dependencies.limit, async (c) => {
      const targetId = userIdOf(c.req.param("id"))
      if (targetId === null) return c.json({ error: ADMIN_USER_NOT_FOUND }, 404)
      const { outcome, user } = await admin.act(c, c.get("auth")!, targetId, action)
      switch (outcome) {
        case AdminActOutcome.NotFound:
          return c.json({ error: ADMIN_USER_NOT_FOUND }, 404)
        case AdminActOutcome.Self:
          return c.json({ error: ADMIN_SELF }, 403)
        case AdminActOutcome.Outranked:
          return c.json({ error: ADMIN_OUTRANKED }, 403)
        case AdminActOutcome.Unchanged:
          return c.json(
            {
              error: action === AdminActionKind.Block ? ADMIN_ALREADY_BLOCKED : ADMIN_NOT_BLOCKED,
            },
            409,
          )
      }
      if (action !== AdminActionKind.Unblock) {
        // Closes the person's sockets: their sessions are gone, and a blocked person has no right.
        emit(
          new UserSignedOutEvent({
            userId: targetId,
            request: requestInfoFromContext(c, { trustedProxy: true }),
          }),
        )
      }
      return c.json({ user })
    })
  }
  return route
}

/** The people module: the list, one person and the actions on them. */
export const usersAdminModule: AdminApiModule = {
  id: `users`,
  routes: ({ db, limit, emit, now }) =>
    createAdminUsersRoutes({
      limit,
      emit,
      admin: createAdmin({ db, pageSize: ADMIN_USERS_PAGE_SIZE, now }),
    }),
}
