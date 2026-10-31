import type postgres from "postgres"
import { type ChangesAnswer, planChangesPage, type Tombstone } from "@spy4x/realtime/changes"

/**
 * One aggregate's part in the changes pull of a group (`docs/aggregates.md`, "Taking part in the
 * changes pull"). Both functions run in the read's repeatable-read transaction, so they see the
 * same snapshot as the group's sequence.
 */
export interface ChangesAggregate {
  /** Its name in the answer's `upserts` and tombstones, such as `notes`. Never rename it. */
  kind: string
  /**
   * A query fragment that selects one column, `sequence` (a `bigint`), with the `change_sequence`
   * of every live row of the group above `after`. The reader unions the fragments of every
   * aggregate to find where a page ends, so it holds no `ORDER BY` or `LIMIT`.
   */
  sequences(sql: postgres.TransactionSql, groupId: string, after: number): postgres.PendingQuery<
    postgres.Row[]
  >
  /** The live rows of the group with `after < change_sequence <= through`, as the wire sends them. */
  rows(
    sql: postgres.TransactionSql,
    groupId: string,
    after: number,
    through: number,
  ): Promise<unknown[]>
}

/** How many changes one page holds before it ends; a page never splits one sequence. */
export const CHANGES_PAGE_LIMIT = 500

/** How long a tombstone is kept. A device that was away longer reads its groups in full. */
export const CHANGE_TOMBSTONE_DAYS = 90

/**
 * Writes that rows of `kind` left the group at `sequence`: deleted, or moved to another group. Runs
 * in the write's transaction, after the write recorded its change (`recordGroupChange`). A row that
 * left before keeps one tombstone, at the newer sequence.
 */
export async function recordTombstones(
  sql: postgres.TransactionSql,
  groupId: string,
  kind: string,
  ids: readonly string[],
  sequence: string,
): Promise<void> {
  if (ids.length === 0) return
  await sql`
    INSERT INTO group_change_tombstones ${
    sql(ids.map((id) => ({ group_id: groupId, kind, entity_id: id, change_sequence: sequence })))
  }
    ON CONFLICT (group_id, kind, entity_id) DO UPDATE
      SET change_sequence = EXCLUDED.change_sequence, created_at = CURRENT_TIMESTAMP
  `
}

/**
 * Makes every cursor of the group below `sequence` too old, so a device that held one reads the
 * group in full: for a write that takes many rows out at once ("move all data"), where one
 * tombstone per row would be a log as large as the group.
 */
export async function forgetChangesBefore(
  sql: postgres.TransactionSql,
  groupId: string,
  sequence: string,
): Promise<void> {
  await sql`
    UPDATE groups SET changes_oldest_sequence = GREATEST(changes_oldest_sequence, ${sequence}::bigint)
    WHERE id = ${groupId}
  `
}

/**
 * Reads one page of the changes of a group after `after`: the live rows of every aggregate whose
 * sequence is in the page's window and the tombstones in it, all from one snapshot. `null` when the
 * group is missing or deleted. The caller checks that the reader is a member.
 *
 * `after = 0` answers the live rows only: a device with no copy needs no tombstones. A tombstone
 * whose row is live again in the group on the same page (a restored note, a note moved back) is
 * left out, because the device applies upserts before tombstones and would delete the row it just
 * put. The row's own sequence is always newer than its tombstone's, so when the row is on a later
 * page the tombstone comes first and the row puts it back.
 */
export async function readGroupChanges(
  sql: postgres.Sql,
  aggregates: readonly ChangesAggregate[],
  groupId: string,
  after: number,
  limit = CHANGES_PAGE_LIMIT,
): Promise<ChangesAnswer | null> {
  return await sql.begin(
    "isolation level repeatable read read only",
    async (transaction: postgres.TransactionSql) => {
      const group = (
        await transaction<{ current: string; oldest: string }[]>`
          SELECT (next_change_sequence - 1)::text AS current, changes_oldest_sequence::text AS oldest
          FROM groups WHERE id = ${groupId} AND deleted_at IS NULL
        `
      )[0]
      if (!group) return null
      const current = Number(group.current)
      const parts = aggregates.map((aggregate) => aggregate.sequences(transaction, groupId, after))
      if (after > 0) {
        parts.push(transaction`
          SELECT change_sequence AS sequence FROM group_change_tombstones
          WHERE group_id = ${groupId} AND change_sequence > ${after}
        `)
      }
      const union = parts.reduce((all, part) => transaction`${all} UNION ALL ${part}`)
      const boundary = (
        await transaction<{ boundary: string }[]>`
          SELECT changes.sequence::text AS boundary FROM (${union}) AS changes
          ORDER BY changes.sequence OFFSET ${limit} LIMIT 1
        `
      )[0]
      const plan = planChangesPage({
        after,
        current,
        oldest: Number(group.oldest),
        boundary: boundary ? Number(boundary.boundary) : null,
      })
      if (plan.status === "too-old") return { status: "too-old", current }
      const upserts: Record<string, unknown[]> = {}
      const live = new Set<string>()
      for (const aggregate of aggregates) {
        const rows = await aggregate.rows(transaction, groupId, after, plan.through)
        upserts[aggregate.kind] = rows
        for (const row of rows) live.add(`${aggregate.kind}:${(row as { id: string }).id}`)
      }
      const tombstones = after === 0 ? [] : (
        await transaction<Tombstone[]>`
          SELECT kind, entity_id::text AS id FROM group_change_tombstones
          WHERE group_id = ${groupId}
            AND change_sequence > ${after}
            AND change_sequence <= ${plan.through}
          ORDER BY change_sequence, kind, entity_id
        `
      ).filter((gone) => !live.has(`${gone.kind}:${gone.id}`))
      return {
        status: "changes",
        after,
        through: plan.through,
        current,
        more: plan.more,
        upserts,
        tombstones: tombstones.map(({ kind, id }) => ({ kind, id })),
      }
    },
  )
}

/**
 * Forgets the tombstones written more than {@link CHANGE_TOMBSTONE_DAYS} days before `now` and
 * raises each affected group's oldest answerable cursor to the newest sequence it forgot, so a
 * device behind it reads the group in full instead of keeping a row that is gone. Answers how many
 * tombstones it forgot.
 */
export async function purgeChangeTombstones(
  sql: postgres.Sql,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - CHANGE_TOMBSTONE_DAYS * 24 * 60 * 60 * 1000)
  return await sql.begin(async (transaction: postgres.TransactionSql) => {
    const [{ count }] = await transaction<{ count: number }[]>`
      WITH forgotten AS (
        DELETE FROM group_change_tombstones WHERE created_at < ${cutoff}
        RETURNING group_id, change_sequence
      ),
      raised AS (
        UPDATE groups
        SET changes_oldest_sequence = GREATEST(groups.changes_oldest_sequence, cut.sequence)
        FROM (
          SELECT group_id, max(change_sequence) AS sequence FROM forgotten GROUP BY group_id
        ) AS cut
        WHERE groups.id = cut.group_id
      )
      SELECT count(*)::int AS count FROM forgotten
    `
    return count
  })
}
