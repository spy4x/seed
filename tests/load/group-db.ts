/**
 * Writes, completes and removes the large load-test group of one tier straight in Postgres
 * (spy4x/seed#440). `group.ts` is the command; `group-plan.ts` says what each tier holds.
 *
 * The rows look like the ones the app writes, so the changes pull (`docs/offline.md`) and the
 * lists read them as real ones: every note and tag has its own change sequence, the group's next
 * sequence comes after them, a deleted note has its tombstone, and ids are UUID version 7, made by
 * Postgres' `uuidv7()` with the row's own time so they sort by age (docs/ids.md). Nothing is
 * announced: no outbox row is written, so the worker pushes nothing to open pages.
 *
 * Every value reaches Postgres as a parameter; the SQL text is fixed.
 *
 * @module
 */
import type postgres from "postgres"
import {
  batches,
  finishedDescription,
  memberName,
  MemberRole,
  memberRoles,
  RARE_WORD,
  TAG_COLOURS,
  tagNames,
  type TierPlan,
  WORDS,
} from "./group-plan.ts"

/** Where progress lines go; the tests pass a silent one. */
export type Log = (line: string) => void

/** The longest title an activity row keeps, as the note repository cuts it. */
const AUDIT_TITLE_MAX = 100

/**
 * What a run found and did: `built` is false when the tier's group was already complete, and the
 * run only added the `--member` accounts.
 */
export interface BuildResult {
  groupId: string
  name: string
  built: boolean
  members: Array<{ email: string; userId: number }>
}

/**
 * Builds the group of `plan` unless a complete one exists, then makes each address in `emails` an
 * editor of it with an inbox of `plan.notifications`. Idempotent: a second run with the same plan
 * leaves one group with the same rows. A group a stopped run left half built is removed and built
 * again. Throws, before writing anything, when an address has no account.
 */
export async function buildGroup(
  sql: postgres.Sql,
  plan: TierPlan,
  emails: readonly string[],
  log: Log,
): Promise<BuildResult> {
  const accounts = await findAccounts(sql, emails)
  const [existing] = await sql<{ description: string }[]>`
    SELECT description FROM groups WHERE id = ${plan.groupId}
  `
  const built = existing?.description !== finishedDescription(plan)
  if (built) {
    if (existing) {
      log(`Removing the unfinished ${plan.tier} group a stopped run left`)
      await removeGroup(sql, plan)
    }
    await writeGroup(sql, plan, log)
  } else {
    log(`The ${plan.tier} group is complete already; adding members only`)
  }
  for (const account of accounts) {
    await addMember(sql, plan, account.userId)
    log(`${account.email} is an editor, with ${plan.notifications} notifications`)
  }
  return { groupId: plan.groupId, name: plan.name, built, members: accounts }
}

/** The account of each address, by the address it proved; throws naming the ones with none. */
async function findAccounts(
  sql: postgres.Sql,
  emails: readonly string[],
): Promise<Array<{ email: string; userId: number }>> {
  if (emails.length === 0) return []
  const rows = await sql<{ email: string; userId: number }[]>`
    SELECT email, user_id FROM auth_email_owners WHERE email IN ${sql(emails as string[])}
  `
  const missing = emails.filter((email) => !rows.some((row) => row.email === email))
  if (missing.length > 0) {
    throw new Error(`No account has proven ${missing.join(`, `)}; sign up first`)
  }
  return emails.map((email) => rows.find((row) => row.email === email)!)
}

