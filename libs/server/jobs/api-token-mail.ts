import type postgres from "postgres"
import type { EmailSender } from "@spy4x/email/sender"
import { ApiTokenAccess } from "@domain/api-tokens"
import { apiTokenCreatedMail, type MailBrand } from "../mail/mail.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"

/** The job that tells a person an API token was created. Its aggregate id is the token's id. */
export const API_TOKEN_CREATED_MAIL_JOB = "api-token.created-mail"

/**
 * Queues the mail about token `tokenId` in the caller's transaction, the create's own, so the mail
 * is queued exactly when the token exists.
 */
export async function enqueueApiTokenCreatedMail(tx: postgres.Sql, tokenId: string): Promise<void> {
  await enqueueJob(tx, API_TOKEN_CREATED_MAIL_JOB, tokenId, { inMs: 0 })
}

/** What the token mail job needs. */
export interface ApiTokenCreatedMailDeps {
  sql: postgres.Sql
  /** `null` when mail is off: nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails or there is no proven address; gets no address. */
  log: (line: string) => void
}

interface TokenRow extends postgres.Row {
  name: string
  groupName: string
  access: number
  expiresAt: Date | null
  email: string | null
}

/**
 * Mails the owner of the token the job names, at their first proven address, that the token was
 * created. A token revoked since is still mailed: it existed, and the owner should know. A row
 * that is gone (the account or the group was deleted for good) sends nothing, and an address
 * nobody proved gets nothing, as for the other account mails. A failed send throws, so the job is
 * retried.
 */
export function apiTokenCreatedMailJob(deps: ApiTokenCreatedMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    if (!deps.sender) return
    const [token] = await sql<TokenRow[]>`
      SELECT api_tokens.name, groups.name AS "groupName", api_tokens.access,
        api_tokens.expires_at AS "expiresAt", (
          SELECT auth_keys.proven_email FROM auth_keys
          WHERE auth_keys.user_id = api_tokens.user_id AND auth_keys.proven_email IS NOT NULL
          ORDER BY auth_keys.id
          LIMIT 1
        ) AS email
      FROM api_tokens
      INNER JOIN groups ON groups.id = api_tokens.group_id
      WHERE api_tokens.id = ${event.aggregateId}
    `
    if (!token) return
    if (!token.email) {
      deps.log("warn: an API token mail was not sent: the account has no proven address")
      return
    }
    const result = await deps.sender.send(apiTokenCreatedMail(deps.brand, {
      to: token.email,
      name: token.name,
      groupName: token.groupName,
      canWrite: token.access === ApiTokenAccess.WRITE,
      expiresAt: token.expiresAt,
    }))
    if (!result.ok) {
      deps.log("error: an API token mail was not sent and will be retried")
      throw new Error("API token mail not sent")
    }
  }
}
