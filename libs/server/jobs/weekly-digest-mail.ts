import type postgres from "postgres"
import type { EmailSender } from "@spy4x/email/sender"
import { WEEKLY_DIGEST_MAX_GROUPS } from "@domain/notifications"
import { type MailBrand, type WeeklyDigestGroup, weeklyDigestMail } from "../mail/mail.ts"
import { readMailReader } from "../mail/reader.ts"
import {
  createWeeklyDigestTokens,
  weeklyDigestUnsubscribeLink,
} from "../notifications/weekly-digest.ts"
import type { SubscribersSetup } from "../subscribers/subscribers.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"

/** The repeating job that queues the digests whose time has come. */
export const WEEKLY_DIGEST_SCHEDULE_JOB = `notifications.weekly-digest-schedule`

/** The job that mails one digest. Its aggregate id is a `weekly_digests` row's `id`. */
export const WEEKLY_DIGEST_MAIL_JOB = `notifications.weekly-digest-mail`

/** How many due digests one transaction claims. */
const SCHEDULE_BATCH = 500

/**
 * Queues one mail job per digest due at `now`, and in the same transaction moves each one's
 * `next_at` to its next weekday and hour after `now`. A second run finds nothing due, so a week
 * gets one mail however often this runs, and a digest overdue by weeks (a worker that was down)
 * gets one mail, not one per missed week. Rows another run holds are skipped, not waited for.
 * Answers how many it queued.
 */
export async function queueDueWeeklyDigests(sql: postgres.Sql, now: Date): Promise<number> {
  let queued = 0
  while (true) {
    const claimed = await sql.begin(async (tx) => {
      const due = await tx<{ id: string }[]>`
        UPDATE weekly_digests AS digest SET
          next_at = weekly_digest_next_at(${now}, digest.weekday, digest.hour, digest.time_zone),
          updated_at = ${now}
        FROM (
          SELECT user_id FROM weekly_digests WHERE next_at <= ${now}
          ORDER BY next_at LIMIT ${SCHEDULE_BATCH}
          FOR UPDATE SKIP LOCKED
        ) AS due
        WHERE digest.user_id = due.user_id
        RETURNING digest.id
      `
      for (const { id } of due) await enqueueJob(tx, WEEKLY_DIGEST_MAIL_JOB, id, { inMs: 0 })
      return due.length
    })
    queued += claimed
    if (claimed < SCHEDULE_BATCH) return queued
  }
}

/** What the scheduler job needs. */
export interface WeeklyDigestScheduleDeps {
  sql: postgres.Sql
  /** The current time; tests pass a fixed one. */
  now?: () => Date
}

/** The scheduler job: {@link queueDueWeeklyDigests} at the run's time. */
export function weeklyDigestScheduleJob(
  { sql, now = () => new Date() }: WeeklyDigestScheduleDeps,
): JobHandler {
  return async () => {
    await queueDueWeeklyDigests(sql, now())
  }
}

/** What the digest mail job needs. */
export interface WeeklyDigestMailDeps {
  sql: postgres.Sql
  /** `null` when mail is off: nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a digest cannot be sent; gets no address. */
  log: (line: string) => void
  /** Signs the unsubscribe link; `null` without `SUBSCRIBERS_SECRET`: nothing is sent. */
  subscribers: SubscribersSetup | null
  /** The current time, the end of the digest's window; tests pass a fixed one. */
  now?: () => Date
}

interface DigestRow extends postgres.Row {
  userId: number
  windowFrom: Date
  email: string | null
}

interface GroupRow extends WeeklyDigestGroup, postgres.Row {}

/**
 * The groups `userId` is a member of now, not deleted, in which others changed something from
 * `from` up to `to`: notes created, notes made earlier and edited, and people who joined. The
 * person's own notes, edits and joining are left out, and so is every group they are not in, so a
 * digest names nothing its reader cannot open. Most changes first.
 */