/** Writes every row of `plan`, marking the group finished last. */
async function writeGroup(sql: postgres.Sql, plan: TierPlan, log: Log): Promise<void> {
  const started = performance.now()
  const now = new Date()
  const start = new Date(now.getTime() - plan.spanDays * 24 * 60 * 60 * 1000)
  const ownerId = await writePeople(sql, plan, start)
  log(`${plan.members} members`)
  const writers = (await sql<{ userId: number }[]>`
    SELECT user_id FROM group_members WHERE group_id = ${plan.groupId} AND role >= ${MemberRole.Editor}
    ORDER BY user_id
  `).map((row) => row.userId)
  await writeTags(sql, plan, ownerId, start)
  log(`${plan.tags} tags`)
  const stepMs = (now.getTime() - 60_000 - start.getTime()) / plan.notes
  for (const { from, to } of batches(plan.notes, plan.batch)) {
    await writeNotes(sql, plan, { from, to, start, now, stepMs, writers })
    const seconds = (performance.now() - started) / 1000
    log(
      `${to.toLocaleString(`en-US`)} of ${plan.notes.toLocaleString(`en-US`)} notes, ${
        seconds.toFixed(0)
      } s`,
    )
  }
  await writeActivity(sql, plan)
  log(`${plan.activity} activity rows`)
  await writeNotifications(sql, plan, ownerId, now)
  log(`${plan.notifications} notifications`)
  await sql`
    UPDATE groups SET description = ${finishedDescription(plan)} WHERE id = ${plan.groupId}
  `
  await sql`ANALYZE notes, note_tags, tags, group_members, audit_events, notifications`
  log(`Built in ${((performance.now() - started) / 1000).toFixed(0)} s`)
}

/**
 * The generated people, the group and its memberships, in one transaction: a person exists only
 * as a member of the group, which is how {@link removeGroup} finds them. They get no sign-in key,
 * so nobody can sign in as one. Answers the owner's id.
 */
async function writePeople(sql: postgres.Sql, plan: TierPlan, start: Date): Promise<number> {
  return await sql.begin(async (tx: postgres.TransactionSql) => {
    const ids = (await tx<{ id: number }[]>`
      INSERT INTO auth_users (created_at)
      SELECT ${start} FROM generate_series(1, ${plan.members}::int)
      RETURNING id
    `).map((row) => row.id).sort((a, b) => a - b)
    await tx`
      INSERT INTO users ${
      tx(ids.map((id, i) => ({
        id,
        firstName: memberName(i).firstName,
        lastName: memberName(i).lastName,
        createdAt: start,
        updatedAt: start,
      })))
    }
    `
    const ownerId = ids[0]
    await tx`
      INSERT INTO groups (id, name, owner_user_id, created_by_user_id, next_change_sequence, created_at,
        updated_at, description)
      VALUES (${plan.groupId}, ${plan.name}, ${ownerId}, ${ownerId}, ${plan.tags + plan.notes + 1},
        ${start}, ${start}, ${`Being built by deno task load:group`})
    `
    const roles = memberRoles(plan.members)
    await tx`
      INSERT INTO group_members ${
      tx(ids.map((userId, i) => ({
        groupId: plan.groupId,
        userId,
        role: roles[i],
        addedByUserId: i === 0 ? null : ownerId,
        createdAt: start,
        updatedAt: start,
      })))
    }
    `
    return ownerId
  })
}

/** The group's tags, with change sequences 1 to `plan.tags`, an hour apart from its start. */
async function writeTags(sql: postgres.Sql, plan: TierPlan, ownerId: number, start: Date) {
  const names = tagNames(plan.tags)
  await sql`
    INSERT INTO tags (id, group_id, name, color, change_sequence, created_by_user_id,
      updated_by_user_id, created_at, updated_at)
    SELECT uuidv7(made.at - clock_timestamp()), ${plan.groupId}, (${names}::text[])[k],
      (${TAG_COLOURS}::text[])[1 + k % ${TAG_COLOURS.length}::int], k, ${ownerId}, ${ownerId},
      made.at, made.at
    FROM generate_series(1, ${plan.tags}::int) AS k,
      LATERAL (SELECT ${start}::timestamptz + k * interval '1 hour' AS at) AS made
  `
}

