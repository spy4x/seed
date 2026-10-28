import type postgres from "postgres"
import type { AuthStore } from "@spy4x/server/auth"
import type { EmailSender } from "@spy4x/email/sender"
import { issueSignUpCode, SIGN_UP_TTL_MINUTES, signUpRequests } from "../auth/sign-up-requests.ts"
import { emailCodeMail, type MailBrand } from "../mail/mail.ts"
import { requestReader } from "../mail/reader.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The job that mails one code to the address of a waiting sign-up (#142). */
export const SIGN_UP_CODE_MAIL_JOB = "auth.sign-up-code-mail"

/**
 * Queues a code mail for the waiting sign-up `signUpId`. The request row is written before its
 * job, so the worker never runs a job whose row is not there yet. Given a transaction, both writes
 * commit or roll back with the sign-up itself.
 */
export async function enqueueSignUpCodeMail(sql: postgres.Sql, signUpId: string): Promise<void> {
  const id = uuidV7()
  await sql`INSERT INTO sign_up_code_requests (id, sign_up_id) VALUES (${id}, ${signUpId})`
  await enqueueJob(sql, SIGN_UP_CODE_MAIL_JOB, id, { inMs: 0 })
}

/** What the sign-up code mail job needs. */
export interface SignUpCodeMailDeps {
  sql: postgres.Sql
  store: AuthStore
  /** `null` when mail is off: the request is dropped and nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails; the job is then retried. Gets no address or code. */
  log: (line: string) => void
}

/**
 * Handles one request: while its sign-up still waits, issues a code and mails it, then deletes the
 * request. The same mail for every address, whether or not an account uses it: only the code,
 * once entered, tells the person who holds the mailbox. The code is made here, next to the send,
 * so it is never stored. A sign-up that has ended (entered, given up or expired) sends nothing, and
 * its requests went with it. A failed send throws, so the job is retried with a fresh code.
 */
export function signUpCodeMailJob(deps: SignUpCodeMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    const [request] = await sql<{ signUpId: string }[]>`
      SELECT sign_up_id AS "signUpId" FROM sign_up_code_requests WHERE id = ${event.aggregateId}
    `
    if (!request) return
    const signUp = await signUpRequests(sql).find(request.signUpId)
    const sender = deps.sender
    if (sender && signUp) {
      const code = await issueSignUpCode(deps.store, signUp)
      const result = await sender.send(
        emailCodeMail(deps.brand, {
          to: signUp.email,
          code,
          validMinutes: SIGN_UP_TTL_MINUTES,
          // No account is known yet: the mail speaks the language of the page that asked (#277).
          reader: requestReader(signUp.language),
        }),
      )
      if (!result.ok) {
        deps.log("error: a sign-up code was not sent and will be retried")
        throw new Error("sign-up code not sent")
      }
    }
    await sql`DELETE FROM sign_up_code_requests WHERE id = ${event.aggregateId}`
  }
}

/**
 * Deletes waiting sign-ups that have expired, with their password hashes and any code mail the
 * worker never sent. Returns how many.
 */
export async function removeExpiredSignUps(sql: postgres.Sql): Promise<number> {
  const removed = await sql`DELETE FROM sign_up_requests WHERE expires_at <= now()`
  return removed.count
}
