/**
 * `deno task load:group --explain <tier>`: the plans Postgres picks for the reads and the write
 * that a large group stresses, run with `EXPLAIN (ANALYZE, BUFFERS)` against the tier's group, and
 * the size of every table and index they use. The output is Markdown for docs/capacity.md.
 *
 * Each query is a copy of the repository's, with the tier's values in place of the request's:
 * `libs/server/groups/group-changes.ts` (the changes pull), `postgres-note-repository.ts` (a list
 * page, the pull's rows, a write), `note-search.ts`, `postgres-activity-repository.ts`,
 * `postgres-group-repository.ts` (the members) and `postgres-notification-repository.ts`. The
 * write runs in a transaction that is rolled back, so the group is unchanged.
 *
 * @module
 */
import type postgres from "postgres"
import { SEARCHES, type TierPlan } from "./group-plan.ts"

/** How many changes one page of the pull holds (`CHANGES_PAGE_LIMIT`). */
const PAGE = 500
/** The SPA's list page and the notification page. */
const LIST_LIMIT = 100
/** What the search answers at most (`note.search`). */
const SEARCH_LIMIT = 20

/** Thrown inside the write's transaction to roll it back once its plan is read. */
class RollBack extends Error {}

/** The plans and sizes of `plan`'s group as Markdown; throws when the group is not built. */
export async function explainGroup(sql: postgres.Sql, plan: TierPlan): Promise<string> {
  const g = plan.groupId
  const [group] = await sql<{ current: number; ownerId: number }[]>`
    SELECT (next_change_sequence - 1)::int AS current, owner_user_id AS owner_id
    FROM groups WHERE id = ${g}
  `
  if (!group) {
    throw new Error(`The ${plan.tier} group is not built: deno task load:group ${plan.tier}`)
  }
  const out: string[] = [`## ${plan.name}`, ``]
  const explain = async (title: string, query: postgres.PendingQuery<postgres.Row[]>) => {
    const rows = await sql`EXPLAIN (ANALYZE, BUFFERS) ${query}`
    out.push(
      `### ${title}`,
      ``,
      "```",
      ...rows.map((row) => String(Object.values(row)[0])),
      "```",
      ``,
    )
  }
  const sequences = (after: number) =>
    sql`
      SELECT change_sequence AS sequence FROM notes
      WHERE group_id = ${g} AND deleted_at IS NULL AND change_sequence > ${after}
      UNION ALL
      SELECT change_sequence FROM tags WHERE group_id = ${g} AND change_sequence > ${after}
      ${
      after > 0
        ? sql`UNION ALL SELECT change_sequence FROM group_change_tombstones
          WHERE group_id = ${g} AND change_sequence > ${after}`
        : sql``
    }
    `
  for (
    const [label, after] of [[`first`, 0], [`middle`, Math.floor(group.current / 2)], [
      `last`,
      group.current - 1,
    ]] as const
  ) {
    await explain(
      `Changes pull, ${label} page boundary (after=${after})`,
      sql`SELECT changes.sequence FROM (${sequences(after)}) AS changes
        ORDER BY changes.sequence OFFSET ${PAGE} LIMIT 1`,
    )
  }
  await explain(
    `Changes pull, the notes of the first page`,
    sql`SELECT ${noteColumns(sql)} FROM notes
      WHERE group_id = ${g} AND deleted_at IS NULL
        AND change_sequence > 0 AND change_sequence <= ${PAGE}
      ORDER BY change_sequence, id`,
  )
  await explain(
    `Notes list, first page of ${LIST_LIMIT}`,
    sql`SELECT ${noteColumns(sql)} FROM notes
      WHERE group_id = ${g} AND deleted_at IS NULL
      ORDER BY updated_at DESC, id LIMIT ${LIST_LIMIT + 1}`,
  )
  for (const [label, text] of Object.entries(SEARCHES)) {
    const query = text.split(` `).map((word) => `${word}:*`).join(` & `)
    await explain(
      `Search, ${label} ("${text}"), as the owner`,
      sql`SELECT notes.id, ts_rank(notes.search_vector, search.query) AS rank,
          ts_headline('simple', notes.body, search.query) AS snippet
        FROM (
          SELECT notes.id, notes.body, notes.updated_at, notes.search_vector
          FROM to_tsquery('simple', ${query}) AS search(query)
          INNER JOIN group_members ON group_members.user_id = ${group.ownerId}
          INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
          INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
          INNER JOIN notes ON notes.group_id = group_members.group_id AND notes.deleted_at IS NULL
          WHERE notes.search_vector @@ search.query
          ORDER BY ts_rank(notes.search_vector, search.query) DESC, notes.updated_at DESC, notes.id
          LIMIT ${SEARCH_LIMIT}
        ) AS notes, to_tsquery('simple', ${query}) AS search(query)`,
    )
  }
  try {
    await sql.begin(async (tx: postgres.TransactionSql) => {
      for (
        const [title, query] of [
          [
            `Write: take the next change sequence`,
            tx`UPDATE groups SET next_change_sequence = next_change_sequence + 1
              WHERE id = ${g} RETURNING next_change_sequence - 1`,
          ],
          [
            `Write: insert a note (rolled back)`,
            tx`INSERT INTO notes (id, group_id, title, body, change_sequence, created_by_user_id,
                updated_by_user_id)
              VALUES (uuidv7(), ${g}, ${`Explain`}, ${`A note the explain rolls back.`},
                ${group.current + 1}, ${group.ownerId}, ${group.ownerId})`,
          ],
        ] as const
      ) {
        const rows = await tx`EXPLAIN (ANALYZE, BUFFERS) ${query}`
        out.push(
          `### ${title}`,
          ``,
          "```",
          ...rows.map((row) => String(Object.values(row)[0])),
          "```",
          ``,
        )
      }
      throw new RollBack()
    })
  } catch (error) {
    if (!(error instanceof RollBack)) throw error
  }
  await explain(
    `Activity, first page of ${LIST_LIMIT}`,
    sql`SELECT audit_events.id, audit_events.details, actor.first_name,
        (audit_events.entity_type = 'note' AND EXISTS (
          SELECT 1 FROM notes WHERE notes.id = audit_events.entity_id
            AND notes.group_id = audit_events.group_id AND notes.deleted_at IS NULL
        )) AS entity_exists
      FROM audit_events
      LEFT JOIN users AS actor ON actor.id = audit_events.actor_user_id
      WHERE audit_events.group_id = ${g}
      ORDER BY audit_events.id DESC LIMIT ${LIST_LIMIT + 1}`,
  )
  await explain(
    `Members, all of them with e-mail`,
    sql`SELECT group_members.user_id, btrim(concat_ws(' ', users.first_name, users.last_name)),
        (SELECT auth_keys.email FROM auth_keys
          WHERE auth_keys.user_id = group_members.user_id AND auth_keys.email IS NOT NULL
          ORDER BY auth_keys.id LIMIT 1) AS email
      FROM group_members
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE group_members.group_id = ${g}
      ORDER BY group_members.created_at, group_members.user_id`,
  )
  await explain(
    `Notifications of the owner, first page and unread count`,
    sql`SELECT id, kind, payload, link, read_at, created_at,
        (SELECT count(*) FROM notifications WHERE user_id = ${group.ownerId} AND read_at IS NULL)
      FROM notifications WHERE user_id = ${group.ownerId}
      ORDER BY id DESC LIMIT ${LIST_LIMIT + 1}`,
  )
  out.push(await sizes(sql))
  return out.join(`\n`)
}

