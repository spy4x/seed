import type { Context } from "hono"
import {
  type AdminUserDetail,
  type AdminUserFilter,
  adminUserFilterQuery,
  type AdminUserListResponse,
  type AdminUserRow,
  AuthAuditEventType,
  canChangeRoles,
  type UserRole,
} from "@domain/identity"
import { roleChangeIdentifier } from "@server/auth/admin-users.ts"
import type { AppDbBase } from "./db-base.ts"
import { type AppAuthState, auditRow } from "./sign-in.ts"

/** What an operator may do to a person (#146). */
export enum AdminActionKind {
  /** Refuse every sign-in and end every session, until unblocked. */
  Block = 1,
  Unblock = 2,
  /** End every session; the person may sign in again. */
  EndSessions = 3,
  /** End one session, named by `input.sessionId` (#425). */
  EndSession = 4,
  /** Give the role `input.role` (#425). Administrators only, to a role below their own. */
  ChangeRole = 5,
  /** Mail the "Forgot password" link to the person's password address (#425). */
  SendPasswordReset = 6,
}

/** What an action needs besides its kind: the session to end, or the role to give. */
export interface AdminActInput {
  sessionId?: number
  role?: UserRole
}

/** How an operator action ended. */
export enum AdminActOutcome {
  Done = 1,
  /** No live person has that id. */
  NotFound = 2,
  /** The operator named themselves. */
  Self = 3,
  /** The person's role is the operator's own or higher. */
  Outranked = 4,
  /** A block of a blocked person, an unblock of one who is not, or the role they already have. */
  Unchanged = 5,
  /** A role change by anyone but an administrator. */
  NotAdministrator = 6,
  /** A role change to the operator's own role or higher. */
  RoleTooHigh = 7,
  /** The person has no live session with that id. */
  SessionNotFound = 8,
  /** The person has no password with an address, so no reset link can reach them. */
  NoPassword = 9,
}

/** How many rows the CSV export reads from the database at a time. */
export const ADMIN_EXPORT_BATCH = 500

/** The operator area's reads and actions. Who may call them is the route's business. */
export interface AdminService {
  /** One page of people matching `filter`, newest first. */
  list(filter: AdminUserFilter): Promise<AdminUserListResponse>
  /** Everything the detail page shows, or `null` when there is no live person `userId`. */
  detail(userId: number): Promise<AdminUserDetail | null>
  /**
   * Does `action` to the person `targetId` on behalf of `actor`, with its audit row on the person
   * in the same transaction. An operator never acts on themselves or on a role at or above their
   * own; that is decided here, on rows locked for the transaction, not by the page.
   */
  act(
    c: Context,
    actor: AppAuthState,
    targetId: number,
    action: AdminActionKind,
    input?: AdminActInput,
  ): Promise<{ outcome: AdminActOutcome; user?: AdminUserRow }>
  /**
   * Every person `filter` matches, on all its pages, in batches (#425). The audit row on `actor`
   * is written before the first row is read, so an export that fails half-way is recorded too.
   */
  export(
    c: Context,
    actor: AppAuthState,
    filter: AdminUserFilter,
  ): Promise<AsyncIterable<AdminUserRow[]>>
}

/** The `identifier` of an operator action's audit row: who did it. */
export function operatorIdentifier(operatorId: number): string {
  return `operator:${operatorId}`
}

/**
 * The `identifier` of an export's audit row: the operator and the filter as its query string,
 * without the page, such as `operator:7 q=ada&role=2`. Cut to the column's 320 characters.
 */
export function exportIdentifier(operatorId: number, filter: AdminUserFilter): string {
  const query = adminUserFilterQuery({ ...filter, page: 1 })
  const text = query ? `${operatorIdentifier(operatorId)} ${query}` : operatorIdentifier(operatorId)
  return text.slice(0, 320)
}

