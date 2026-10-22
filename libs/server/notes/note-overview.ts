import type postgres from "postgres"
import type { DateRange } from "@spy4x/time/date"
import type { NoteOverviewRepository } from "@domain/notes"

/**
 * The note widgets' numbers in Postgres. Each statement reads one group's notes once, through the
 * `group_id` indexes; the days are cut at midnight in the person's zone. A purged note (deleted
 * long enough ago for `purgeDeletedNotes`) is gone from the past days too: the table keeps no
 * other trace of it.
 */
export class PostgresNoteOverview implements NoteOverviewRepository {
  constructor(private readonly sql: postgres.Sql | postgres.TransactionSql) {}

  /**
   * Every note adds one on the day it was created and takes one away on the day it was deleted;
   * a day's total is the sum of every change up to that day.
   */
  async dailyTotals(groupId: string, range: DateRange, timeZone: string): Promise<number[]> {
    const rows = await this.sql<{ total: number }[]>`
      WITH changes AS (
        SELECT (created_at AT TIME ZONE ${timeZone})::date AS day, 1 AS delta
          FROM notes WHERE group_id = ${groupId}
        UNION ALL
        SELECT (deleted_at AT TIME ZONE ${timeZone})::date, -1
          FROM notes WHERE group_id = ${groupId} AND deleted_at IS NOT NULL
      ),
      days AS (
        SELECT day::date AS day
          FROM generate_series(${range.from}::date, ${range.to}::date, interval '1 day') AS day
      ),
      per_day AS (
        SELECT day, sum(delta) AS delta FROM changes WHERE day >= ${range.from}::date GROUP BY day
      )
      SELECT (
        (SELECT coalesce(sum(delta), 0) FROM changes WHERE day < ${range.from}::date)
        + sum(coalesce(per_day.delta, 0)) OVER (ORDER BY days.day)
      )::int AS total
      FROM days LEFT JOIN per_day USING (day)
      ORDER BY days.day
    `
    return rows.map((row) => row.total)
  }

  async added(groupId: string, range: DateRange, timeZone: string): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notes
      WHERE group_id = ${groupId}
        AND (created_at AT TIME ZONE ${timeZone})::date BETWEEN ${range.from}::date
          AND ${range.to}::date
    `
    return row.count
  }

  async startDay(groupId: string, timeZone: string): Promise<string | null> {
    const [row] = await this.sql<{ day: string }[]>`
      SELECT to_char((created_at AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS day
      FROM groups WHERE id = ${groupId}
    `
    return row?.day ?? null
  }
}
