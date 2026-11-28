/**
 * The weekly digest setting and its signed unsubscribe link (docs/weekly-digest.md). The
 * scheduler and the mail are jobs: `libs/server/jobs/weekly-digest-mail.ts`.
 *
 * @module
 */

import type postgres from "postgres"
import { encodeBase64Url } from "@std/encoding"
import { constantTimeEqualsText, deriveSecret } from "@spy4x/platform/tokens"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  WEEKLY_DIGEST_TOKEN_MAX_LENGTH,
  type WeeklyDigestSetting,
  type WeeklyDigestState,
} from "@domain/notifications"
import type { SubscribersSetup } from "../subscribers/subscribers.ts"

interface DigestRow extends postgres.Row {
  weekday: number
  hour: number
  timeZone: string
  nextAt: Date
}

const toState = (row: DigestRow | undefined): WeeklyDigestState =>
  row
    ? {
      on: true,
      weekday: row.weekday,
      hour: row.hour,
      timeZone: row.timeZone,
      nextAt: row.nextAt.toISOString(),
    }
    : { on: false }

/** The person's digest setting; off when they never turned it on. */
export async function readWeeklyDigest(
  sql: postgres.Sql,
  userId: number,
): Promise<WeeklyDigestState> {
  const [row] = await sql<DigestRow[]>`
    SELECT weekday, hour, time_zone, next_at FROM weekly_digests WHERE user_id = ${userId}
  `
  return toState(row)
}

/**
 * Saves the person's digest setting, already checked against `weeklyDigestSettingSchema`. Off
 * deletes the row, so a mail job queued before it sends nothing. On computes the next send after
 * `now`; turning it on starts the first digest's window at `now`, and a change while on keeps the
 * window and the row's id.
 */
export async function saveWeeklyDigest(
  sql: postgres.Sql,
  userId: number,
  setting: WeeklyDigestSetting,
  now: Date = new Date(),
): Promise<WeeklyDigestState> {
  if (!setting.on) {
    await sql`DELETE FROM weekly_digests WHERE user_id = ${userId}`
    return { on: false }
  }
  const { weekday, hour, timeZone } = setting
  const [row] = await sql<DigestRow[]>`
    INSERT INTO weekly_digests (user_id, id, weekday, hour, time_zone, next_at, window_from)
    VALUES (
      ${userId}, ${uuidV7()}, ${weekday}, ${hour}, ${timeZone},
      weekly_digest_next_at(${now}, ${weekday}::int2, ${hour}::int2, ${timeZone}), ${now}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      weekday = EXCLUDED.weekday,
      hour = EXCLUDED.hour,
      time_zone = EXCLUDED.time_zone,
      next_at = EXCLUDED.next_at,
      updated_at = ${now}
    RETURNING weekday, hour, time_zone, next_at
  `
  return toState(row)
}

/** The HKDF label of the unsubscribe key: no other token the template signs uses it. */
const TOKEN_LABEL = `weekly-digest:unsubscribe`

/** A user id, a dot, and an HMAC-SHA-256 signature in unpadded base64url (43 characters). */
const TOKEN = /^([1-9][0-9]{0,9})\.([A-Za-z0-9_-]{43})$/

/** The signer and checker of digest unsubscribe tokens. */
export interface WeeklyDigestTokens {
  /** The token that turns off `userId`'s digest. It never expires. */
  sign(userId: number): Promise<string>
  /** The user id `token` turns off, or `null` for a token not signed by any configured secret. */
  verify(token: string): Promise<number | null>
}

/**
 * The digest's unsubscribe tokens, signed with a key derived from `SUBSCRIBERS_SECRET` under a
 * label of their own, so no newsletter token passes for one. The previous secrets still verify,
 * as the newsletter's do after a rotation. A token is the user id and an HMAC of it: it names only
 * whose digest to turn off, and turning it off is all it can do.
 */
export async function createWeeklyDigestTokens(
  setup: SubscribersSetup,
): Promise<WeeklyDigestTokens> {
  const keys = await Promise.all(
    [setup.secret, ...setup.previousSecrets].map(async (secret) =>
      await crypto.subtle.importKey(
        `raw`,
        new TextEncoder().encode(await deriveSecret(secret, TOKEN_LABEL)),
        { name: `HMAC`, hash: `SHA-256` },
        false,
        [`sign`],
      )
    ),
  )
  const signature = async (key: CryptoKey, userId: string) =>
    encodeBase64Url(
      await crypto.subtle.sign(`HMAC`, key, new TextEncoder().encode(`${TOKEN_LABEL}:${userId}`)),
    )
  return {
    sign: async (userId) => `${userId}.${await signature(keys[0], String(userId))}`,
    async verify(token) {
      if (token.length > WEEKLY_DIGEST_TOKEN_MAX_LENGTH) return null
      const match = TOKEN.exec(token)
      if (!match) return null
      const userId = Number(match[1])
      if (userId > 2_147_483_647) return null
      // Every key is tried, so the time taken does not tell which secret signed it.
      let valid = false
      for (const key of keys) {
        if (await constantTimeEqualsText(await signature(key, match[1]), match[2])) valid = true
      }
      return valid ? userId : null
    },
  }
}

/**
 * The unsubscribe link a digest carries, in its body and in `List-Unsubscribe`: the API, at the
 * app's address. A mail client's one-click POST (RFC 8058) lands there; a person's GET is sent on
 * to the app's page {@link WEEKLY_DIGEST_UNSUBSCRIBE_PAGE}.
 */
export function weeklyDigestUnsubscribeLink(webAppUrl: string, token: string): string {
  return `${webAppUrl}/api/weekly-digest/unsubscribe?${new URLSearchParams({ token })}`
}

/** The app's page that confirms an unsubscribe, with the token in its query (spy4x/seed#1172). */
export const WEEKLY_DIGEST_UNSUBSCRIBE_PAGE = `/digest/unsubscribe`
