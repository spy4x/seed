/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { buildGroup, removeGroup } from "../load/group-db.ts"
import { finishedDescription, planTier, type TierPlan } from "../load/group-plan.ts"

/**
 * The large-group generator of `deno task load:group` (tests/load/group-db.ts) against a real
 * Postgres with every migration applied, with a plan small enough to run in a second: a rerun
 * leaves one group, a half-built group is built again, and the removal deletes what the generator
 * made and nothing else.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = `libs/server/db/migrations`
const PLAN: TierPlan = {
  ...planTier(`S`),
  notes: 120,
  tags: 7,
  members: 6,
  activity: 50,
  notifications: 30,
  batch: 50,
  // A day, so a note's edit could pass the next note and every note is recent enough to delete.
  spanDays: 1,
}
const quiet = () => {}

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: quiet })
  const schema = `load_group_test_${uuidV7().replaceAll(`-`, ``)}`
  const sql = postgres({
    ...settings,
    max: 2,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: quiet,
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name).sort()
    for (const name of names) {
      await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
    }
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** A person who signed up: an identity, a profile, a password key and the address it proved. */
async function signedUp(sql: postgres.Sql, email: string): Promise<number> {
  const [{ id }] = await sql<{ id: number }[]>`INSERT INTO auth_users DEFAULT VALUES RETURNING id`
  await sql`INSERT INTO users (id, first_name) VALUES (${id}, ${`Real`})`
  await sql`INSERT INTO auth_email_owners (email, user_id) VALUES (${email}, ${id})`
  await sql`
    INSERT INTO auth_keys (user_id, method, subject, email, proven_at)
    VALUES (${id}, 'password', ${email}, ${email}, now())
  `
  return id
}

interface Counts extends postgres.Row {
  groups: number
  people: number
  notes: number
  deleted: number
  tombstones: number
  tags: number
  members: number
  activity: number
  notifications: number
  maxSequence: number
  nextSequence: number
}

async function count(sql: postgres.Sql): Promise<Counts> {
  const [row] = await sql<Counts[]>`
    SELECT
      (SELECT count(*)::int FROM groups) AS groups,
      (SELECT count(*)::int FROM users) AS people,
      (SELECT count(*)::int FROM notes) AS notes,
      (SELECT count(*)::int FROM notes WHERE deleted_at IS NOT NULL) AS deleted,
      (SELECT count(*)::int FROM group_change_tombstones) AS tombstones,
      (SELECT count(*)::int FROM tags) AS tags,
      (SELECT count(*)::int FROM group_members) AS members,
      (SELECT count(*)::int FROM audit_events) AS activity,
      (SELECT count(*)::int FROM notifications) AS notifications,
      (SELECT max(change_sequence)::int FROM notes) AS max_sequence,
      (SELECT max(next_change_sequence)::int FROM groups) AS next_sequence
  `
  return row
}

Deno.test(`building a tier twice leaves one group with the plan's rows and change sequences`, async () => {
  await withSchema(async (sql) => {
    const first = await buildGroup(sql, PLAN, [], quiet)
    const second = await buildGroup(sql, PLAN, [], quiet)
    expect([first.built, second.built]).toEqual([true, false])
    const counts = await count(sql)
    expect(counts).toMatchObject({
      groups: 1,
      people: PLAN.members,
      notes: PLAN.notes,
      tags: PLAN.tags,
      members: PLAN.members,
      activity: PLAN.activity,
      notifications: PLAN.notifications,
      maxSequence: PLAN.tags + PLAN.notes,
      nextSequence: PLAN.tags + PLAN.notes + 1,
    })
    expect(counts.deleted).toBeGreaterThan(0)
    expect(counts.tombstones).toBe(counts.deleted)
    const [ids] = await sql<{ notes: number; v7: number }[]>`
      SELECT count(*)::int AS notes, count(*) FILTER (WHERE uuid_extract_version(id) = 7)::int AS v7
      FROM notes
    `
    expect(ids.v7).toBe(ids.notes)
    // The last change of each note comes in the order of its sequence, as the app writes them.
    const [{ outOfOrder }] = await sql<{ outOfOrder: number }[]>`
      SELECT count(*)::int AS out_of_order FROM (
        SELECT updated_at < lag(updated_at) OVER (ORDER BY change_sequence) AS behind FROM notes
      ) AS ordered WHERE behind
    `
    expect(outOfOrder).toBe(0)
  })
})

Deno.test(`a group a stopped run left half built is built again from scratch`, async () => {
  await withSchema(async (sql) => {
    await buildGroup(sql, PLAN, [], quiet)
    await sql`DELETE FROM notes WHERE change_sequence > ${PLAN.tags + 10}`
    await sql`UPDATE groups SET description = 'Being built by deno task load:group'`
    const result = await buildGroup(sql, PLAN, [], quiet)
    expect(result.built).toBe(true)
    expect(await count(sql)).toMatchObject({ groups: 1, people: PLAN.members, notes: PLAN.notes })
    const [{ description }] = await sql<{ description: string }[]>`SELECT description FROM groups`
    expect(description).toBe(finishedDescription(PLAN))
  })
})

Deno.test(`a member added by e-mail can read the group and gets the plan's notifications`, async () => {
  await withSchema(async (sql) => {
    const real = await signedUp(sql, `real@example.com`)
    await buildGroup(sql, PLAN, [`real@example.com`], quiet)
    await buildGroup(sql, PLAN, [`real@example.com`], quiet)
    const [member] = await sql<{ role: number }[]>`
      SELECT role FROM group_members WHERE user_id = ${real} AND group_id = ${PLAN.groupId}
    `
    expect(member.role).toBe(2)
    const [{ inbox }] = await sql<{ inbox: number }[]>`
      SELECT count(*)::int AS inbox FROM notifications WHERE user_id = ${real}
    `
    expect(inbox).toBe(PLAN.notifications)
    await expect(buildGroup(sql, PLAN, [`nobody@example.com`], quiet)).rejects.toThrow(
      `nobody@example.com`,
    )
  })
})

Deno.test(`removing a tier deletes what the generator made and nothing else`, async () => {
  await withSchema(async (sql) => {
    const real = await signedUp(sql, `real@example.com`)
    const bystander = await signedUp(sql, `bystander@example.com`)
    const other = uuidV7()
    await sql`
      INSERT INTO groups (id, name, owner_user_id) VALUES (${other}, ${`Bystander's`}, ${bystander})
    `
    await sql`INSERT INTO group_members (group_id, user_id, role) VALUES (${other}, ${bystander}, 4)`
    await sql`
      INSERT INTO notes (id, group_id, title, change_sequence) VALUES (${uuidV7()}, ${other}, 'Kept', 1)
    `
    await sql`
      INSERT INTO audit_events (event_kind, actor_user_id, group_id) VALUES ('note.created', ${bystander}, ${other})
    `
    await sql`
      INSERT INTO notifications (user_id, kind, payload, link)
      VALUES (${real}, 'group.role_changed', '{}', '/groups')
    `
    await buildGroup(sql, PLAN, [`real@example.com`], quiet)

    const removed = await removeGroup(sql, PLAN)
    expect(removed).toEqual({
      groups: 1,
      people: PLAN.members,
      notifications: PLAN.notifications * 2,
    })
    expect(await count(sql)).toMatchObject({
      groups: 1,
      people: 2,
      notes: 1,
      tags: 0,
      members: 1,
      activity: 1,
      notifications: 1,
    })
    expect(await removeGroup(sql, PLAN)).toEqual({ groups: 0, people: 0, notifications: 0 })
  })
})
