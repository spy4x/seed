import type postgres from "postgres"
import type { AuthStore } from "@spy4x/server/auth"
import type { EmailSender } from "@spy4x/email/sender"
import { emailToVerify } from "@domain/identity"
import {
  EMAIL_CODE_TTL_MINUTES,
  emailChanges,
  readEmailStatus,
  sendEmailCode,
} from "../auth/email-verification.ts"
import { emailCodeMail, type MailBrand } from "../mail/mail.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The job that mails one code that proves an e-mail address. */
export const EMAIL_CODE_MAIL_JOB = "auth.email-code-mail"

/** A request the worker never managed to handle is removed after this long. */
export const EMAIL_CODE_REQUEST_RETENTION_HOURS = 24

/**
 * Queues a code mail to `email`, already normalised, the address `userId` must prove. The request
 * row is written before its job, so the worker never runs a job whose row is not there yet; a
 * failed job write leaves the row for the nightly cleanup, as for reset mails.
 */
export async function enqueueEmailCodeMail(
  sql: postgres.Sql,
  userId: number,
  email: string,
): Promise<void> {
  const id = uuidV7()
  await sql`INSERT INTO email_code_requests (id, user_id, email) VALUES (${id}, ${userId}, ${email})`
  await enqueueJob(sql, EMAIL_CODE_MAIL_JOB, id, { inMs: 0 })
}

/** What the code mail job needs. */
export interface EmailCodeMailDeps {
  sql: postgres.Sql
  store: AuthStore
  /** `null` when mail is off: the request is dropped and nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails; the job is then retried. Gets no address or code. */
  log: (line: string) => void
}

/**
 * Handles one request: when the address is still the one the user must prove, issues a code and
 * mails it, then deletes the request. The code is made here, next to the send, so it is never
 * stored. A request for an address the user no longer needs to prove (proven since, or replaced by
 * another change) sends nothing. A failed send throws, so the job is retried with a fresh code.
 */
export function emailCodeMailJob(deps: EmailCodeMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    const [request] = await sql<{ userId: number; email: string }[]>`
      SELECT user_id AS "userId", email FROM email_code_requests WHERE id = ${event.aggregateId}
    `
    if (!request) return
    const status = await readEmailStatus(emailChanges(sql), deps.store, request.userId)
    const sender = deps.sender
    if (sender && emailToVerify(status) === request.email) {
      await sendEmailCode(deps.store, request.userId, request.email, async (to, code) => {
        const result = await sender.send(
          emailCodeMail(deps.brand, { to, code, validMinutes: EMAIL_CODE_TTL_MINUTES }),
        )
        if (!result.ok) {
          deps.log("error: an e-mail code was not sent and will be retried")
          throw new Error("e-mail code not sent")
        }
      })
    }
    await sql`DELETE FROM email_code_requests WHERE id = ${event.aggregateId}`
  }
}

/**
 * Deletes requests older than {@link EMAIL_CODE_REQUEST_RETENTION_HOURS}: ones whose job gave up
 * after its last retry. Returns how many.
 */
export async function removeStaleEmailCodeRequests(sql: postgres.Sql): Promise<number> {
  const removed = await sql`
    DELETE FROM email_code_requests
    WHERE created_at < now() - make_interval(hours => ${EMAIL_CODE_REQUEST_RETENTION_HOURS})
  `
  return removed.count
}
