import type postgres from "postgres"
import type { AuthStore } from "@spy4x/server/auth"
import type { EmailSender } from "@spy4x/email/sender"
import {
  issuePasswordReset,
  PASSWORD_RESET_TTL_MINUTES,
  passwordResetLink,
} from "../auth/password-reset.ts"
import { type MailBrand, passwordResetMail } from "../mail/mail.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The job that mails one password reset link. */
export const PASSWORD_RESET_MAIL_JOB = "auth.password-reset-mail"

/** A request the worker never managed to handle is removed after this long. */
export const PASSWORD_RESET_REQUEST_RETENTION_HOURS = 24

/**
 * Queues a reset mail for `email`, already normalised. The same two writes whether or not an
 * account signs in with the address, so neither the answer nor its timing tells which.
 *
 * The request row is written before its job, so the worker never runs a job whose row is not there
 * yet. `sql` is a pool or a transaction, and `enqueueJob` takes either. Given a
 * transaction, as the operator area's reset link does (#425), both writes commit or roll back
 * together. Given a pool, they are separate: when the job's write fails, the caller gets the error
 * and the row is left for the nightly cleanup.
 */
export async function enqueuePasswordResetMail(sql: postgres.Sql, email: string): Promise<void> {
  const id = uuidV7()
  await sql`INSERT INTO password_reset_requests (id, email) VALUES (${id}, ${email})`
  await enqueueJob(sql, PASSWORD_RESET_MAIL_JOB, id, { inMs: 0 })
}

/** What the reset mail job needs. */
export interface PasswordResetMailDeps {
  sql: postgres.Sql
  store: AuthStore
  /** `null` when mail is off: the request is dropped and nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails; the job is then retried. Gets no address, code or link. */
  log: (line: string) => void
}

/**
 * Handles one request: issues a code for the address when an account signs in with it, mails the
 * link, then deletes the request. The code is made here, next to the send, so the raw code is never
 * stored. A failed send throws, so the job is retried with a fresh code; the request stays until it
 * is handled. With mail off, or no account for the address, nothing is issued or sent.
 */
export function passwordResetMailJob(deps: PasswordResetMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    const [request] = await sql<{ email: string }[]>`
      SELECT email FROM password_reset_requests WHERE id = ${event.aggregateId}
    `
    if (!request) return
    const issued = deps.sender ? await issuePasswordReset(deps.store, request.email) : null
    if (deps.sender && issued) {
      const result = await deps.sender.send(
        passwordResetMail(deps.brand, {
          to: issued.email,
          link: passwordResetLink(deps.brand.webAppUrl, issued),
          validMinutes: PASSWORD_RESET_TTL_MINUTES,
        }),
      )
      if (!result.ok) {
        deps.log("error: a password reset mail was not sent and will be retried")
        throw new Error("password reset mail not sent")
      }
    }
    await sql`DELETE FROM password_reset_requests WHERE id = ${event.aggregateId}`
  }
}

/**
 * Deletes requests older than {@link PASSWORD_RESET_REQUEST_RETENTION_HOURS}: ones whose job gave
 * up after its last retry. Returns how many.
 */
export async function removeStalePasswordResetRequests(sql: postgres.Sql): Promise<number> {
  const removed = await sql`
    DELETE FROM password_reset_requests
    WHERE created_at < now() - make_interval(hours => ${PASSWORD_RESET_REQUEST_RETENTION_HOURS})
  `
  return removed.count
}
