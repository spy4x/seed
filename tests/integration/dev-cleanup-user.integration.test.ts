/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { GroupRole } from "@domain/groups"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import { createDevRoute } from "../../apps/api/routes/dev.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * The development-only `POST /test/cleanup-user` against a real Postgres, for users made through
 * `signIn.signUp`, which writes the same rows as a sign-up whose code was entered.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"

interface IdRow extends postgres.Row {
  id: number
}

interface GroupIdRow extends postgres.Row {
  id: string
}

interface CountRow extends postgres.Row {
  count: number
}

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `dev_cleanup_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
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

/** A test app with the API's sign-up handler and the dev route, as the API mounts it. */
function buildApp(sql: postgres.Sql, isDev: boolean) {
  const db = new AppDbBase({ sql })
  const signIn: SignIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.post("/sign-up", async (c) => {
    const { email, password } = await c.req.json()
    const result = await signIn.signUp(c, email, password)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  const forgotten: string[] = []
  app.route(
    "/test",
    createDevRoute({
      isDev,
      db,
      sql,
      closeSockets: () => 0,
      forgetCodeBudget: (email) => Promise.resolve(void forgotten.push(email)),
    }),
  )
  const post = (path: string, body: unknown) =>
    app.request(`http://local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  return { db, post, forgotten }
}

/** Signs up `<name>@example.com`. */
async function signUp(app: ReturnType<typeof buildApp>, name: string): Promise<number> {
  const response = await app.post("/sign-up", { email: `${name}@example.com`, password: PASSWORD })
  expect(response.status).toBe(200)
  return ((await response.json()) as { id: number }).id
}

/** How many rows in each table still point at `userId`, keyed by table. */
async function rowsOf(sql: postgres.Sql, userId: number): Promise<Record<string, number>> {
  const rows = await sql<(CountRow & { name: string })[]>`
    SELECT 'auth_users' AS name, COUNT(*)::int AS count FROM auth_users WHERE id = ${userId}
    UNION ALL SELECT 'users', COUNT(*)::int FROM users WHERE id = ${userId}
    UNION ALL SELECT 'groups', COUNT(*)::int FROM groups
      WHERE owner_user_id = ${userId} OR created_by_user_id = ${userId}
    UNION ALL SELECT 'group_members', COUNT(*)::int FROM group_members
      WHERE user_id = ${userId} OR added_by_user_id = ${userId}
    UNION ALL SELECT 'audit_events', COUNT(*)::int FROM audit_events
      WHERE actor_user_id = ${userId}
    UNION ALL SELECT 'outbox_events', COUNT(*)::int FROM outbox_events
      WHERE actor_user_id = ${userId}
    UNION ALL SELECT 'notes', COUNT(*)::int FROM notes
      WHERE created_by_user_id = ${userId} OR updated_by_user_id = ${userId}
  `
  return Object.fromEntries(rows.map((row) => [row.name, row.count]))
}

const NONE = {
  auth_users: 0,
  users: 0,
  groups: 0,
  group_members: 0,
  audit_events: 0,
  outbox_events: 0,
  notes: 0,
}

