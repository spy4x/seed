import type postgres from "postgres"
import { API_TOKEN_PURGE_GRACE_DAYS } from "@domain/api-tokens"
import { AuthAuditEventType } from "@domain/identity"

/**
 * The most token ids one audit row names: its `identifier` column holds 320 characters, and eight
 * ids with their count take 297.
 */
export const API_TOKEN_PURGE_AUDIT_IDS = 8

/**
 * Deletes every personal API token that expired more than `days` ago (30 by default,
 * {@link API_TOKEN_PURGE_GRACE_DAYS}) and returns how many. It runs in the worker's nightly
 * cleanup. An expired token is refused and hidden from its owner's list from the moment it
 * expires; this removes its row, and with it the hash.
 *
 * Only the expiry decides. A token that never expires has no expiry to count from and stays. A
 * token of a soft-deleted group or account stays too, until its own expiry is that old: it works
 * again once the group or the account is restored. A revoked token needs no
 * purge: revoking deletes its row at once.
 *
 * Each owner who lost a token gets an `auth_audits` row of type
 * {@link AuthAuditEventType.API_TOKENS_PURGED}. Its identifier is the count of the tokens deleted,
 * a colon and their ids, so the ids in the owner's older audit rows can still be matched; an id is
 * random and says nothing about the secret, and no name, hash or part of a token is written. A row
 * names at most {@link API_TOKEN_PURGE_AUDIT_IDS} tokens, so an owner who lost more gets more
 * rows. The delete and the rows are one statement, so both are kept or neither is.
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
      RETURNING id, user_id
    ),
    numbered AS (
      SELECT id, user_id,
        (row_number() OVER (PARTITION BY user_id ORDER BY id) - 1) / ${API_TOKEN_PURGE_AUDIT_IDS}::int
          AS part
      FROM removed
    ),
    audited AS (
      INSERT INTO auth_audits (user_id, event_type, identifier)
      SELECT user_id, ${AuthAuditEventType.API_TOKENS_PURGED},
        count(*) || ':' || string_agg(id::text, ',' ORDER BY id)
      FROM numbered
      GROUP BY user_id, part
    )
    SELECT count(*)::int AS count FROM removed
  `
  return count
}