/** One batch of notes, `from` to `to` of the plan's, with their tag links and tombstones. */
async function writeNotes(
  sql: postgres.Sql,
  plan: TierPlan,
  batch: { from: number; to: number; start: Date; now: Date; stepMs: number; writers: number[] },
): Promise<void> {
  // Note i was written `i * stepMs` after the start. One in five was edited before the next note
  // was written, so the order of the last change is the order of the sequence, as in the app; one
  // in fifty written in the last 30 days was then deleted and has its tombstone. Its sequence is
  // `tags + i`; it carries 0 to 3 tags and 10 to 99 words; one in a thousand titles has the rare
  // word. `hashint4` makes the picks look random and stay the same on every run.
  await sql`
    WITH picked AS (
      SELECT i, hashint4(i) & 2147483647 AS h,
        ${batch.start}::timestamptz + (i - 1) * ${batch.stepMs}::float8 * interval '1 millisecond'
          AS created_at
      FROM generate_series(${batch.from}::int, ${batch.to}::int) AS i
    ), shaped AS (
      SELECT picked.*,
        CASE WHEN i % 5 = 0
          THEN created_at + (20 + h % 70) * ${batch.stepMs / 100}::float8 * interval '1 millisecond'
          ELSE created_at END AS updated_at,
        array_to_string(ARRAY(
          SELECT (${WORDS}::text[])[1 + (hashint4(i * 17 + k) & 2147483647) % ${WORDS.length}::int]
          FROM generate_series(1, 2 + h % 4) AS k
        ), ' ') || CASE WHEN i % 1000 = 7 THEN ${` ${RARE_WORD}`}::text ELSE '' END AS title,
        array_to_string(ARRAY(
          SELECT (${WORDS}::text[])[1 + (hashint4(i * 131 + k) & 2147483647) % ${WORDS.length}::int]
          FROM generate_series(1, 10 + h % 90) AS k
        ), ' ') || '.' AS body
      FROM picked
    ), inserted AS (
      INSERT INTO notes (id, group_id, title, body, version, change_sequence, created_by_user_id,
        updated_by_user_id, created_at, updated_at, deleted_at)
      SELECT uuidv7(created_at - clock_timestamp()), ${plan.groupId},
        upper(left(title, 1)) || substr(title, 2), upper(left(body, 1)) || substr(body, 2),
        CASE WHEN i % 5 = 0 THEN 2 + h % 2 ELSE 1 END,
        ${plan.tags}::int + i,
        (${batch.writers}::int[])[1 + h % ${batch.writers.length}::int],
        (${batch.writers}::int[])[1 + (h / 7) % ${batch.writers.length}::int],
        created_at, updated_at,
        CASE WHEN i % 50 = 25 AND updated_at > ${batch.now}::timestamptz - interval '30 days'
          THEN updated_at END
      FROM shaped
      RETURNING id, change_sequence, deleted_at
    ), tagged AS (
      INSERT INTO note_tags (note_id, tag_id)
      SELECT DISTINCT inserted.id, tags.id
      FROM inserted
      CROSS JOIN LATERAL generate_series(
        1, (hashint4(inserted.change_sequence::int * 31) & 2147483647) % 4
      ) AS k
      INNER JOIN tags ON tags.group_id = ${plan.groupId}
        AND tags.change_sequence =
          1 + (hashint4(inserted.change_sequence::int * 7 + k) & 2147483647) % ${plan.tags}::int
    )
    INSERT INTO group_change_tombstones (group_id, kind, entity_id, change_sequence, created_at)
    SELECT ${plan.groupId}, 'notes', id, change_sequence, deleted_at
    FROM inserted WHERE deleted_at IS NOT NULL
  `
}

/** "Added the note" for the newest `plan.activity` notes, by their writer, at their time. */
async function writeActivity(sql: postgres.Sql, plan: TierPlan): Promise<void> {
  // Inserted oldest first, because the activity feed sorts by id.
  await sql`
    INSERT INTO audit_events (event_kind, actor_user_id, group_id, entity_type, entity_id, details,
      created_at)
    SELECT 'note.created', created_by_user_id, group_id, 'note', id,
      jsonb_build_object('title', left(title, ${AUDIT_TITLE_MAX}::int)), created_at
    FROM (
      SELECT * FROM notes WHERE group_id = ${plan.groupId}
      ORDER BY change_sequence DESC LIMIT ${plan.activity}
    ) AS newest
    ORDER BY change_sequence
  `
}

