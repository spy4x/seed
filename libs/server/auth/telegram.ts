/**
 * Linked Telegram accounts (#269) in Postgres: the link code, the link itself and the account a
 * Telegram user acts as.
 *
 * A link is a row of `auth_keys` with method {@link TELEGRAM_METHOD} and the Telegram user id as
 * its subject: the unique `(method, subject)` keeps one Telegram account on one account, and
 * {@link telegramLinks}' `link`, under a lock on the person's row, one Telegram account per
 * account. The row holds no secret.
 *
 * A link code is a challenge of `@spy4x/server/auth`, {@link TELEGRAM_LINK_MINUTES} minutes,
 * deleted when it matches, so a code works once. The code the person sends the bot is
 * `<user id>_<binding>_<secret>`: 96 and 144 random bits as base64url, at most 52 characters of
 * letters, digits, `_` and `-`, which a `t.me/<bot>?start=` link (64 at most) carries as it is.
 * The challenge's subject is `<user id>:<SHA-256 of the binding>`, as `@spy4x/server/auth`'s bound
 * e-mail codes do: someone who knows only a user id reaches no challenge, so their wrong guesses
 * cannot use up a person's attempts. Issuing a code deletes the person's older ones.
 *
 * A code sent to the bot does not link at once: it names the account and asks for a "Link" press,
 * which spends a second challenge ({@link TELEGRAM_CONFIRM_PURPOSE}) whose subject is
 * `<user id>:<Telegram user id>`, so only that Telegram user's press reaches it. A `t.me` link
 * someone else made therefore cannot attach a person's Telegram to their account unseen. Both
 * challenges start with the user id, so a password reset ends every one the person has
 * ({@link telegramLinks}' `dropPending`).
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

/** The challenge purpose of a "Link" press after a code. */
export const TELEGRAM_CONFIRM_PURPOSE = `app.telegram-confirm`

/** Random bytes in a code's binding: 96 bits, 16 base64url characters. */
const BINDING_BYTES = 12

/** Random bytes in a code's secret: 144 bits, 24 base64url characters. */
const SECRET_BYTES = 18

/** Random bytes in a "Link" button's nonce: 96 bits, 16 base64url characters. */
const NONCE_BYTES = 12

/** A code as the bot reads it: the user id, the binding and the secret, joined by `_`. */
const CODE = /^([1-9]\d{0,9})_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{24})$/

/** A "Link" button's token: the user id and the nonce. */
const TOKEN = /^([1-9]\d{0,9})_([A-Za-z0-9_-]{16})$/

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
function hashSecret(purpose: string, userId: number, secret: string): Promise<string> {
  return sha256Hex(`${purpose}\n${userId}\n${secret}`)
}

/** The challenge subject of a "Link" press: the account, then the Telegram user who may press. */
function confirmSubject(userId: number, telegramUserId: number): string {
  return `${userId}:${telegramUserId}`
}

/** The challenge subject of a code: the user id, then a digest of its binding. */
async function codeSubject(userId: number, binding: string): Promise<string> {
  return `${userId}:${await sha256Hex(`${TELEGRAM_LINK_PURPOSE}\nbinding\n${binding}`)}`
}

/**
 * Issues a new link code for `userId`. Call {@link telegramLinks}' `dropCodes` first, in the same
 * transaction, so the person's older codes stop working.
 */
export async function issueTelegramLinkCode(
  store: AuthStore,
  userId: number,
  now = new Date(),
): Promise<{ code: string; expiresAt: Date }> {
  const binding = randomBase64Url(BINDING_BYTES)
  const secret = randomBase64Url(SECRET_BYTES)
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_MINUTES * 60_000)
  await store.issueChallenge({
    purpose: TELEGRAM_LINK_PURPOSE,
    subject: await codeSubject(userId, binding),
    secretHash: await hashSecret(TELEGRAM_LINK_PURPOSE, userId, secret),
    expiresAt,
    now,
  })
  return { code: `${userId}_${binding}_${secret}`, expiresAt }
}

/**
 * Spends a link code: the user id once, when the code is live. Expired, used, malformed or wrong:
 * `null`, one answer for all. A wrong secret counts against that code only, which dies after a
 * few.
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
    subject: await codeSubject(userId, match[2]),
    secretHash: await hashSecret(TELEGRAM_LINK_PURPOSE, userId, match[3]),
    maxAttempts: DEFAULT_CODE_MAX_ATTEMPTS,
    now,
  })
  return outcome === ChallengeOutcome.Matched ? userId : null
}

/**
 * The token of a "Link" button for Telegram user `telegramUserId` and account `userId`, valid
 * {@link TELEGRAM_LINK_MINUTES} minutes. Only a press by that Telegram user spends it.
 */
export async function issueTelegramConfirmToken(
  store: AuthStore,
  userId: number,
  telegramUserId: number,
  now = new Date(),
): Promise<string> {
  const nonce = randomBase64Url(NONCE_BYTES)
  await store.issueChallenge({
    purpose: TELEGRAM_CONFIRM_PURPOSE,
    subject: confirmSubject(userId, telegramUserId),
    secretHash: await hashSecret(TELEGRAM_CONFIRM_PURPOSE, userId, nonce),
    expiresAt: new Date(now.getTime() + TELEGRAM_LINK_MINUTES * 60_000),
    now,
  })
  return `${userId}_${nonce}`
}

