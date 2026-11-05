/**
 * The routes of the signed-in devices list. Not `@api/services/sessions.ts`, which holds the
 * flow these routes call, nor `@server/auth/sessions.ts`, which stores the sessions.
 *
 * @module
 */
import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import { errorResponse } from "../services/error-response.ts"
import type { AuthRouteDependencies } from "./auth.ts"
import { signOutEmitter } from "./auth-answers.ts"

/**
 * The answer for a session that cannot be ended from the devices list: another person's, one that
 * does not exist or already ended, and a malformed id alike, so the answer tells nothing.
 */
export const SESSION_NOT_FOUND = "This session has already ended."

/** The answer when the devices list is asked to end the request's own session. */
export const SESSION_IS_CURRENT = "This is the device you are using. Sign out instead."

/** A session id as the devices list sends it: a positive integer without leading zeros. */
const SESSION_ID = /^[1-9][0-9]{0,9}$/

/** The largest id `auth_sessions.id` (a Postgres `integer`) can hold. */
const MAX_SESSION_ID = 2_147_483_647

/** The devices routes, mounted by `createAuthRoute`. */
export function createSessionRoutes(
  {
    signIn,
    emit,
    rateLimits,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  const emitSignOut = signOutEmitter(emit)
  return new Hono<APIContext>()
    .get(`/sessions`, rateLimits.normal, async (c) => {
      return c.json({ sessions: await signIn.listSessions(c.get("auth")!) })
    })
    // Before `/sessions/:id`, which would otherwise take "others" as an id.
    .delete(`/sessions/others`, rateLimits.normal, async (c) => {
      const authData = c.get("auth")!
      const ended = await signIn.endOtherSessions(c, authData)
      if (ended > 0) emitSignOut(c, authData.user.id)
      return c.json({ success: true, ended })
    })
    .delete(`/sessions/:id`, rateLimits.normal, async (c) => {
      const authData = c.get("auth")!
      const raw = c.req.param("id")
      const sessionId = SESSION_ID.test(raw) ? Number(raw) : 0
      if (sessionId < 1 || sessionId > MAX_SESSION_ID) {
        return errorResponse(c, `not_found`, { message: SESSION_NOT_FOUND })
      }
      if (sessionId === authData.session.id) {
        return errorResponse(c, `bad_request`, { message: SESSION_IS_CURRENT })
      }
      if (!(await signIn.endSession(c, authData, sessionId))) {
        return errorResponse(c, `not_found`, { message: SESSION_NOT_FOUND })
      }
      emitSignOut(c, authData.user.id)
      return c.json({ success: true })
    })
}
