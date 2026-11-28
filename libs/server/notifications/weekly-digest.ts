/**
 * The weekly digest setting and its signed unsubscribe link (docs/weekly-digest.md). The
 * scheduler and the mail are jobs: `libs/server/jobs/weekly-digest-mail.ts`.
 *
 * @module
 */

import type postgres from "postgres"
import { type } from "arktype"
import { createSignedPayloadCodec } from "@spy4x/platform/signed-payload"
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

/** The signed-payload purpose of the unsubscribe token: no other token the template signs uses it. */
const TOKEN_PURPOSE = `weekly-digest.unsubscribe`

/** What the token carries: the `users.id` (an `int4`) whose digest it turns off. */
const tokenPayload = type({ userId: `0 < number.integer <= 2147483647`, "+": `reject` })

/** The signer and checker of digest unsubscribe tokens. */
export interface WeeklyDigestTokens {
  /** The token that turns off `userId`'s digest. It never expires. */
  sign(userId: number): Promise<string>
  /** The user id `token` turns off, or `null` for a token not signed by any configured secret. */
  verify(token: string): Promise<number | null>
}

/**
 * The digest's unsubscribe tokens: the user id in a signed payload of their own purpose, so no
 * newsletter token passes for one. Signed with `SUBSCRIBERS_SECRET`; the previous secrets still
 * verify, as the newsletter's do after a rotation. A token names only whose digest to turn off,
 * and turning it off is all it can do.
 */
export function createWeeklyDigestTokens(setup: SubscribersSetup): WeeklyDigestTokens {
  const codecs = [setup.secret, ...setup.previousSecrets].map((secret) =>
    createSignedPayloadCodec({ secret, purpose: TOKEN_PURPOSE, version: 1, schema: tokenPayload })
  )
  return {
    sign: (userId) => codecs[0].sign({ userId }),
    async verify(token) {
      // Capped before any crypto work, as the route caps it before it reads the token.
      if (token.length > WEEKLY_DIGEST_TOKEN_MAX_LENGTH) return null
      for (const codec of codecs) {
        const result = await codec.verify(token)
        if (result.ok) return result.value.userId
      }
      return null
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
