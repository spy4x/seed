/**
 * The signed-in devices: listing and ending sessions, and checking one again, wired from
 * `createSignIn`. Not `@server/auth/sessions.ts`, which records when a person was last seen.
 *
 * - **Signed-in devices.** Every new session records a device name parsed once from the user
 *   agent and the address with its last part hidden, in the transaction that creates it when there
 *   is one; requests and live sockets record when it was last used, at most every few minutes. A
 *   person lists their live sessions and ends any other one, or all others, which deletes their
 *   rows: every statement names the user, so another person's session is out of reach and looks
 *   missing. A password change ends every other session unless the person asks to keep them.
 *
 * @module
 */
import type { Context } from "hono"
import { secondFactorSatisfied, SessionStatus } from "@spy4x/server/sign-in"
import { AuthAuditEventType, type SignedInDevice } from "@domain/identity"
import type { AppAuthState } from "./sign-in.ts"
import type { SignInParts } from "./sign-in-parts.ts"

/** The signed-in device operations the routes call. */
export interface SessionOperations {
  /** Marks every active session that has run out as expired. */
  expireSessions(): Promise<void>
  /** The user's live sessions, this one first, then the rest by when they were last used. */
  listSessions(state: AppAuthState): Promise<SignedInDevice[]>
  /**
   * Ends session `sessionId` of the user by deleting it, with an audit row, in one transaction.
   * `false` when the user has no such session, the answer for another person's session too, and
   * for the request's own session, which signs out instead.
   */
  endSession(c: Context, state: AppAuthState, sessionId: number): Promise<boolean>
  /** Ends every session of the user but this one, with an audit row. Returns how many ended. */
  endOtherSessions(c: Context, state: AppAuthState): Promise<number>
  /**
   * The session and its user as they are now, or `null` when the session may no longer act: it was
   * signed out or expired, its user is gone, or it still owes a second factor. The rules are the
   * ones `parseAuth` and `isAuthenticated2FA` apply to a request, read from the database instead
   * of a cookie, so a socket that authenticated once can be checked again without the cookie.
   */
  entitledSession(sessionId: number): Promise<AppAuthState | null>
}

/** Builds the signed-in device operations over the sign-in's own parts. */
export function createSessionOperations(own: SignInParts): SessionOperations {
  const { db, sessions, sessionsOver, loadUser, hasSecondFactor, touchSession, auditRow } = own
  return {
    async expireSessions() {
      await sessions.expireStale()
    },

    async entitledSession(sessionId) {
      const session = await db.sessionStore.findById(sessionId)
      if (!session || session.status !== SessionStatus.Active) return null
      if (session.expiresAt.getTime() <= Date.now()) return null
      const user = await loadUser(session.userId)
      if (!user) return null
      if (!secondFactorSatisfied(session.secondFactor, hasSecondFactor(user))) return null
      // A live socket counts as use, so a tab that only talks over it is not shown as idle.
      touchSession(session.id, session.userId)
      return { session, user }
    },

    async listSessions({ session }) {
      const rows = await sessions.listForUser(session.userId)
      const devices = rows.map((row): SignedInDevice => ({
        id: row.id,
        deviceName: row.deviceName,
        ipHint: row.ipHint,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        current: row.id === session.id,
      }))
      // `sort` is stable: the rest keep the database's order, last used first.
      return devices.sort((a, b) => Number(b.current) - Number(a.current))
    },

    async endSession(c, { session, user }, sessionId) {
      if (sessionId === session.id) return false
      return await db.begin(async (tx) => {
        if (!(await sessionsOver(tx.sessionStore).deleteForUser(user.id, sessionId))) return false
        await tx.pushTokens.removeOfSession(user.id, sessionId)
        await tx.authAudit.insert(
          auditRow(c, user.id, AuthAuditEventType.SESSIONS_ENDED, String(sessionId)),
        )
        return true
      })
    },

    async endOtherSessions(c, { session, user }) {
      return await db.begin(async (tx) => {
        // Ends nothing unless `session.id` is this user's live session, so a wrong id cannot sign
        // the person out everywhere.
        const ended = await sessionsOver(tx.sessionStore).deleteOthers(user.id, session.id)
        await tx.pushTokens.removeAllBut(user.id, session.id)
        if (ended > 0) {
          await tx.authAudit.insert(
            auditRow(c, user.id, AuthAuditEventType.SESSIONS_ENDED, "all other sessions"),
          )
        }
        return ended
      })
    },
  }
}
