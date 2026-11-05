import type postgres from "postgres"
import type { AuthStore } from "@spy4x/server/auth"
import type { EmailSender } from "@spy4x/email/sender"
import {
  PASSWORD_FORGOT_PATH,
  PASSWORD_RESET_CODES,
  PASSWORD_RESET_TTL_MINUTES,
  passwordResetExpiry,
  passwordResetRequests,
  resettableAccount,
} from "../auth/password-reset.ts"
import { type MailBrand, passwordResetMail, passwordResetNoticeMail } from "../mail/mail.ts"
import { readMailReader } from "../mail/reader.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The job that mails one password-reset code, or an operator's reset notice. */
export const PASSWORD_RESET_MAIL_JOB = "auth.password-reset-mail"

/** A request is removed this long after it was made, whether or not anyone used it. */
export const PASSWORD_RESET_REQUEST_RETENTION_HOURS = 24

/**
 * Queues the mail of the reset request `id`, written before. `sql` is a pool or a transaction;
 * given a transaction, the request and its job commit together.
 */
export async function enqueuePasswordResetCodeMail(sql: postgres.Sql, id: string): Promise<void> {
  await enqueueJob(sql, PASSWORD_RESET_MAIL_JOB, id, { inMs: 0 })
}

/**
 * Queues an operator's reset mail for `email`, already normalised: a request no browser
 * waits on, whose mail tells the person to ask for a code. The request row is written before its
 * job. Given a transaction, as the operator area's reset does, both writes commit or roll back
 * together.
 */
export async function enqueuePasswordResetMail(sql: postgres.Sql, email: string): Promise<void> {
  const id = uuidV7()
  await passwordResetRequests(sql).create({
    id,
    email,
    expiresAt: passwordResetExpiry(new Date()),
    byOperator: true,
  })
  await enqueuePasswordResetCodeMail(sql, id)
}

/** What the reset mail job needs. */
export interface PasswordResetMailDeps {
  sql: postgres.Sql
  store: AuthStore
  /** `null` when mail is off: nothing is issued or sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails; the job is then retried. Gets no address or code. */
  log: (line: string) => void
}

/**
 * Handles one request. A request a browser waits on gets a new code for every address, known or
 * not, so a wrong guess answers the same for each; the code is mailed only when an account signs
 * in with a password and that address. The code is made here, next to the send, so it is never
 * stored. An operator's request gets the notice mail, with no code, and is then deleted. A request
 * that no longer works sends nothing. With mail off nothing is issued or sent, and an operator's
 * request is deleted. A failed send throws, so the job is retried.
 */
export function passwordResetMailJob(deps: PasswordResetMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    const requests = passwordResetRequests(sql)
    const request = await requests.find(event.aggregateId)
    if (!request) return
    if (!deps.sender) {
      if (request.byOperator) await requests.remove(request.id)
      return
    }
    const code = request.byOperator
      ? null
      : await PASSWORD_RESET_CODES.issue(deps.store, request, request.expiresAt)
    const userId = await resettableAccount(deps.store, request.email)
    if (userId !== null) {
      const reader = await readMailReader(sql, userId)
      const mail = code === null
        ? passwordResetNoticeMail(deps.brand, {
          to: request.email,
          link: new URL(PASSWORD_FORGOT_PATH, deps.brand.webAppUrl).href,
          reader,
        })
        : passwordResetMail(deps.brand, {
          to: request.email,
          code,
          validMinutes: PASSWORD_RESET_TTL_MINUTES,
          reader,
        })
      const result = await deps.sender.send(mail)
      if (!result.ok) {
        deps.log("error: a password reset mail was not sent and will be retried")
        throw new Error("password reset mail not sent")
      }
    }
    if (request.byOperator) await requests.remove(request.id)
  }
}

/**
 * Deletes requests made more than {@link PASSWORD_RESET_REQUEST_RETENTION_HOURS} ago: their codes
 * stopped working long before, and an operator's whose job gave up. Returns how many.
 */
export async function removeStalePasswordResetRequests(sql: postgres.Sql): Promise<number> {
  const removed = await sql`
    DELETE FROM password_reset_requests
    WHERE created_at < now() - make_interval(hours => ${PASSWORD_RESET_REQUEST_RETENTION_HOURS})
  `
  return removed.count
}
