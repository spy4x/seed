/**
 * Linked Telegram accounts (#269) in Postgres: the link code, the link itself and the account a
 * Telegram user acts as.
 *
 * A link is a row of `auth_keys` with method {@link TELEGRAM_METHOD} and the Telegram user id as
 * its subject: the unique `(method, subject)` keeps one Telegram account on one account, and
 * `auth_keys_one_telegram_idx` one Telegram account per account. The row holds no secret.
 *
 * A link code is a challenge of `@spy4x/server/auth`: 192 random bits as base64url, stored only as
 * a SHA-256, {@link TELEGRAM_LINK_MINUTES} minutes, deleted when it matches, so a code works once.
 * Its subject is the user id, so a new code replaces the last one. The code the person sends the
 * bot is `<user id>_<secret>`: only letters, digits, `_` and `-`, which a `t.me/<bot>?start=`
 * link carries as it is.
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import { type AuthStore, ChallengeOutcome } from "@spy4x/server/auth"
import { DEFAULT_CODE_MAX_ATTEMPTS } from "@spy4x/server/auth/email-code"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import { TELEGRAM_LINK_MINUTES, TELEGRAM_METHOD, type UserMFAStatus } from "@domain/identity"

/** The challenge purpose of a link code. */
export const TELEGRAM_LINK_PURPOSE = `app.telegram-link`

/** Random bytes in a code's secret: 192 bits, 32 base64url characters. */
const SECRET_BYTES = 24

/** A code as the bot reads it: the user id, `_`, then the secret. */
const CODE = /^([1-9]\d{0,9})_([A-Za-z0-9_-]{32})$/

/** How a link ended. */
export enum TelegramLinkOutcome {
  Linked = 1,
  /** This Telegram account was already linked to this account: nothing changed. */
  AlreadyLinked = 2,
  /** This Telegram account is linked to another account, which must unlink it first. */
  Taken = 3,
  /** The account is deleted or blocked. */
  AccountGone = 4,
}

/** The account a Telegram user acts as: live and not blocked. */
export interface TelegramAccount {
  userId: number
  firstName: string
  mfa: UserMFAStatus
}

/** The stored form of a secret: SHA-256 of the purpose, the user and the secret. */
function hashSecret(userId: number, secret: string): Promise<string> {
  return sha256Hex(`${TELEGRAM_LINK_PURPOSE}\n${userId}\n${secret}`)
}

/** Issues a new link code for `userId`; the one issued before stops working. */
export async function issueTelegramLinkCode(
  store: AuthStore,
  userId: number,
  now = new Date(),
): Promise<{ code: string; expiresAt: Date }> {
  const secret = randomBase64Url(SECRET_BYTES)
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_MINUTES * 60_000)
  await store.issueChallenge({
    purpose: TELEGRAM_LINK_PURPOSE,
    subject: String(userId),
    secretHash: await hashSecret(userId, secret),
    expiresAt,
    now,
  })
  return { code: `${userId}_${secret}`, expiresAt }
}

/**
 * Spends a link code: the user id once, when the code is live. Expired, used, malformed or wrong:
 * `null`, one answer for all. A wrong secret counts against the code, which dies after a few.
 */
export async function consumeTelegramLinkCode(
  store: AuthStore,
  code: unknown,
  now = new Date(),
): Promise<number | null> {
  if (typeof code !== `string`) return null
  const match = CODE.exec(code.trim())
  if (!match) return null
  const userId = Number(match[1])
  const outcome = await store.attemptChallenge({
    purpose: TELEGRAM_LINK_PURPOSE,
    subject: String(userId),
    secretHash: await hashSecret(userId, match[2]),
    maxAttempts: DEFAULT_CODE_MAX_ATTEMPTS,
    now,
  })
  return outcome === ChallengeOutcome.Matched ? userId : null
}

/** The `auth_keys` rows of method {@link TELEGRAM_METHOD} over `sql`, a pool or a transaction. */
export function telegramLinks(sql: Sql) {
  return {
    /** The person's link, or `null` when they have none. */
    async find(userId: number): Promise<{ telegramUserId: string; linkedAt: Date } | null> {
      const [row] = await sql<{ subject: string; createdAt: Date }[]>`
        SELECT subject, created_at FROM auth_keys
        WHERE user_id = ${userId} AND method = ${TELEGRAM_METHOD}
      `
      return row ? { telegramUserId: row.subject, linkedAt: row.createdAt } : null
    },

    /** The live, unblocked account Telegram user `telegramUserId` is linked to, or `null`. */
    async account(telegramUserId: number): Promise<TelegramAccount | null> {
      const [row] = await sql<{ id: number; firstName: string | null; mfa: UserMFAStatus }[]>`
        SELECT u.id, u.first_name, u.mfa FROM auth_keys k
        JOIN users u ON u.id = k.user_id
        WHERE k.method = ${TELEGRAM_METHOD} AND k.subject = ${String(telegramUserId)}
          AND u.deleted_at IS NULL AND u.blocked_at IS NULL
      `
      return row ? { userId: row.id, firstName: row.firstName ?? ``, mfa: row.mfa } : null
    },

    /**
     * Links Telegram user `telegramUserId` to `userId`, in place of any Telegram account linked
     * before. A Telegram account linked to another live account is refused; one linked to an
     * account waiting to be deleted moves. Inside a transaction: the person's row is locked, so
     * two links at once leave one.
     */
    async link(userId: number, telegramUserId: number): Promise<TelegramLinkOutcome> {
      const [user] = await sql`
        SELECT 1 FROM users
        WHERE id = ${userId} AND deleted_at IS NULL AND blocked_at IS NULL
        FOR UPDATE
      `
      if (!user) return TelegramLinkOutcome.AccountGone
      const subject = String(telegramUserId)
      const [owner] = await sql<{ userId: number; deleted: boolean }[]>`
        SELECT k.user_id, u.deleted_at IS NOT NULL AS deleted FROM auth_keys k
        JOIN users u ON u.id = k.user_id
        WHERE k.method = ${TELEGRAM_METHOD} AND k.subject = ${subject}
      `
      if (owner?.userId === userId) return TelegramLinkOutcome.AlreadyLinked
      if (owner && !owner.deleted) return TelegramLinkOutcome.Taken
      // An account waiting to be deleted lets its Telegram account go to the one linking it now.
      await sql`
        DELETE FROM auth_keys
        WHERE method = ${TELEGRAM_METHOD} AND (user_id = ${userId} OR subject = ${subject})
      `
      await sql`
        INSERT INTO auth_keys (user_id, method, subject)
        VALUES (${userId}, ${TELEGRAM_METHOD}, ${subject})
      `
      return TelegramLinkOutcome.Linked
    },

    /** Unlinks Telegram user `telegramUserId`: the account it was linked to, or `null`. */
    async unlinkTelegramUser(telegramUserId: number): Promise<number | null> {
      const [row] = await sql<{ userId: number }[]>`
        DELETE FROM auth_keys WHERE method = ${TELEGRAM_METHOD} AND subject = ${
        String(telegramUserId)
      }
        RETURNING user_id
      `
      return row?.userId ?? null
    },

    /** Unlinks the person's Telegram account: its id, or `null` when none was linked. */
    async unlink(userId: number): Promise<string | null> {
      const [row] = await sql<{ subject: string }[]>`
        DELETE FROM auth_keys WHERE user_id = ${userId} AND method = ${TELEGRAM_METHOD}
        RETURNING subject
      `
      return row?.subject ?? null
    },
  }
}

export type TelegramLinks = ReturnType<typeof telegramLinks>
