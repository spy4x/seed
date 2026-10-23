/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { markOnboarding, readOnboarding } from "@server/auth/onboarding.ts"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import { scheduleStarterData, WELCOME_NOTE_TITLE } from "@server/jobs/starter-data.ts"
import { SIGN_IN_LINK_METHOD, UserMFAStatus } from "@domain/identity"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** Runs `body` on a fresh schema built from schema.sql. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1 })
  const schema = `onboarding_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 5,
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

/** A person with a first group and the welcome note the worker gives a new account. */
async function newAccount(sql: postgres.Sql, email: string) {
  const [row] = await sql<{ userId: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id),
    u AS (INSERT INTO users (id) SELECT id FROM auth_user RETURNING id)
    SELECT id AS user_id FROM u
  `
  const { userId } = row
  await sql`INSERT INTO auth_keys (user_id, method, subject, email)
    VALUES (${userId}, ${PASSWORD_METHOD}, ${email}, ${email})`
  const groupId = uuidV7()
  await sql.begin(async (tx) => {
    await new PostgresGroupRepository(tx).createFirst({ id: groupId, name: "Personal" }, userId)
    await scheduleStarterData(tx, userId)
  })
  const drained = await createOutboxProcessor(sql, {
    store: createPostgresAuthStore(sql),
    sender: null,
    brand: { webAppUrl: "http://app.localhost" },
    log: () => {},
  }).drainOnce()
  expect(drained.failed).toBe(0)
  return { userId, groupId }
}

const addNote = (sql: postgres.Sql, groupId: string, userId: number) =>
  sql`INSERT INTO notes (id, group_id, title, change_sequence, created_by_user_id)
    VALUES (${uuidV7()}, ${groupId}, 'Mine', 50, ${userId})`

const NOTHING_DONE = {
  emailVerified: false,
  noteCreated: false,
  memberInvited: false,
  notificationsOn: false,
  twoFactorOn: false,
}

