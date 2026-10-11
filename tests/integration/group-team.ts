/// <reference lib="deno.ns" />
import postgres from "postgres"
import { GroupRole } from "@domain/groups"
import {
  type GroupAccessLoss,
  listenForGroupAccessLoss,
} from "@server/groups/group-change-notify.ts"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * What the group integration tests share: a schema of their own built from schema.sql, users, a
 * team with one member per role, and a listener for access losses.
 */

export interface IdRow extends postgres.Row {
  id: number
}

export async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1, onnotice: () => {} })
  const schema = `lifecycle_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await sql.unsafe(await Deno.readTextFile("libs/server/db/schema.sql"))
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

export async function insertUser(sql: postgres.Sql): Promise<number> {
  const rows = await sql<IdRow[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `
  return rows[0].id
}

/**
 * An owner with a first group and a team group, plus one member per role in the team and a
 * stranger. The members have a group of their own, except "onlyHere", whose only group is the team.
 */
export async function team(sql: postgres.Sql) {
  const repository = new PostgresGroupRepository(sql)
  const owner = await insertUser(sql)
  await repository.ensureFirst({ id: uuidV7(), name: "Home" }, owner)
  const created = await repository.create({ id: uuidV7(), name: "Team" }, owner)
  const groupId = created.group.id
  const admin = await insertUser(sql)
  const editor = await insertUser(sql)
  const viewer = await insertUser(sql)
  const onlyHere = await insertUser(sql)
  const stranger = await insertUser(sql)
  for (const user of [admin, editor, viewer, stranger]) {
    await repository.ensureFirst({ id: uuidV7(), name: "Own" }, user)
  }
  await sql`
    INSERT INTO group_members (group_id, user_id, role, added_by_user_id) VALUES
      (${groupId}, ${admin}, ${GroupRole.ADMIN}, ${owner}),
      (${groupId}, ${editor}, ${GroupRole.EDITOR}, ${owner}),
      (${groupId}, ${viewer}, ${GroupRole.VIEWER}, ${owner}),
      (${groupId}, ${onlyHere}, ${GroupRole.EDITOR}, ${owner})
  `
  return { repository, groupId, owner, admin, editor, viewer, onlyHere, stranger }
}

/** The group's authorization revision, as a decimal string. */
export async function revision(sql: postgres.Sql, groupId: string): Promise<string> {
  return (await sql<{ revision: string }[]>`
    SELECT authorization_revision::text AS revision FROM groups WHERE id = ${groupId}
  `)[0].revision
}

/**
 * Listens for the access losses of one group. Each is stored with whether the group read as
 * deleted on another connection the moment it arrived, which says if it came after the commit.
 */
export async function listenForLosses(sql: postgres.Sql, groupId: string) {
  const losses: { loss: GroupAccessLoss; deletedWhenHeard: boolean }[] = []
  const reads: Promise<void>[] = []
  const stop = await listenForGroupAccessLoss(sql, (loss) => {
    if (loss.groupId !== groupId) return
    reads.push((async () => {
      const row = (await sql<{ deleted: boolean }[]>`
        SELECT deleted_at IS NOT NULL AS deleted FROM groups WHERE id = ${groupId}
      `)[0]
      losses.push({ loss, deletedWhenHeard: row.deleted })
    })())
  })
  /** Waits a moment for stragglers, then returns every loss heard, in arrival order. */
  async function heard(count: number) {
    const deadline = Date.now() + 5_000
    while (losses.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    await Promise.all(reads)
    return losses
  }
  return { heard, stop }
}

/**
 * Runs two moves of opposite direction while another connection holds the lock of `heldGroupId`,
 * the group the first move starts from. It starts the first move and waits until it waits on that
 * lock, starts the second and waits the same way, then lets go. The first is then ahead in the
 * queue, so a pair that locks `from` before `to` deadlocks on release (the first takes the held
 * group and wants the second's group, which the second holds and wants the first's), while a pair
 * that locks in id order finishes. Resolves to how each run settled, in `runs` order.
 */
export async function runBlockedOnLock<T>(
  sql: postgres.Sql,
  heldGroupId: string,
  runs: readonly [() => Promise<T>, () => Promise<T>],
): Promise<PromiseSettledResult<T>[]> {
  const holder = await sql.reserve()
  const started: Promise<PromiseSettledResult<T>>[] = []
  try {
    await holder`BEGIN`
    await holder`SELECT id FROM groups WHERE id = ${heldGroupId} FOR UPDATE`
    for (const [index, run] of runs.entries()) {
      started.push(
        run().then(
          (value): PromiseSettledResult<T> => ({ status: "fulfilled", value }),
          (reason): PromiseSettledResult<T> => ({ status: "rejected", reason }),
        ),
      )
      const deadline = Date.now() + 10_000
      while (true) {
        const [{ waiting }] = await sql<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `
        if (waiting > index) break
        if (Date.now() > deadline) throw new Error(`move ${index + 1} never waited on the lock`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
  } finally {
    await holder`COMMIT`.catch(() => {})
    holder.release()
  }
  return await Promise.all(started)
}
