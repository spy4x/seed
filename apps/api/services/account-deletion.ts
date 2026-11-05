/**
 * Deleting one's own account, wired from `createSignIn`. Not `@server/auth/account-deletion.ts`,
 * which stores the request, its blockers and the restore.
 *
 * - **Deleting the account.** `deleteAccount` soft-deletes the profile, writes the waiting
 *   request with its two jobs and signs out every session, in one transaction, after checking
 *   again under row locks that no group stops it (`@server/auth/account-deletion.ts`). A correct
 *   password during the wait restores the account before the sign-in goes on as usual, second
 *   factor included: the password alone cancels the deletion but still lets nobody in who lacks
 *   the second factor.
 *
 * @module
 */
import type { Context } from "hono"
import { type AccountDeletionBlocker, AuthAuditEventType } from "@domain/identity"
import type { AppAuthState } from "./sign-in.ts"
import type { SignInParts } from "./sign-in-parts.ts"

/** What {@link AccountDeletionOperations.deleteAccount} did. */
export type AccountDeleteResult =
  /** The account waits to be deleted until `deleteAfter`; every session is signed out. */
  | { deleteAfter: Date; blockers?: undefined }
  /** These groups stop it; nothing changed. */
  | { deleteAfter?: undefined; blockers: AccountDeletionBlocker[] }

/** The account-deletion operations the routes call. */
export interface AccountDeletionOperations {
  /** The groups that stop the user from deleting their account now. */
  accountDeletionBlockers(state: AppAuthState): Promise<AccountDeletionBlocker[]>
  /**
   * Starts the deletion of the user's account, in one transaction under row locks: checks the
   * blockers again, soft-deletes the profile, writes the request and its jobs, signs out every
   * session and writes the audit row. Then clears the cookie. The caller checks the password and
   * the second factor first, and announces the sign-out.
   */
  deleteAccount(c: Context, state: AppAuthState): Promise<AccountDeleteResult>
}

/** Builds the account-deletion operations over the sign-in's own parts. */
export function createAccountDeletionOperations(own: SignInParts): AccountDeletionOperations {
  const { db, cookie, sessionsOver, auditRow } = own
  return {
    async accountDeletionBlockers({ user }) {
      return await db.accountDeletion.blockers(user.id)
    },

    async deleteAccount(c, { user }) {
      const result = await db.begin(async (tx): Promise<AccountDeleteResult> => {
        // Gone or already deleted by a request running alongside: that one signed this out too.
        if (!(await tx.accountDeletion.lock(user.id))) return { blockers: [] }
        const blockers = await tx.accountDeletion.blockers(user.id)
        if (blockers.length > 0) return { blockers }
        await tx.user.deleteOne({ id: user.id })
        const request = await tx.accountDeletion.request(user.id)
        await sessionsOver(tx.sessionStore).signOutUser(user.id)
        await tx.authAudit.insert(
          auditRow(c, user.id, AuthAuditEventType.ACCOUNT_DELETION_REQUESTED),
        )
        return { deleteAfter: request.deleteAfter }
      })
      if (result.deleteAfter) {
        cookie.clear(c)
        c.set("auth", null)
      }
      return result
    },
  }
}
