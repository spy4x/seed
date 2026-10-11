import type postgres from "postgres"
import { API_TOKEN_PURGE_GRACE_DAYS } from "@domain/api-tokens"
import { AuthAuditEventType } from "@domain/identity"
import { apiTokenAuditIdentifier } from "./api-tokens.ts"

/**
 * Deletes every personal API token that expired, or was revoked, more than `days` ago (30 by
 * default, {@link API_TOKEN_PURGE_GRACE_DAYS}) and returns how many. It runs in the worker's
 * nightly cleanup. An expired or revoked token is refused and hidden from its owner's list from
 * that moment; this removes its row, and with it the hash.
 *
 * Only the two dates decide. A token that never expires and is not revoked stays. A token of a
 * soft-deleted account stays too, until its own expiry is that old: it works again once the
 * account is restored.
 *
 * Each expired token deleted gets one `auth_audits` row of type
 * {@link AuthAuditEventType.API_TOKENS_PURGED} for its owner, naming the token (its id, group,
 * access and name; never the hash), so the token's older audit rows can still be matched. A revoked
 * token gets none here: its {@link AuthAuditEventType.API_TOKEN_REVOKED} row already names it. The
 * delete and the rows are one statement, so both are kept or neither is.
 *
 * It uses the clock of the database, as the check that refuses an expired token does. A token that
 * expired exactly `days` ago stays until the next run.
 */
export async function purgeExpiredApiTokens(
  sql: postgres.Sql,
  days: number = API_TOKEN_PURGE_GRACE_DAYS,
): Promise<number> {
  const [{ count }] = await sql<{ count: number }[]>`
    WITH removed AS (
      DELETE FROM api_tokens
      WHERE expires_at < now() - make_interval(days => ${days})
        OR revoked_at < now() - make_interval(days => ${days})
      RETURNING id, user_id, group_id, access, name, revoked_at
    ),
    audited AS (
      INSERT INTO auth_audits (user_id, event_type, identifier)
      SELECT user_id, ${AuthAuditEventType.API_TOKENS_PURGED}, ${apiTokenAuditIdentifier(sql, null)}
      FROM removed
      WHERE revoked_at IS NULL
    )
    SELECT count(*)::int AS count FROM removed
  `
  return count
}