export async function weeklyDigestGroups(
  sql: postgres.Sql,
  userId: number,
  from: Date,
  to: Date,
): Promise<WeeklyDigestGroup[]> {
  return await sql<GroupRow[]>`
    SELECT id, name, created, edited, joined FROM (
      SELECT groups.id, groups.name,
        (SELECT count(*)::int FROM notes
          WHERE notes.group_id = groups.id AND notes.deleted_at IS NULL
            AND notes.created_at >= ${from} AND notes.created_at < ${to}
            AND notes.created_by_user_id IS DISTINCT FROM ${userId}) AS created,
        (SELECT count(*)::int FROM notes
          WHERE notes.group_id = groups.id AND notes.deleted_at IS NULL
            AND notes.created_at < ${from}
            AND notes.updated_at >= ${from} AND notes.updated_at < ${to}
            AND notes.updated_by_user_id IS DISTINCT FROM ${userId}) AS edited,
        (SELECT count(*)::int FROM group_members AS joiner
          WHERE joiner.group_id = groups.id AND joiner.user_id <> ${userId}
            AND joiner.created_at >= ${from} AND joiner.created_at < ${to}) AS joined
      FROM group_members AS member
      JOIN groups ON groups.id = member.group_id AND groups.deleted_at IS NULL
      WHERE member.user_id = ${userId}
    ) AS counted
    WHERE created + edited + joined > 0
    ORDER BY created + edited + joined DESC, name, id
  `
}

/**
 * Mails the digest the job names to its owner's first proven address, in their saved language:
 * what others changed in their groups since the last digest, at most
 * {@link WEEKLY_DIGEST_MAX_GROUPS} groups and a count of the rest. Its window then starts at this
 * run, sent or not: a week in which nobody else changed anything sends nothing, and so do mail off,
 * no proven address and no secret to sign the unsubscribe link with. A digest turned off since it
 * was queued, or an account deleted or blocked, sends nothing and changes nothing. A failed send
 * throws, so the job is retried with the window unchanged.
 */
export function weeklyDigestMailJob(deps: WeeklyDigestMailDeps): JobHandler {
  const { sql, log, now = () => new Date() } = deps
  return async (event) => {
    const id = event.aggregateId
    const [digest] = await sql<DigestRow[]>`
      SELECT digest.user_id, digest.window_from, (
        SELECT auth_keys.proven_email FROM auth_keys
        WHERE auth_keys.user_id = digest.user_id AND auth_keys.proven_email IS NOT NULL
        ORDER BY auth_keys.id
        LIMIT 1
      ) AS email
      FROM weekly_digests AS digest
      JOIN users ON users.id = digest.user_id
        AND users.deleted_at IS NULL AND users.blocked_at IS NULL
      WHERE digest.id = ${id}
    `
    if (!digest) return
    const to = now()
    if (to <= digest.windowFrom) return
    const advance = (sent: boolean) =>
      sql`
        UPDATE weekly_digests SET window_from = ${to}, updated_at = ${to},
          last_sent_at = CASE WHEN ${sent} THEN ${to}::timestamptz ELSE last_sent_at END
        WHERE id = ${id} AND window_from = ${digest.windowFrom}
      `
    if (!deps.sender) return void await advance(false)
    if (!digest.email) {
      log(`warn: a weekly digest was not sent: its owner has no proven address`)
      return void await advance(false)
    }
    if (!deps.subscribers) {
      log(`warn: a weekly digest was not sent: SUBSCRIBERS_SECRET is not set to sign its link`)
      return void await advance(false)
    }
    const groups = await weeklyDigestGroups(sql, digest.userId, digest.windowFrom, to)
    if (groups.length === 0) return void await advance(false)
    const tokens = await createWeeklyDigestTokens(deps.subscribers)
    const result = await deps.sender.send(weeklyDigestMail(deps.brand, {
      to: digest.email,
      groups: groups.slice(0, WEEKLY_DIGEST_MAX_GROUPS),
      moreGroups: Math.max(0, groups.length - WEEKLY_DIGEST_MAX_GROUPS),
      unsubscribeLink: weeklyDigestUnsubscribeLink(
        deps.brand.webAppUrl,
        await tokens.sign(digest.userId),
      ),
      reader: await readMailReader(sql, digest.userId),
    }))
    if (!result.ok) {
      log(`error: a weekly digest was not sent and will be retried`)
      throw new Error(`weekly digest not sent`)
    }
    await advance(true)
  }
}