/** Builds the operator area's service over the app's database. */
export function createAdmin(
  { db, pageSize, now = () => new Date() }: {
    db: AppDbBase
    pageSize: number
    now?: () => Date
  },
): AdminService {
  return {
    async list(filter) {
      const { users, total } = await db.admin.list(filter, pageSize)
      return { users, total, page: filter.page, pageSize }
    },

    async detail(userId) {
      const user = await db.admin.find(userId)
      if (!user) return null
      const sessions = await db.sessionStore.listForUser(userId, now())
      const parts = await db.admin.parts(userId)
      return {
        user,
        sessions: sessions.map((session) => ({
          id: session.id,
          deviceName: session.deviceName,
          ipHint: session.ipHint,
          createdAt: session.createdAt.toISOString(),
          lastUsedAt: session.lastUsedAt.toISOString(),
        })),
        ...parts,
      }
    },

    async act(c, actor, targetId, action, input = {}) {
      if (targetId === actor.user.id) return { outcome: AdminActOutcome.Self }
      if (action === AdminActionKind.ChangeRole) {
        if (!canChangeRoles(actor.user.role)) return { outcome: AdminActOutcome.NotAdministrator }
        if (input.role === undefined || input.role >= actor.user.role) {
          return { outcome: AdminActOutcome.RoleTooHigh }
        }
      }
      const outcome = await db.begin(async (tx) => {
        const target = await tx.admin.lockTarget(targetId)
        if (!target) return AdminActOutcome.NotFound
        if (target.role >= actor.user.role) return AdminActOutcome.Outranked
        const identifier = operatorIdentifier(actor.user.id)
        switch (action) {
          case AdminActionKind.Block:
            if (target.blocked) return AdminActOutcome.Unchanged
            await tx.admin.setBlocked(targetId, now())
            await tx.sessionStore.signOutUser(targetId, null)
            await tx.authAudit.insert(
              auditRow(c, targetId, AuthAuditEventType.USER_BLOCKED, identifier),
            )
            break
          case AdminActionKind.Unblock:
            if (!target.blocked) return AdminActOutcome.Unchanged
            await tx.admin.setBlocked(targetId, null)
            await tx.authAudit.insert(
              auditRow(c, targetId, AuthAuditEventType.USER_UNBLOCKED, identifier),
            )
            break
          case AdminActionKind.EndSessions:
            await tx.sessionStore.signOutUser(targetId, null)
            await tx.authAudit.insert(
              auditRow(c, targetId, AuthAuditEventType.SESSIONS_ENDED, identifier),
            )
            break
          case AdminActionKind.EndSession: {
            const sessionId = input.sessionId
            if (sessionId === undefined) return AdminActOutcome.SessionNotFound
            if (!(await tx.sessionStore.deleteForUser(targetId, sessionId))) {
              return AdminActOutcome.SessionNotFound
            }
            await tx.authAudit.insert(
              auditRow(
                c,
                targetId,
                AuthAuditEventType.SESSIONS_ENDED,
                `${identifier} session ${sessionId}`,
              ),
            )
            break
          }
          case AdminActionKind.ChangeRole: {
            // Checked above: an administrator, giving a role below their own.
            const role = input.role!
            if (target.role === role) return AdminActOutcome.Unchanged
            await tx.admin.setRole(targetId, role)
            await tx.authAudit.insert(
              auditRow(
                c,
                targetId,
                AuthAuditEventType.USER_ROLE_CHANGED,
                roleChangeIdentifier(identifier, target.role, role),
              ),
            )
            break
          }
          case AdminActionKind.SendPasswordReset: {
            const email = await tx.admin.resetAddress(targetId)
            if (email === null) return AdminActOutcome.NoPassword
            // The same request "Forgot password" queues: the worker issues the code and mails it.
            await tx.admin.queuePasswordReset(email)
            await tx.authAudit.insert(
              auditRow(c, targetId, AuthAuditEventType.PASSWORD_RESET_SENT, identifier),
            )
            break
          }
        }
        return AdminActOutcome.Done
      })
      if (outcome !== AdminActOutcome.Done) return { outcome }
      return { outcome, user: (await db.admin.find(targetId)) ?? undefined }
    },

    async export(c, actor, filter) {
      await db.authAudit.insert(
        auditRow(
          c,
          actor.user.id,
          AuthAuditEventType.USERS_EXPORTED,
          exportIdentifier(actor.user.id, filter),
        ),
      )
      return db.admin.export(filter, ADMIN_EXPORT_BATCH)
    },
  }
}