Deno.test("each first step is done exactly when the person's own data says so", async (t) => {
  await withSchema(async (sql) => {
    const { userId, groupId } = await newAccount(sql, "ann@example.com")
    // A second person who has done everything, as an admin of the first person's group: the note
    // and the invitation are in that shared group, and none of it may tick the first person's steps.
    const other = await newAccount(sql, "bob@example.com")
    await sql`INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      VALUES (${groupId}, ${other.userId}, 3, ${userId})`
    await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('bob@example.com', ${other.userId})`
    await sql`UPDATE auth_keys SET proven_at = now() WHERE user_id = ${other.userId}`
    await addNote(sql, groupId, other.userId)
    await sql`INSERT INTO group_invitations (id, group_id, token_hash, role, created_by_user_id, expires_at)
      VALUES (${uuidV7()}, ${groupId}, ${
      "a".repeat(64)
    }, 1, ${other.userId}, now() + interval '1 day')`
    await sql`INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
      VALUES (${other.userId}, 'd-bob', 'https://push.example/bob', 'a', 'p')`
    await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${other.userId}`

    await t.step(
      "a new account has done nothing: the welcome note is not its own note, and neither is what another member did in its group",
      async () => {
        const notes = await sql<{ title: string; createdByUserId: number }[]>`
        SELECT title, created_by_user_id FROM notes WHERE group_id = ${groupId} ORDER BY title DESC`
        expect(notes).toEqual([
          { title: WELCOME_NOTE_TITLE, createdByUserId: userId },
          { title: "Mine", createdByUserId: other.userId },
        ])
        const [{ invitations }] = await sql<{ invitations: number }[]>`
        SELECT count(*)::int AS invitations FROM group_invitations WHERE group_id = ${groupId}`
        expect(invitations).toBe(1)

        expect(await readOnboarding(sql, userId)).toEqual({
          steps: NOTHING_DONE,
          dismissed: false,
          tourSeen: false,
        })
      },
    )

    await t.step("the other person, who did all five, has all five done", async () => {
      expect((await readOnboarding(sql, other.userId))?.steps).toEqual({
        emailVerified: true,
        noteCreated: true,
        memberInvited: true,
        notificationsOn: true,
        twoFactorOn: true,
      })
    })

    await t.step("proving the address ticks the e-mail step only", async () => {
      await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('ann@example.com', ${userId})`
      await sql`UPDATE auth_keys SET proven_at = now() WHERE user_id = ${userId}`

      expect((await readOnboarding(sql, userId))?.steps).toEqual({
        ...NOTHING_DONE,
        emailVerified: true,
      })
    })

    await t.step(
      "a sign-up by link ticks the e-mail step: the link proved the address",
      async () => {
        const linked = await newAccount(sql, "cid@example.com")
        await sql`INSERT INTO auth_email_owners (email, user_id)
        VALUES ('cid@example.com', ${linked.userId})`
        await sql`UPDATE auth_keys SET method = ${SIGN_IN_LINK_METHOD}, subject = ${uuidV7()},
        proven_at = now() WHERE user_id = ${linked.userId}`
        expect((await readOnboarding(sql, linked.userId))?.steps.emailVerified).toBe(true)
      },
    )

    await t.step(
      "a note of their own ticks the note step, and stays ticked in the trash",
      async () => {
        await addNote(sql, groupId, userId)
        expect((await readOnboarding(sql, userId))?.steps.noteCreated).toBe(true)

        await sql`UPDATE notes SET deleted_at = now() WHERE group_id = ${groupId}`
        expect((await readOnboarding(sql, userId))?.steps.noteCreated).toBe(true)
      },
    )

    await t.step(
      "an invitation they made ticks the invitation step, also once revoked",
      async () => {
        await sql`INSERT INTO group_invitations
        (id, group_id, token_hash, role, created_by_user_id, expires_at, revoked_at)
        VALUES (${uuidV7()}, ${groupId}, ${
          "b".repeat(64)
        }, 1, ${userId}, now() + interval '1 day', now())`

        expect((await readOnboarding(sql, userId))?.steps.memberInvited).toBe(true)
      },
    )

    await t.step(
      "a registered browser ticks notifications, and a removed one unticks it",
      async () => {
        await sql`INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
        VALUES (${userId}, 'd-ann', 'https://push.example/ann', 'a', 'p')`
        expect((await readOnboarding(sql, userId))?.steps.notificationsOn).toBe(true)

        await sql`UPDATE user_push_tokens SET deleted_at = now() WHERE user_id = ${userId}`
        expect((await readOnboarding(sql, userId))?.steps.notificationsOn).toBe(false)
      },
    )

    await t.step("an authenticator app ticks two-factor, once its setup is finished", async () => {
      expect((await readOnboarding(sql, userId))?.steps.twoFactorOn).toBe(false)
      await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURATION_NOT_FINISHED} WHERE id = ${userId}`
      expect((await readOnboarding(sql, userId))?.steps.twoFactorOn).toBe(false)
      await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${userId}`

      expect((await readOnboarding(sql, userId))?.steps.twoFactorOn).toBe(true)
    })
  })
})

Deno.test("dismissing the checklist and ending the tour are kept per person", async (t) => {
  await withSchema(async (sql) => {
    const { userId } = await newAccount(sql, "ann@example.com")
    const other = await newAccount(sql, "bob@example.com")
    const stamps = async () =>
      (await sql<{ dismissed: Date | null; tour: Date | null }[]>`
        SELECT onboarding_dismissed_at AS dismissed, onboarding_tour_seen_at AS tour
        FROM users WHERE id = ${userId}`)[0]

    await t.step("dismiss is read back as dismissed, and leaves the tour offered", async () => {
      await markOnboarding(sql, userId, "dismissed")

      const status = await readOnboarding(sql, userId)
      expect(status?.dismissed).toBe(true)
      expect(status?.tourSeen).toBe(false)
    })

    await t.step("ending the tour is read back as seen", async () => {
      await markOnboarding(sql, userId, "tourSeen")

      expect((await readOnboarding(sql, userId))?.tourSeen).toBe(true)
    })

    await t.step("a repeated answer keeps the time of the first", async () => {
      const first = await stamps()
      await markOnboarding(sql, userId, "dismissed")
      await markOnboarding(sql, userId, "tourSeen")

      expect(await stamps()).toEqual(first)
      expect(first.dismissed).toBeInstanceOf(Date)
      expect(first.tour).toBeInstanceOf(Date)
    })

    await t.step("another person still has both", async () => {
      const status = await readOnboarding(sql, other.userId)
      expect(status?.dismissed).toBe(false)
      expect(status?.tourSeen).toBe(false)
    })

    await t.step("a deleted person has no onboarding", async () => {
      await sql`UPDATE users SET deleted_at = now() WHERE id = ${userId}`

      expect(await readOnboarding(sql, userId)).toBe(null)
      expect(await readOnboarding(sql, 2_000_000)).toBe(null)
    })
  })
})

const invitationIndexes = async (sql: postgres.Sql) =>
  (await sql<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = 'group_invitations'`)
    .map((row) => row.indexdef).filter((definition) => definition.endsWith("(created_by_user_id)"))

Deno.test("the invitation step reads group_invitations through an index on who made them", async () => {
  await withSchema(async (sql) => {
    const { userId } = await newAccount(sql, "ann@example.com")
    expect((await invitationIndexes(sql)).length).toBe(1)

    // The planner prefers a scan on a table this small; with scans priced out it shows whether an
    // index can answer the question at all.
    const plan = await sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`
      const rows = await tx<{ "QUERY PLAN": string }[]>`
        EXPLAIN SELECT EXISTS (
          SELECT 1 FROM group_invitations WHERE created_by_user_id = ${userId}
        )`
      return rows.map((row) => Object.values(row)[0]).join("\n")
    })
    expect(plan).toContain("idx_group_invitations_created_by")
    expect(plan).not.toContain("Seq Scan")
  })
})

Deno.test("the migration adds the two columns and the index to a database made before it", async () => {
  await withSchema(async (sql) => {
    await sql`ALTER TABLE users DROP COLUMN onboarding_dismissed_at, DROP COLUMN onboarding_tour_seen_at`
    await sql`DROP INDEX idx_group_invitations_created_by`
    const { userId, groupId } = await newAccount(sql, "ann@example.com")
    // A table with rows: the index is built over an invitation that is already there.
    await sql`INSERT INTO group_invitations (id, group_id, token_hash, role, created_by_user_id, expires_at)
      VALUES (${uuidV7()}, ${groupId}, ${"c".repeat(64)}, 1, ${userId}, now() + interval '1 day')`
    expect(await invitationIndexes(sql)).toEqual([])

    await sql.unsafe(
      await Deno.readTextFile("libs/server/db/migrations/2026_11_03_0001_users_onboarding.sql"),
    )

    expect((await invitationIndexes(sql)).length).toBe(1)
    expect(await readOnboarding(sql, userId)).toEqual({
      steps: { ...NOTHING_DONE, memberInvited: true },
      dismissed: false,
      tourSeen: false,
    })
    await markOnboarding(sql, userId, "dismissed")
    expect((await readOnboarding(sql, userId))?.dismissed).toBe(true)
  })
})