/**
 * `plan.notifications` notifications for `userId`, about this group, over the last 80 days (inside
 * the nightly clean-up's 90 and 365), seven in ten read. Each payload names the group in
 * `loadGroupId`, which no notification the app writes has: {@link removeGroup} deletes by it.
 */
async function writeNotifications(
  sql: postgres.Sql,
  plan: TierPlan,
  userId: number,
  now: Date,
): Promise<void> {
  await sql`
    INSERT INTO notifications (user_id, kind, payload, link, read_at, created_at)
    SELECT ${userId}, 'group.role_changed',
      jsonb_build_object('groupName', ${plan.name}::text, 'from', 'viewer', 'to', 'editor',
        'loadGroupId', ${plan.groupId}::text),
      ${`/groups/${plan.groupId}`}, CASE WHEN i % 10 < 7 THEN made.at + interval '1 hour' END,
      made.at
    FROM generate_series(1, ${plan.notifications}::int) AS i,
      LATERAL (
        SELECT ${now}::timestamptz - (${plan.notifications}::int - i + 1)
          * (interval '80 days' / ${plan.notifications}::int) AS at
      ) AS made
    ORDER BY i
  `
}

/**
 * Makes `userId` an editor of the group, keeping a role it has, and gives it the plan's inbox,
 * replacing the one an earlier run gave it.
 */
async function addMember(sql: postgres.Sql, plan: TierPlan, userId: number): Promise<void> {
  await sql.begin(async (tx: postgres.TransactionSql) => {
    await tx`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      SELECT id, ${userId}, ${MemberRole.Editor}, owner_user_id FROM groups WHERE id = ${plan.groupId}
      ON CONFLICT (group_id, user_id) DO NOTHING
    `
    await tx`
      DELETE FROM notifications
      WHERE user_id = ${userId} AND payload ->> 'loadGroupId' = ${plan.groupId}
    `
  })
  await writeNotifications(sql, plan, userId, new Date())
}

/** What {@link removeGroup} deleted; zeros when the tier had no group. */
export interface RemoveResult {
  groups: number
  people: number
  notifications: number
}

/**
 * Deletes the group of `plan` and everything in it (its notes, tags, links, tombstones, members,
 * invitations and outbox rows go with it), its activity rows, the notifications that name it in
 * `loadGroupId`, and the people the generator made for it, all in one transaction. A generated
 * person is a member of the group with no sign-in key and no guest mark; a real account has one or
 * the other, so a `--member` account, and every other one, is never deleted. Nothing outside the
 * group is touched.
 */
export async function removeGroup(sql: postgres.Sql, plan: TierPlan): Promise<RemoveResult> {
  return await sql.begin(async (tx: postgres.TransactionSql) => {
    const people = (await tx<{ userId: number }[]>`
      SELECT group_members.user_id
      FROM group_members
      INNER JOIN users ON users.id = group_members.user_id
      WHERE group_members.group_id = ${plan.groupId}
        AND users.guest_since IS NULL
        AND NOT EXISTS (SELECT 1 FROM auth_keys WHERE auth_keys.user_id = group_members.user_id)
    `).map((row) => row.userId)
    const notifications = await tx`
      DELETE FROM notifications WHERE payload ->> 'loadGroupId' = ${plan.groupId}
    `
    await tx`DELETE FROM audit_events WHERE group_id = ${plan.groupId}`
    const groups = await tx`DELETE FROM groups WHERE id = ${plan.groupId}`
    const deleted = people.length === 0 ? { count: 0 } : await tx`
      DELETE FROM auth_users
      WHERE id IN ${tx(people)}
        AND NOT EXISTS (SELECT 1 FROM auth_keys WHERE auth_keys.user_id = auth_users.id)
    `
    return { groups: groups.count, people: deleted.count, notifications: notifications.count }
  })
}