/** Spends a "Link" button's token pressed by `telegramUserId`: the account it links, or `null`. */
export async function consumeTelegramConfirmToken(
  store: AuthStore,
  token: unknown,
  telegramUserId: number,
  now = new Date(),
): Promise<number | null> {
  if (typeof token !== `string`) return null
  const match = TOKEN.exec(token.trim())
  if (!match) return null
  const userId = Number(match[1])
  const outcome = await store.attemptChallenge({
    purpose: TELEGRAM_CONFIRM_PURPOSE,
    subject: confirmSubject(userId, telegramUserId),
    secretHash: await hashSecret(TELEGRAM_CONFIRM_PURPOSE, userId, match[2]),
    maxAttempts: DEFAULT_CODE_MAX_ATTEMPTS,
    now,
  })
  return outcome === ChallengeOutcome.Matched ? userId : null
}

/** Whose account a "Link" press names. */
export interface TelegramAccountLabel {
  /** The first name, or empty when none is set. */
  firstName: string
  /** The address masked (`a•••@example.com`), or `null` when the account has none. */
  maskedAddress: string | null
}

/** A Telegram account a link removed: from this person, or from an account awaiting deletion. */
export interface TelegramReleased {
  userId: number
  telegramUserId: string
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
    async link(
      userId: number,
      telegramUserId: number,
    ): Promise<{ outcome: TelegramLinkOutcome; released: TelegramReleased[] }> {
      const [user] = await sql`
        SELECT 1 FROM users
        WHERE id = ${userId} AND deleted_at IS NULL AND blocked_at IS NULL
        FOR UPDATE
      `
      if (!user) return { outcome: TelegramLinkOutcome.AccountGone, released: [] }
      const subject = String(telegramUserId)
      const [owner] = await sql<{ userId: number; deleted: boolean }[]>`
        SELECT k.user_id, u.deleted_at IS NOT NULL AS deleted FROM auth_keys k
        JOIN users u ON u.id = k.user_id
        WHERE k.method = ${TELEGRAM_METHOD} AND k.subject = ${subject}
      `
      if (owner?.userId === userId) {
        return { outcome: TelegramLinkOutcome.AlreadyLinked, released: [] }
      }
      if (owner && !owner.deleted) return { outcome: TelegramLinkOutcome.Taken, released: [] }
      // An account waiting to be deleted lets its Telegram account go to the one linking it now.
      const released = await sql<{ userId: number; subject: string }[]>`
        DELETE FROM auth_keys
        WHERE method = ${TELEGRAM_METHOD} AND (user_id = ${userId} OR subject = ${subject})
        RETURNING user_id, subject
      `
      await sql`
        INSERT INTO auth_keys (user_id, method, subject)
        VALUES (${userId}, ${TELEGRAM_METHOD}, ${subject})
      `
      return {
        outcome: TelegramLinkOutcome.Linked,
        released: released.map((row) => ({ userId: row.userId, telegramUserId: row.subject })),
      }
    },

    /** Deletes the person's link codes, so only the one issued next works. */
    async dropCodes(userId: number): Promise<void> {
      await sql`
        DELETE FROM auth_challenges
        WHERE purpose = ${TELEGRAM_LINK_PURPOSE} AND subject LIKE ${`${userId}:%`}
      `
    },

    /**
     * Deletes the person's link codes and the "Link" presses waiting for a Telegram user, so
     * nothing made before links. A password reset or change calls it: one made with a stolen
     * session must not link after the owner has recovered the account.
     */
    async dropPending(userId: number): Promise<void> {
      await sql`
        DELETE FROM auth_challenges
        WHERE purpose IN (${TELEGRAM_LINK_PURPOSE}, ${TELEGRAM_CONFIRM_PURPOSE})
          AND subject LIKE ${`${userId}:%`}
      `
    },

    /**
     * Whose account a "Link" press names: the first name, which anyone can copy, and the address
     * masked, which makes it harder to imitate but not impossible. `null` when the account is gone.
     */
    async describe(userId: number): Promise<TelegramAccountLabel | null> {
      const [row] = await sql<{ firstName: string | null; email: string | null }[]>`
        SELECT u.first_name, (
          SELECT k.email FROM auth_keys k
          WHERE k.user_id = u.id AND k.email IS NOT NULL ORDER BY k.id LIMIT 1
        ) AS email
        FROM users u
        WHERE u.id = ${userId} AND u.deleted_at IS NULL AND u.blocked_at IS NULL
      `
      if (!row) return null
      return {
        firstName: row.firstName?.trim() ?? ``,
        maskedAddress: row.email ? maskAddress(row.email) : null,
      }
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

/** `ada@example.com` as `a•••@example.com`: enough to recognise, not enough to collect. */
export function maskAddress(email: string): string {
  const at = email.lastIndexOf(`@`)
  if (at < 1) return `•••`
  return `${email[0]}•••${email.slice(at)}`
}
