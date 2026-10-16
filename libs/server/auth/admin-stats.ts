/**
 * The operator dashboard's numbers (#424): counts over `users`, `groups`, `notes`, `auth_audits`
 * and `audit_events`, in two queries. Counts only: no name, address or note text leaves here. Who
 * may read them is the API's business (`apps/api/routes/admin/dashboard.ts`).
 *
 * @module
 */

import type postgres from "postgres"
import { ADMIN_STATS_DAYS, type AdminDailyCount, type AdminStats } from "@domain/identity"

const DAY_MS = 24 * 60 * 60 * 1000

/** `date` as its UTC day, `YYYY-MM-DD`. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** The {@link ADMIN_STATS_DAYS} UTC days that end on `now`'s day, oldest first. */
export function statsDays(now: Date): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from(
    { length: ADMIN_STATS_DAYS },
    (_, index) => utcDay(new Date(today - (ADMIN_STATS_DAYS - 1 - index) * DAY_MS)),
  )
}

/** Fills every day of `days` from `rows`, with 0 for a day no row names. */
export function fillDays(
  days: readonly string[],
  rows: readonly { day: string; count: number }[],
): AdminDailyCount[] {
  const counts = new Map(rows.map((row) => [row.day, row.count]))
  return days.map((day) => ({ day, count: counts.get(day) ?? 0 }))
}

/**
 * Reads the dashboard's numbers as of `now`. The first query reads the counts in one pass over
 * `users` plus two counts; the second reads the two daily series over the last
 * {@link ADMIN_STATS_DAYS} days. Activity is read from the indexed `created_at` of the two audit
 * tables and from `users.last_seen_at`, each bounded to that window.
 */
export async function readAdminStats(sql: postgres.Sql, now: Date): Promise<AdminStats> {
  const days = statsDays(now)
  const from = new Date(`${days[0]}T00:00:00.000Z`)
  const today = days[days.length - 1]
  const yesterday = days[days.length - 2]
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS)
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS)

  const [counts] = await sql<{
    people: number
    blocked: number
    newThisWeek: number
    newWeekBefore: number
    groups: number
    notes: number
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE u.deleted_at IS NULL)::int AS people,
      COUNT(*) FILTER (WHERE u.deleted_at IS NULL AND u.blocked_at IS NOT NULL)::int AS blocked,
      COUNT(*) FILTER (WHERE u.created_at >= ${weekAgo})::int AS new_this_week,
      COUNT(*) FILTER (
        WHERE u.created_at >= ${twoWeeksAgo} AND u.created_at < ${weekAgo}
      )::int AS new_week_before,
      (SELECT COUNT(*) FROM groups g WHERE g.deleted_at IS NULL)::int AS groups,
      (SELECT COUNT(*) FROM notes n WHERE n.deleted_at IS NULL)::int AS notes
    FROM users u
  `

  const rows = await sql<
    { series: "sign-ups" | "active"; day: string; count: number }[]
  >`
    WITH activity AS (
      SELECT a.user_id, a.created_at FROM auth_audits a WHERE a.created_at >= ${from}
      UNION ALL
      SELECT e.actor_user_id, e.created_at FROM audit_events e
      WHERE e.created_at >= ${from} AND e.actor_user_id IS NOT NULL
      UNION ALL
      SELECT u.id, u.last_seen_at FROM users u WHERE u.last_seen_at >= ${from}
    )
    SELECT 'sign-ups' AS series, to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      COUNT(*)::int AS count
    FROM users u WHERE u.created_at >= ${from}
    GROUP BY 2
    UNION ALL
    SELECT 'active', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
      COUNT(DISTINCT user_id)::int
    FROM activity
    GROUP BY 2
    UNION ALL
    SELECT 'active-week', 'this', COUNT(DISTINCT user_id)::int
    FROM activity WHERE created_at >= ${weekAgo}
    UNION ALL
    SELECT 'active-week', 'before', COUNT(DISTINCT user_id)::int
    FROM activity WHERE created_at >= ${twoWeeksAgo} AND created_at < ${weekAgo}
  `
  const of = (series: string) => rows.filter((row) => row.series === series)
  const activePerDay = fillDays(days, of("active"))
  const week = new Map(of("active-week").map((row) => [row.day, row.count]))
  const activeOn = (day: string) => activePerDay.find((row) => row.day === day)?.count ?? 0

  return {
    generatedAt: now.toISOString(),
    people: counts.people,
    blocked: counts.blocked,
    newThisWeek: { current: counts.newThisWeek, previous: counts.newWeekBefore },
    activeToday: { current: activeOn(today), previous: activeOn(yesterday) },
    activeThisWeek: { current: week.get("this") ?? 0, previous: week.get("before") ?? 0 },
    groups: counts.groups,
    notes: counts.notes,
    signUpsPerDay: fillDays(days, of("sign-ups")),
    activePerDay,
  }
}
