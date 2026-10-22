/**
 * The operator dashboard's numbers (#424): counts over `users`, `groups`, `notes`, `auth_audits`
 * and `audit_events`. Counts only: no name, address or note text leaves here. Who may read them is
 * the API's business (`apps/api/routes/admin/dashboard.ts`).
 *
 * @module
 */

import type postgres from "postgres"
import { ONE_DAY_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { recentIsoDates } from "@spy4x/time/date"
import { ADMIN_STATS_DAYS, type AdminDailyCount, type AdminStats } from "@domain/identity"
import { guestStats } from "./guests.ts"

/** The {@link ADMIN_STATS_DAYS} UTC days that end on `now`'s day, oldest first. */
export function statsDays(now: Date): string[] {
  return recentIsoDates(ADMIN_STATS_DAYS, now)
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
 * Above how many rows (the planner's figure) a table's live rows are estimated instead of counted.
 * A count reads every row of the table on every load of the dashboard; an estimate reads one row of
 * the catalog. 100,000 rows count in well under a second.
 */
export const ADMIN_STATS_EXACT_BELOW = 100_000

/** The tables whose live rows the dashboard shows, by the field of {@link AdminStats} they fill. */
const LIVE_TABLES = { people: `users`, groups: `groups`, notes: `notes` } as const

type LiveCounts = Record<keyof typeof LIVE_TABLES, number>

/**
 * The live (not deleted) rows of `users`, `groups` and `notes`. A table the planner puts at
 * `exactBelow` rows or more is estimated: its row figure times the share of rows whose `deleted_at`
 * is empty, both from the last `ANALYZE`. A table never analyzed (figure -1) or smaller is counted.
 * `approximate` says whether any figure is an estimate.
 */
async function liveCounts(
  sql: postgres.Sql,
  exactBelow: number,
): Promise<{ counts: LiveCounts; approximate: boolean }> {
  const names = Object.values(LIVE_TABLES)
  // `::regclass` finds each table on the connection's search_path, as the counts below do.
  // `null_frac` of `deleted_at` is the share of rows with no deletion time: the live share.
  const estimates = await sql<{ name: string; rows: number; liveShare: number | null }[]>`
    SELECT c.relname AS name, c.reltuples::float8 AS rows,
      (SELECT s.null_frac FROM pg_stats s
        WHERE s.schemaname = n.nspname AND s.tablename = c.relname AND s.attname = 'deleted_at'
      )::float8 AS live_share
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = ANY (${names}::regclass[])
  `
  const byName = new Map(estimates.map((row) => [row.name, row]))
  const counts = {} as LiveCounts
  let approximate = false
  for (const [key, table] of Object.entries(LIVE_TABLES) as [keyof LiveCounts, string][]) {
    const estimate = byName.get(table)
    if (estimate && estimate.rows >= exactBelow && estimate.liveShare !== null) {
      counts[key] = Math.round(estimate.rows * estimate.liveShare)
      approximate = true
      continue
    }
    const [row] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM ${sql(table)} WHERE deleted_at IS NULL
    `
    counts[key] = row.count
  }
  return { counts, approximate }
}

/**
 * Reads the dashboard's numbers as of `now`. People, groups and notes come from
 * {@link liveCounts}: counted while small, estimated once a table reaches `exactBelow` rows, so a
 * load never reads a large table whole. Blocked people and sign-ups read their own indexes
 * (`idx_users_blocked_at`, `idx_users_created_at`). The daily series read the last
 * {@link ADMIN_STATS_DAYS} days from the indexed `created_at` of the two audit tables and from
 * `users.created_at` and `users.last_seen_at`.
 */
export async function readAdminStats(
  sql: postgres.Sql,
  now: Date,
  { exactBelow = ADMIN_STATS_EXACT_BELOW }: { exactBelow?: number } = {},
): Promise<AdminStats> {
  const days = statsDays(now)
  const from = new Date(`${days[0]}T00:00:00.000Z`)
  const today = days[days.length - 1]
  const yesterday = days[days.length - 2]
  const weekAgo = new Date(now.getTime() - 7 * ONE_DAY_IN_MILLISECONDS)
  const twoWeeksAgo = new Date(now.getTime() - 14 * ONE_DAY_IN_MILLISECONDS)

  const live = await liveCounts(sql, exactBelow)
  const guests = await guestStats(sql, from)
  const [counts] = await sql<{ blocked: number; newThisWeek: number; newWeekBefore: number }[]>`
    SELECT
      (SELECT COUNT(*) FROM users WHERE blocked_at IS NOT NULL AND deleted_at IS NULL)::int
        AS blocked,
      (SELECT COUNT(*) FROM users WHERE created_at >= ${weekAgo})::int AS new_this_week,
      (SELECT COUNT(*) FROM users WHERE created_at >= ${twoWeeksAgo} AND created_at < ${weekAgo}
      )::int AS new_week_before
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
    approximate: live.approximate,
    people: live.counts.people,
    blocked: counts.blocked,
    newThisWeek: { current: counts.newThisWeek, previous: counts.newWeekBefore },
    activeToday: { current: activeOn(today), previous: activeOn(yesterday) },
    activeThisWeek: { current: week.get("this") ?? 0, previous: week.get("before") ?? 0 },
    groups: live.counts.groups,
    notes: live.counts.notes,
    signUpsPerDay: fillDays(days, of("sign-ups")),
    activePerDay,
    guests,
  }
}
