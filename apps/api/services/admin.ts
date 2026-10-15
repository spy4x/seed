import type { Context } from "hono"
import {
  type AdminUserDetail,
  type AdminUserFilter,
  type AdminUserListResponse,
  type AdminUserRow,
  AuthAuditEventType,
} from "@domain/identity"
import type { AppDbBase } from "./db-base.ts"
import { type AppAuthState, auditRow } from "./sign-in.ts"

/** What an operator may do to a person (#146). */
export enum AdminActionKind {
  /** Refuse every sign-in and end every session, until unblocked. */
  Block = 1,
  Unblock = 2,
  /** End every session; the person may sign in again. */
  EndSessions = 3,
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
  /** A block of a blocked person, or an unblock of one who is not. */
  Unchanged = 5,
}

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
  ): Promise<{ outcome: AdminActOutcome; user?: AdminUserRow }>
}

/** The `identifier` of an operator action's audit row: who did it. */
export function operatorIdentifier(operatorId: number): string {
  return `operator:${operatorId}`
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

    async act(c, actor, targetId, action) {
      if (targetId === actor.user.id) return { outcome: AdminActOutcome.Self }
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
        }
        return AdminActOutcome.Done
      })
      if (outcome !== AdminActOutcome.Done) return { outcome }
      return { outcome, user: (await db.admin.find(targetId)) ?? undefined }
    },
  }
}
