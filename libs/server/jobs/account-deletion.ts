import type postgres from "postgres"
import type { EmailSender } from "@spy4x/email/sender"
import {
  type AccountDeletionRequest,
  hardDeleteAccount,
  HardDeleteOutcome,
} from "../auth/account-deletion.ts"
import { accountDeletionMail, accountRestoredMail, type MailBrand } from "../mail/mail.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The job that deletes one account for good once its wait is over. */
export const ACCOUNT_HARD_DELETE_JOB = "account.hard-delete"

/** The job that mails the person the day their account goes. */
export const ACCOUNT_DELETION_MAIL_JOB = "account.deletion-mail"

/** The job that tells the person a sign-in restored their account. Its aggregate id is the user. */
export const ACCOUNT_RESTORED_MAIL_JOB = "account.restored-mail"

/**
 * Queues both jobs of a request in the caller's transaction, so they exist exactly when the
 * request does: the mail at once, the delete for good at `deleteAfter`. Both point at the request's
 * id, so a restore, which removes the row, turns both into no-ops.
 */
export async function scheduleAccountDeletionJobs(
  tx: postgres.Sql,
  request: AccountDeletionRequest,
): Promise<void> {
  await enqueueJob(tx, ACCOUNT_DELETION_MAIL_JOB, request.id, { inMs: 0 })
  await enqueueJob(tx, ACCOUNT_HARD_DELETE_JOB, request.id, { at: request.deleteAfter })
}

/** What the delete-for-good job needs. */
export interface AccountHardDeleteDeps {
  sql: postgres.Sql
  /** Told when something stops the delete; gets no id or address. */
  log: (line: string) => void
}

/**
 * Deletes the account of the request the job names. A request that is gone (the person signed in)
 * does nothing. A blocked one is logged and left for the nightly run, which retries every due
 * request.
 */
export function accountHardDeleteJob({ sql, log }: AccountHardDeleteDeps): JobHandler {
  return async (event) => {
    const outcome = await hardDeleteAccount(sql, event.aggregateId)
    if (outcome === HardDeleteOutcome.Blocked) {
      log("warn: an account due for deletion still owns a shared or paid group; kept for now")
    }
  }
}

/** What the deletion mail job needs. */
export interface AccountDeletionMailDeps {
  sql: postgres.Sql
  /** `null` when mail is off: nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails or there is no proven address; gets no address. */
  log: (line: string) => void
}

/**
 * Mails the day the account goes to the person's first proven address, while the request still
 * waits. An address nobody proved gets nothing: whoever squats it must not learn about the account.
 * A failed send throws, so the job is retried.
 */
export function accountDeletionMailJob(deps: AccountDeletionMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    if (!deps.sender) return
    const [request] = await sql<{ deleteAfter: Date; email: string | null }[]>`
      SELECT account_deletions.delete_after AS "deleteAfter", (
        SELECT auth_keys.proven_email FROM auth_keys
        WHERE auth_keys.user_id = account_deletions.user_id AND auth_keys.proven_email IS NOT NULL
        ORDER BY auth_keys.id
        LIMIT 1
      ) AS email
      FROM account_deletions
      WHERE account_deletions.id = ${event.aggregateId}
    `
    if (!request) return
    if (!request.email) {
      deps.log("warn: an account deletion mail was not sent: the account has no proven address")
      return
    }
    const result = await deps.sender.send(
      accountDeletionMail(deps.brand, { to: request.email, deleteAfter: request.deleteAfter }),
    )
    if (!result.ok) {
      deps.log("error: an account deletion mail was not sent and will be retried")
      throw new Error("account deletion mail not sent")
    }
  }
}

/**
 * Records that a sign-in restored the account of user `userId` and queues its mail, both in the
 * caller's transaction, the restore's own. The outbox names a job by a UUID, so the mail job points
 * at this row rather than at the user.
 */
export async function scheduleAccountRestoredMail(tx: postgres.Sql, userId: number): Promise<void> {
  const id = uuidV7()
  await tx`INSERT INTO account_restorations (id, user_id) VALUES (${id}, ${userId})`
  await enqueueJob(tx, ACCOUNT_RESTORED_MAIL_JOB, id, { inMs: 0 })
}

/**
 * Mails the person whose account a sign-in restored, at their first proven address, so a sign-in
 * by someone else who knows the password does not go unnoticed. An account with no proven address
 * gets nothing, as for the deletion mail. The restore's row goes once the job is done; a failed
 * send keeps it and throws, so the job is retried.
 */
export function accountRestoredMailJob(deps: AccountDeletionMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    const [restore] = await sql<{ email: string | null }[]>`
      SELECT (
        SELECT auth_keys.proven_email FROM auth_keys
        WHERE auth_keys.user_id = account_restorations.user_id
          AND auth_keys.proven_email IS NOT NULL
        ORDER BY auth_keys.id
        LIMIT 1
      ) AS email
      FROM account_restorations
      WHERE account_restorations.id = ${event.aggregateId}
    `
    if (!restore) return
    if (deps.sender && !restore.email) {
      deps.log("warn: an account restored mail was not sent: the account has no proven address")
    }
    if (deps.sender && restore.email) {
      const result = await deps.sender.send(accountRestoredMail(deps.brand, { to: restore.email }))
      if (!result.ok) {
        deps.log("error: an account restored mail was not sent and will be retried")
        throw new Error("account restored mail not sent")
      }
    }
    await sql`DELETE FROM account_restorations WHERE id = ${event.aggregateId}`
  }
}