/** The columns a note list answers, its tag ids included (`columnsOn`). */
function noteColumns(sql: postgres.Sql) {
  return sql`
    id, group_id, title, body,
    COALESCE((SELECT array_agg(note_tags.tag_id::text ORDER BY note_tags.tag_id)
      FROM note_tags WHERE note_tags.note_id = notes.id), '{}') AS tag_ids,
    version, change_sequence::text, created_by_user_id, updated_by_user_id, created_at, updated_at
  `
}

/** The tables a large group fills, with their heap, index and total sizes, as a Markdown table. */
async function sizes(sql: postgres.Sql): Promise<string> {
  const tables = [
    `notes`,
    `note_tags`,
    `tags`,
    `group_change_tombstones`,
    `group_members`,
    `audit_events`,
    `notifications`,
  ]
  const rows = await sql<
    { name: string; rows: string; heap: string; indexes: string; total: string }[]
  >`
    SELECT relname AS name, reltuples::bigint::text AS rows,
      pg_size_pretty(pg_relation_size(oid)) AS heap,
      pg_size_pretty(pg_indexes_size(oid)) AS indexes,
      pg_size_pretty(pg_total_relation_size(oid)) AS total
    FROM pg_class WHERE oid IN (SELECT to_regclass(name) FROM unnest(${tables}::text[]) AS name)
    ORDER BY pg_total_relation_size(oid) DESC
  `
  const indexes = await sql<{ table: string; name: string; size: string }[]>`
    SELECT tablename AS table, indexname AS name,
      pg_size_pretty(pg_relation_size(to_regclass(indexname))) AS size
    FROM pg_indexes
    WHERE tablename = ANY(${tables}::text[]) AND schemaname = current_schema()
    ORDER BY pg_relation_size(to_regclass(indexname)) DESC
  `
  return [
    `### Table sizes (every group in the database)`,
    ``,
    `| Table | Rows (estimate) | Heap | Indexes | Total |`,
    `| ----- | --------------- | ---- | ------- | ----- |`,
    ...rows.map((row) =>
      `| ${row.name} | ${row.rows} | ${row.heap} | ${row.indexes} | ${row.total} |`
    ),
    ``,
    `### Index sizes`,
    ``,
    `| Table | Index | Size |`,
    `| ----- | ----- | ---- |`,
    ...indexes.map((row) => `| ${row.table} | ${row.name} | ${row.size} |`),
    ``,
  ].join(`\n`)
}
