import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { canOpenAdmin, parseAdminUserFilter } from "@domain/identity"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import type { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import { AdminActionKind, AdminActOutcome, type AdminService } from "@api/services/admin.ts"

/** What the operator routes call. `index.ts` passes the app's singletons. */
export interface AdminRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  mutationGuards: MutationGuards
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  admin: AdminService
  emit(event: UserSignedOutEvent): void
}

/** The answer to anyone below operator, on every path: the area does not exist for them. */
export const ADMIN_NOT_FOUND = "Not found"
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
 * The operator area (#146), mounted at `/api/admin` and reached on the admin app's host only
 * (`createAdminHostGate`). Only a signed-in session with its second factor reaches it. Below
 * operator, every path answers 404, so the area is invisible; a signed-out caller gets the 401
 * every session route gives. The page hides nothing that this does not refuse.
 *
 * - `GET /users?q=&role=&blocked=&page=` lists people: `{ users, total, page, pageSize }`.
 * - `GET /users/:id` is one person: `{ user, methods, sessions, groups, audits }`.
 * - `POST /users/:id/block`, `/unblock` and `/sessions/end` take no body and answer `{ user }`.
 *   They ask for no fresh password or code: the owner chose the audit trail over a confirmation
 *   password (2026-10-15). Each writes an audit row on the person naming the operator. Block refuses every sign-in, ends every session and closes the
 *   person's sockets; ending sessions does the last two.
 *
 * An operator never acts on themselves (403) or on a role at or above their own (403).
 */
export function createAdminRoute(dependencies: AdminRouteDependencies): Hono<APIContext> {
  const { admin, emit } = dependencies
  const route = new Hono<APIContext>()
    .use(dependencies.auth.isAuthenticated2FA)
    // Before anything else answers: below operator, no path tells anything apart.
    .use(async (c, next) => {
      if (!canOpenAdmin(c.get("auth")!.user.role)) return c.json({ error: ADMIN_NOT_FOUND }, 404)
      await next()
    })
    .use(dependencies.mutationGuards.signedIn)
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
  // Every other path under the area, for operators too: the same 404 as below operator.
  route.all(`*`, (c) => c.json({ error: ADMIN_NOT_FOUND }, 404))
  return route
}
