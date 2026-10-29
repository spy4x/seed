/**
 * The newsletter module of the operator area (#428): its reads over the subscriber tables, the CSV
 * of a list, and the two actions on one address. Who may call them is the API's business
 * (`apps/api/routes/admin/newsletter.ts`); every audit row is the caller's too.
 *
 * An address is `confirmed` while it has a `subscribers` row, and `pending` while a confirm mail
 * for it waits in `subscription_requests`. Nothing else names an address: a confirm link that was
 * mailed lives only in that mail, and an unsubscribe deletes the row and keeps a keyed mark.
 *
 * @module
 */

import type postgres from "postgres"
import { ONE_DAY_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { CONFIRM_TTL_MS } from "@spy4x/server/subscribers"
import { createPostgresSubscriberStore } from "@spy4x/server/subscribers/postgres"
import { type CsvColumn, toCsvBytes } from "@spy4x/platform/universal/csv"
import type {
  AdminNewsletterSend,
  AdminNewsletterStats,
  AdminSubscriberFilter,
  AdminSubscriberRow,
  AdminSubscriberStatus,
  SubscriberList,
} from "@domain/subscribers"
import { DEFAULT_LANGUAGE, type Language } from "@domain/identity"
import { fillDays, statsDays } from "../auth/admin-stats.ts"
import { likeContains } from "@spy4x/server/db"
import { enqueueSubscriberMail, SUBSCRIBER_CONFIRM_MAIL_JOB } from "../jobs/subscriber-mail.ts"
import { createListCrypto, type SubscribersSetup } from "./subscribers.ts"

interface SubscriberDbRow {
  email: string
  status: AdminSubscriberStatus
  requestedAt: Date | null
  confirmedAt: Date | null
  language: Language
}

function toRow(row: SubscriberDbRow): AdminSubscriberRow {
  return {
    email: row.email,
    status: row.status,
    requestedAt: row.requestedAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    language: row.language,
  }
}

/**
 * Every address of `list` with its status, as one SQL fragment: the confirmed rows, then each
 * pending address once, with its newest confirm request. A request for an address that is already
 * listed is no pending address (the public form queues one for a listed address too, so the
 * answer tells nothing), and neither is a welcome mail's request. A confirmed address has its
 * stored language, a pending one its newest request's, and one with none the main language (#527).
 */
function addresses(sql: postgres.Sql, list: SubscriberList) {
  return sql`
    SELECT s.email, 'confirmed' AS status, NULL::timestamptz AS requested_at,
      s.subscribed_at AS confirmed_at, s.subscribed_at AS at,
      COALESCE(s.language, ${DEFAULT_LANGUAGE}) AS language
    FROM subscribers s
    WHERE s.list_id = ${list}
    UNION ALL
    SELECT r.email, 'pending', max(r.created_at), NULL, max(r.created_at),
      COALESCE((array_agg(r.language ORDER BY r.created_at DESC))[1], ${DEFAULT_LANGUAGE})
    FROM subscription_requests r
    JOIN outbox_events o
      ON o.aggregate_id = r.id AND o.event_kind = ${SUBSCRIBER_CONFIRM_MAIL_JOB}
    WHERE r.list_id = ${list}
      AND NOT EXISTS (
        SELECT 1 FROM subscribers s WHERE s.list_id = r.list_id AND s.email = r.email
      )
    GROUP BY r.email
  `
}

/** One page of `list`'s addresses matching `filter`, newest first, and how many match in all. */
export async function listAdminSubscribers(
  sql: postgres.Sql,
  list: SubscriberList,
  filter: AdminSubscriberFilter,
  pageSize: number,
): Promise<{ subscribers: AdminSubscriberRow[]; total: number }> {
  const where = sql`
    WHERE (${filter.query} = '' OR a.email ILIKE ${likeContains(filter.query)})
      AND (${filter.status} = 'any' OR a.status = ${filter.status})
      AND (${filter.language} = 'any' OR a.language = ${filter.language})
  `
  const [{ total }] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM (${addresses(sql, list)}) a ${where}
  `
  const rows = await sql<SubscriberDbRow[]>`
    SELECT a.email, a.status, a.requested_at, a.confirmed_at, a.language
    FROM (${addresses(sql, list)}) a ${where}
    ORDER BY a.at DESC, a.email
    LIMIT ${pageSize} OFFSET ${(filter.page - 1) * pageSize}
  `
  return { subscribers: rows.map(toRow), total }
}

/** Every address of `list`, newest first: what the CSV holds. */
export async function allAdminSubscribers(
  sql: postgres.Sql,
  list: SubscriberList,
): Promise<AdminSubscriberRow[]> {
  const rows = await sql<SubscriberDbRow[]>`
    SELECT a.email, a.status, a.requested_at, a.confirmed_at, a.language
    FROM (${addresses(sql, list)}) a
    ORDER BY a.at DESC, a.email
  `
  return rows.map(toRow)
}

/** `email`'s row on `list`, or `null` when it is neither confirmed nor pending. */
export async function findAdminSubscriber(
  sql: postgres.Sql,
  list: SubscriberList,
  email: string,
): Promise<AdminSubscriberRow | null> {
  const [row] = await sql<SubscriberDbRow[]>`
    SELECT a.email, a.status, a.requested_at, a.confirmed_at, a.language
    FROM (${addresses(sql, list)}) a
    WHERE a.email = ${email}
  `
  return row ? toRow(row) : null
}

/**
 * The newsletter's numbers as of `now`: counts per status, the addresses that confirmed in the
 * last 30 days against the 30 before, the list's size at the end of each of the last 30 UTC days,
 * and how many issues were sent. Counts only.
 */
export async function readAdminNewsletterStats(
  sql: postgres.Sql,
  list: SubscriberList,
  now: Date,
): Promise<AdminNewsletterStats> {
  const days = statsDays(now)
  const from = new Date(`${days[0]}T00:00:00.000Z`)
  const monthAgo = new Date(now.getTime() - 30 * ONE_DAY_IN_MILLISECONDS)
  const twoMonthsAgo = new Date(now.getTime() - 60 * ONE_DAY_IN_MILLISECONDS)
  const [counts] = await sql<{
    confirmed: number
    pending: number
    joined: number
    joinedBefore: number
    before: number
    issues: number
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE a.status = 'confirmed')::int AS confirmed,
      COUNT(*) FILTER (WHERE a.status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE a.status = 'confirmed' AND a.at >= ${monthAgo})::int AS joined,
      COUNT(*) FILTER (
        WHERE a.status = 'confirmed' AND a.at >= ${twoMonthsAgo} AND a.at < ${monthAgo}
      )::int AS joined_before,
      COUNT(*) FILTER (WHERE a.status = 'confirmed' AND a.at < ${from})::int AS before,
      (SELECT COUNT(*) FROM subscriber_sends WHERE list_id = ${list})::int AS issues
    FROM (${addresses(sql, list)}) a
  `
  const perDay = await sql<{ day: string; count: number }[]>`
    SELECT to_char(subscribed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
    FROM subscribers
    WHERE list_id = ${list} AND subscribed_at >= ${from}
    GROUP BY 1
  `
  let running = counts.before
  const subscribersPerDay = fillDays(days, perDay).map(({ day, count }) => {
    running += count
    return { day, count: running }
  })
  return {
    generatedAt: now.toISOString(),
    confirmed: counts.confirmed,
    pending: counts.pending,
    joined: { current: counts.joined, previous: counts.joinedBefore },
    subscribersPerDay,
    issues: counts.issues,
  }
}

interface SendDbRow {
  issue: string
  subject: string
  startedAt: Date
  completedAt: Date | null
  recipients: number | null
  sent: number | null
  failed: number | null
}

/**
 * The newest `limit` issues sent to `list`, from the send log. `recipients` counts the audience
 * the send was meant for, and `sent` the mails delivered so far while a send runs; the log keeps
 * keyed marks in both, never an address.
 */
export async function listAdminNewsletterSends(
  sql: postgres.Sql,
  list: SubscriberList,
  limit: number,
): Promise<AdminNewsletterSend[]> {
  const rows = await sql<SendDbRow[]>`
    SELECT issue, subject, started_at, completed_at, cardinality(audience) AS recipients,
      COALESCE(sent, cardinality(recipients)) AS sent, failed
    FROM subscriber_sends
    WHERE list_id = ${list}
    ORDER BY started_at DESC, issue
    LIMIT ${limit}
  `
  return rows.map((row) => ({
    issue: row.issue,
    subject: row.subject,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    recipients: row.recipients,
    sent: row.sent,
    failed: row.failed,
  }))
}

/** The CSV's columns, in order. */
const CSV_COLUMNS: CsvColumn<AdminSubscriberRow>[] = [
  { key: `email`, header: `Address` },
  { key: `status`, header: `Status` },
  { key: `requestedAt`, header: `Requested at` },
  { key: `confirmedAt`, header: `Confirmed at` },
  { key: `language`, header: `Language` },
]

/**
 * `rows` as a UTF-8 CSV file with a byte-order mark. Every cell goes through the library's
 * formula guard, so an address such as `=HYPERLINK(...)@example.com` opens as text.
 */
export function adminSubscribersCsv(rows: readonly AdminSubscriberRow[]): Uint8Array<ArrayBuffer> {
  return toCsvBytes(CSV_COLUMNS, rows)
}

/**
 * Takes `email` off `list` the way an unsubscribe link does: the row goes and the address's mark
 * is recorded, so no confirm link mailed before now can add it back. Any queued confirm or welcome
 * mail for it is dropped too. True when the address had a row or a queued mail.
 */
export async function removeAdminSubscriber(
  { sql, setup, list, email, now }: {
    sql: postgres.Sql
    setup: SubscribersSetup
    list: SubscriberList
    email: string
    now: Date
  },
): Promise<boolean> {
  const crypto = await createListCrypto(setup, list)
  const dropped = await sql`
    DELETE FROM subscription_requests WHERE list_id = ${list} AND email = ${email}
  `
  const removed = await createPostgresSubscriberStore(sql, { listId: list }).remove({
    email,
    mark: await crypto.unsubscribeMark(email),
    at: now,
    pruneBefore: new Date(now.getTime() - CONFIRM_TTL_MS),
  })
  return removed || dropped.count > 0
}

/**
 * Queues a new confirm mail to `email` for `list`, in the language of its newest request; the
 * worker signs and sends it.
 */
export async function resendAdminConfirmation(
  sql: postgres.Sql,
  list: SubscriberList,
  email: string,
): Promise<void> {
  const [newest] = await sql<{ language: Language | null }[]>`
    SELECT language FROM subscription_requests WHERE list_id = ${list} AND email = ${email}
    ORDER BY created_at DESC LIMIT 1
  `
  await enqueueSubscriberMail(
    sql,
    SUBSCRIBER_CONFIRM_MAIL_JOB,
    list,
    email,
    newest?.language ?? null,
  )
}