Deno.test("dev cleanup-user route", async (t) => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, true)

    await t.step("deletes a signed-up user with their first group", async () => {
      const userId = await signUp(app, "personal-only")
      const personal = await sql<
        GroupIdRow[]
      >`SELECT id FROM groups WHERE owner_user_id = ${userId}`
      expect(personal.length).toBe(1)

      const response = await app.post("/test/cleanup-user", { login: "personal-only@example.com" })

      expect(response.status).toBe(200)
      expect(await rowsOf(sql, userId)).toEqual(NONE)
      const left = await sql<CountRow[]>`
        SELECT COUNT(*)::int AS count FROM groups WHERE id = ${personal[0].id}
      `
      expect(left[0].count).toBe(0)
    })

    await t.step("deletes the shared groups the user created, with their events", async () => {
      const userId = await signUp(app, "shared-owner")
      await app.db.group.create({ id: uuidV7(), name: "Team" }, userId)
      // One event for the first group made at sign-up, one for the shared group.
      expect((await rowsOf(sql, userId)).outbox_events).toBe(2)

      const response = await app.post("/test/cleanup-user", { login: "shared-owner@example.com" })

      expect(response.status).toBe(200)
      expect(await rowsOf(sql, userId)).toEqual(NONE)
    })

    await t.step(
      "removes the user's traces from other users' groups and keeps those groups",
      async () => {
        const ownerId = await signUp(app, "bystander-owner")
        const memberId = await signUp(app, "bystander-member")
        const leaverId = await signUp(app, "leaver")
        const bystanderGroup = (
          await sql<GroupIdRow[]>`SELECT id FROM groups WHERE owner_user_id = ${ownerId}`
        )[0].id
        await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${bystanderGroup}, ${memberId}, 1, ${leaverId})
      `
        await sql`
        INSERT INTO audit_events (event_kind, actor_user_id, group_id)
        VALUES ('group.member_added', ${leaverId}, ${bystanderGroup})
      `

        const response = await app.post("/test/cleanup-user", { login: "leaver@example.com" })

        expect(response.status).toBe(200)
        expect(await rowsOf(sql, leaverId)).toEqual(NONE)
        const owner = await rowsOf(sql, ownerId)
        expect([owner.auth_users, owner.users, owner.groups, owner.group_members]).toEqual([
          1,
          1,
          1,
          1,
        ])
        expect((await rowsOf(sql, memberId)).users).toBe(1)
      },
    )

    await t.step("deletes the notes the user wrote in another user's group", async () => {
      const ownerId = await signUp(app, "notes-owner")
      const writerId = await signUp(app, "notes-writer")
      const groupId = uuidV7()
      await app.db.group.create({ id: groupId, name: "Notes" }, ownerId)
      expect(
        (await app.post("/test/add-member", {
          login: "notes-writer@example.com",
          groupId,
          role: 2,
        })).status,
      ).toBe(200)
      await app.db.note.create(
        { groupId, id: uuidV7(), title: "Mine", body: "" },
        writerId,
        null,
      )
      const kept = await app.db.note.create(
        { groupId, id: uuidV7(), title: "Owner's", body: "" },
        ownerId,
        null,
      )

      const response = await app.post("/test/cleanup-user", { login: "notes-writer@example.com" })

      expect(response.status).toBe(200)
      expect(await rowsOf(sql, writerId)).toEqual(NONE)
      expect((await app.db.note.list(groupId, { limit: 10 })).notes.map((note) => note.id))
        .toEqual([kept.note.id])
    })

    await t.step("add-member gives a user a role in a group, and changes it", async () => {
      const ownerId = await signUp(app, "member-owner")
      const joinerId = await signUp(app, "member-joiner")
      const groupId = uuidV7()
      await app.db.group.create({ id: groupId, name: "Team" }, ownerId)
      const roleOf = async () =>
        (await sql<{ role: number }[]>`
          SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${joinerId}
        `).map((row) => row.role)

      expect(
        (await app.post("/test/add-member", {
          login: "member-joiner@example.com",
          groupId,
          role: 1,
        }))
          .status,
      ).toBe(200)
      expect(await roleOf()).toEqual([1])
      expect(
        (await app.post("/test/add-member", {
          login: "member-joiner@example.com",
          groupId,
          role: 2,
        }))
          .status,
      ).toBe(200)
      expect(await roleOf()).toEqual([2])
    })

    await t.step("add-member leaves the owner's role alone", async () => {
      const ownerId = await signUp(app, "member-kept-owner")
      const groupId = uuidV7()
      await app.db.group.create({ id: groupId, name: "Team" }, ownerId)

      const response = await app.post("/test/add-member", {
        login: "member-kept-owner@example.com",
        groupId,
        role: 1,
      })

      expect(response.status).toBe(409)
      expect(
        (await sql<{ role: number }[]>`
          SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${ownerId}
        `).map((row) => row.role),
      ).toEqual([GroupRole.OWNER])
    })

    await t.step(
      "add-member refuses an owner role, a deleted group and a missing user",
      async () => {
        const ownerId = await signUp(app, "member-refuser")
        await signUp(app, "member-refused")
        const deletedGroup = (
          await sql<GroupIdRow[]>`SELECT id FROM groups WHERE owner_user_id = ${ownerId}`
        )[0].id
        await sql`UPDATE groups SET deleted_at = now() WHERE id = ${deletedGroup}`
        const shared = uuidV7()
        await app.db.group.create({ id: shared, name: "Team" }, ownerId)

        expect(
          (await app.post("/test/add-member", {
            login: "member-refused@example.com",
            groupId: shared,
            role: 4,
          })).status,
        ).toBe(400)
        expect(
          (await app.post("/test/add-member", {
            login: "member-refused@example.com",
            groupId: deletedGroup,
            role: 1,
          })).status,
        ).toBe(404)
        expect(
          (await app.post("/test/add-member", {
            login: "never-signed-up@example.com",
            groupId: shared,
            role: 1,
          })).status,
        ).toBe(404)
        expect(
          (await buildApp(sql, false).post("/test/add-member", {
            login: "member-refused@example.com",
            groupId: shared,
            role: 1,
          })).status,
        ).toBe(403)
      },
    )

    await t.step("answers 200 for a login that has no user", async () => {
      const response = await app.post("/test/cleanup-user", {
        login: "never-signed-up@example.com",
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
    })

    await t.step(
      "gives an address back the code mails it spent, with or without a user",
      async () => {
        const fresh = buildApp(sql, true)
        await signUp(fresh, "budget-kept")

        await fresh.post("/test/cleanup-user", { login: " Budget-Kept@Example.com " })
        await fresh.post("/test/cleanup-user", { login: "nobody-here@example.com" })
        await fresh.post("/test/cleanup-user", { login: "just_a_username" })

        expect(fresh.forgotten).toEqual(["budget-kept@example.com", "nobody-here@example.com"])
      },
    )

    await t.step("refuses with 403 and deletes nothing outside development", async () => {
      const userId = await signUp(app, "kept-in-prod")

      const prod = buildApp(sql, false)
      const response = await prod.post("/test/cleanup-user", {
        login: "kept-in-prod@example.com",
      })

      expect(response.status).toBe(403)
      const rows = await sql<IdRow[]>`SELECT id FROM auth_users WHERE id = ${userId}`
      expect(rows.length).toBe(1)
      expect(prod.forgotten).toEqual([])
    })
  })
})

Deno.test("dev last-mail route", async (t) => {
  await withSchema(async (sql) => {
    await sql`
      INSERT INTO dev_mail (to_address, subject, text_body) VALUES
        ('ann@example.com', 'First', 'one'),
        ('ann@example.com', 'Second', 'two'),
        ('bob@example.com', 'Other', 'three')
    `

    await t.step("answers the newest mail to the address, matched after normalising", async () => {
      const response = await buildApp(sql, true).post("/test/last-mail", {
        email: " Ann@Example.com",
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ subject: "Second", text: "two" })
    })

    await t.step("answers 404 for an address with no mail", async () => {
      const response = await buildApp(sql, true).post("/test/last-mail", {
        email: "nobody@example.com",
      })

      expect(response.status).toBe(404)
    })

    await t.step("refuses with 403 outside development", async () => {
      const response = await buildApp(sql, false).post("/test/last-mail", {
        email: "ann@example.com",
      })

      expect(response.status).toBe(403)
    })
  })
})
