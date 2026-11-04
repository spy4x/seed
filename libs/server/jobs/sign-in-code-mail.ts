import type postgres from "postgres"
import type { AuthStore } from "@spy4x/server/auth"
import type { EmailSender } from "@spy4x/email/sender"
import {
  SIGN_IN_CODE_REQUEST_RETENTION_HOURS,
  SIGN_IN_CODE_TTL_MINUTES,
  SIGN_IN_CODES,
  signInCodeRequests,
} from "../auth/sign-in-codes.ts"
import { type MailBrand, signInCodeMail } from "../mail/mail.ts"
import { readMailReader, requestReader } from "../mail/reader.ts"
import { accountUsing } from "../auth/sign-up-requests.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"

/** The job that mails one sign-in code (#391, #752). */
export const SIGN_IN_CODE_MAIL_JOB = "auth.sign-in-code-mail"

/**
 * Queues a code mail for the sign-in request `id`, written before. `sql` is a pool or a
 * transaction; given a transaction, the request and its job commit together.
 */
export async function enqueueSignInCodeMail(sql: postgres.Sql, id: string): Promise<void> {
  await enqueueJob(sql, SIGN_IN_CODE_MAIL_JOB, id, { inMs: 0 })
}

/** What the sign-in code mail job needs. */
export interface SignInCodeMailDeps {
  sql: postgres.Sql
  store: AuthStore
  /** `null` when mail is off: nothing is issued or sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails; the job is then retried. Gets no address or code. */
  log: (line: string) => void
}

/**
 * Handles one request: issues a new code for it, ending any earlier one, and mails it. The same
 * mail for every address, whether or not an account uses it: the code decides, once entered. The
 * code is made here, next to the send, so it is never stored. A request that no longer works (its
 * code was used, or it expired) sends nothing. A failed send throws, so the job is retried with a
 * fresh code.
 */
export function signInCodeMailJob(deps: SignInCodeMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    if (!deps.sender) return
    const request = await signInCodeRequests(sql).find(event.aggregateId)
    if (!request) return
    const code = await SIGN_IN_CODES.issue(deps.store, request, request.expiresAt)
    // The address's account, when one uses it, speaks its saved language; else the asking page's.
    // The answer reaches only the mailbox, so it tells the asker nothing (#277).
    const account = await accountUsing(deps.store, request.email)
    const reader = account
      ? await readMailReader(sql, account.userId, request.language)
      : requestReader(request.language)
    const result = await deps.sender.send(
      signInCodeMail(deps.brand, {
        to: request.email,
        code,
        validMinutes: SIGN_IN_CODE_TTL_MINUTES,
        at: new Date(),
        reader,
      }),
    )
    if (!result.ok) {
      deps.log("error: a sign-in code was not sent and will be retried")
      throw new Error("sign-in code not sent")
    }
  }
}

/**
 * Deletes requests made more than {@link SIGN_IN_CODE_REQUEST_RETENTION_HOURS} ago: their codes
 * stopped working long before. Returns how many.
 */
export async function removeStaleSignInCodeRequests(sql: postgres.Sql): Promise<number> {
  const removed = await sql`
    DELETE FROM sign_in_code_requests
    WHERE created_at < now() - make_interval(hours => ${SIGN_IN_CODE_REQUEST_RETENTION_HOURS})
  `
  return removed.count
}
