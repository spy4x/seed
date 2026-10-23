import type postgres from "postgres"
import type { EmailSender } from "@spy4x/email/sender"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { AuthAuditEventType, OAUTH_PROVIDER_NAMES, oauthProviderId } from "@domain/identity"
import { type MailBrand, signInMethodChangedMail } from "../mail/mail.ts"
import { PASSKEY_METHOD } from "../auth/passkeys.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"

/**
 * The job that tells a person a sign-in method was linked to their account or unlinked from it
 * (#385). Its aggregate id is a row of `sign_in_method_changes`.
 */
export const SIGN_IN_METHOD_MAIL_JOB = "auth.sign-in-method-mail"

/** The two changes the mail is about: the audit row's event type of each. */
export type SignInMethodChange =
  | AuthAuditEventType.SIGN_IN_METHOD_LINKED
  | AuthAuditEventType.SIGN_IN_METHOD_UNLINKED

/**
 * Records that `method` (a key's method, such as `oauth:google`) was linked to or unlinked from
 * user `userId`, and queues its mail, both in the caller's transaction, the change's own. The
 * outbox names a job by a UUID, so the job points at this row rather than at the user.
 */
export async function scheduleSignInMethodMail(
  tx: postgres.Sql,
  userId: number,
  change: SignInMethodChange,
  method: string,
): Promise<void> {
  const id = uuidV7()
  await tx`
    INSERT INTO sign_in_method_changes (id, user_id, event_type, method)
    VALUES (${id}, ${userId}, ${change}, ${method})
  `
  await enqueueJob(tx, SIGN_IN_METHOD_MAIL_JOB, id, { inMs: 0 })
}

/** What the sign-in method mail job needs. */
export interface SignInMethodMailDeps {
  sql: postgres.Sql
  /** `null` when mail is off: nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails or there is no proven address; gets no address. */
  log: (line: string) => void
}

interface ChangeRow extends postgres.Row {
  eventType: number
  method: string
  changedAt: Date
  email: string | null
}

/** The provider a key's method names, as people know it; the method itself for anything else. */
function providerName(method: string): string {
  const id = method.startsWith("oauth:") ? oauthProviderId(method.slice(6)) : null
  if (method === PASSKEY_METHOD) return "A passkey"
  return id ? OAUTH_PROVIDER_NAMES[id] : method
}

/**
 * Mails the person whose sign-in method the row names, at their first proven address, which
 * provider was linked or unlinked and when. An account with no proven address gets nothing, as for
 * the other account mails: whoever squats an address must not learn about the account. The row
 * goes once the job is done; a failed send keeps it and throws, so the job is retried.
 */
export function signInMethodMailJob(deps: SignInMethodMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    const [change] = await sql<ChangeRow[]>`
      SELECT sign_in_method_changes.event_type AS "eventType", sign_in_method_changes.method,
        sign_in_method_changes.changed_at AS "changedAt", (
          SELECT auth_keys.proven_email FROM auth_keys
          WHERE auth_keys.user_id = sign_in_method_changes.user_id
            AND auth_keys.proven_email IS NOT NULL
          ORDER BY auth_keys.id
          LIMIT 1
        ) AS email
      FROM sign_in_method_changes
      WHERE sign_in_method_changes.id = ${event.aggregateId}
    `
    if (!change) return
    if (deps.sender && !change.email) {
      deps.log("warn: a sign-in method mail was not sent: the account has no proven address")
    }
    if (deps.sender && change.email) {
      const result = await deps.sender.send(signInMethodChangedMail(deps.brand, {
        to: change.email,
        provider: providerName(change.method),
        linked: change.eventType === AuthAuditEventType.SIGN_IN_METHOD_LINKED,
        at: change.changedAt,
        passkey: change.method === PASSKEY_METHOD,
      }))
      if (!result.ok) {
        deps.log("error: a sign-in method mail was not sent and will be retried")
        throw new Error("sign-in method mail not sent")
      }
    }
    await sql`DELETE FROM sign_in_method_changes WHERE id = ${event.aggregateId}`
  }
}
