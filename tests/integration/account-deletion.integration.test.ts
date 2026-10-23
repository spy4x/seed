/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import * as OTPAuth from "@hectorm/otpauth"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import type { OutboxEvent } from "@spy4x/server/outbox"
import { BillingStatus } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { AccountDeletionBlockReason, AuthAuditEventType, UserMFAStatus } from "@domain/identity"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import {
  hardDeleteAccount,
  hardDeleteDueAccounts,
  HardDeleteOutcome,
} from "../../libs/server/auth/account-deletion.ts"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
import { createOutboxProcessor, startRepeatingJobs } from "../../libs/server/jobs/wiring.ts"
import {
  ACCOUNT_DELETION_MAIL_JOB,
  ACCOUNT_HARD_DELETE_JOB,
  ACCOUNT_RESTORED_MAIL_JOB,
  accountDeletionMailJob,
  accountRestoredMailJob,
} from "../../libs/server/jobs/account-deletion.ts"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"

/**
 * Deleting one's own account (#144) against a real Postgres: the request, the refusal while a group
 * stops it, the restore by signing in, and the delete for good that must leave no row pointing at
 * the person. That last check reads the catalog for every foreign key to `users` and `auth_users`,
 * so a table added later is covered without touching this file.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"
// A test-only authenticator secret, in base32 as the enrolment stores it.
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"

/** The authenticator code of {@link TOTP_SECRET} at `timestamp`. */
function totpCode(timestamp: number): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(TOTP_SECRET),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate({ timestamp })
}

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `account_deletion_test_${uuidV7().replaceAll("-", "")}`
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

/** A test app over the real sign-in: sign-up, sign-in, the session check and the delete. */
function buildApp(sql: postgres.Sql) {
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
  app.post("/sign-in", async (c) => {
    const { login, password } = await c.req.json()
    const result = await signIn.signIn(c, login, password)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.get("/me", (c) => c.get("auth") ? c.json(c.get("auth")!.user) : c.json({}, 401))
  // Stands for every route that needs the second factor.
  app.post("/strong", signIn.auth.isAuthenticated2FA, (c) => c.json({ ok: true }))
  app.post("/totp/check", signIn.auth.isAuthenticated1FA, async (c) => {
    const { otp } = await c.req.json()
    const ok = await signIn.checkTotp(c, c.get("auth")!, otp)
    return ok ? c.json({ ok }) : c.json({ error: "Invalid token" }, 401)
  })
  app.post("/reset", async (c) => {
    const { email, code, password } = await c.req.json()
    const ok = await signIn.resetPassword(email, code, password, c)
    return ok ? c.json({ ok }) : c.json({ error: "refused" }, 401)
  })
  app.post("/delete", async (c) => {
    const auth = c.get("auth")
    if (!auth) return c.json({ error: "signed out" }, 401)
    return c.json(await signIn.deleteAccount(c, auth))
  })
  const request = (path: string, init: { body?: unknown; cookie?: string } = {}) =>
    app.request(`http://local${path}`, {
      method: init.body === undefined && path === "/me" ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  return { db, request }
}

type App = ReturnType<typeof buildApp>

/** The session cookie a response set, as a browser sends it back. */
function cookieOf(response: Response): string {
  const header = response.headers.get("set-cookie")
  if (!header) throw new Error("the response set no cookie")
  return header.split(";")[0]
}

/** Signs `<name>@example.com` up; answers the user's id and the session cookie. */
async function signUp(app: App, name: string): Promise<{ id: number; cookie: string }> {
  const response = await app.request("/sign-up", {
    body: { email: `${name}@example.com`, password: PASSWORD },
  })
  expect(response.status).toBe(200)
  return { id: ((await response.json()) as { id: number }).id, cookie: cookieOf(response) }
}

/** Signs in as `<name>@example.com`; answers the response. */
async function signIn(app: App, name: string): Promise<Response> {
  return await app.request("/sign-in", {
    body: { login: `${name}@example.com`, password: PASSWORD },
  })
}

/**
 * Asks for the deletion of `user`'s account with `cookie`, their session by default; answers the
 * waiting request's id and the date the API answered.
 */
async function requestDeletion(
  app: App,
  sql: postgres.Sql,
  user: { id: number; cookie: string },
  cookie = user.cookie,
): Promise<{ id: string; deleteAfter: string }> {
  const response = await app.request("/delete", { body: {}, cookie })
  expect(response.status).toBe(200)
  const body = await response.json() as { deleteAfter?: string }
  expect(typeof body.deleteAfter).toBe("string")
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM account_deletions WHERE user_id = ${user.id}
  `
  expectVersion7Ids([row])
  return { id: row.id, deleteAfter: body.deleteAfter! }
}

/** Proves `<name>@example.com` as the address of `userId`, as a verified sign-up would. */
async function proveAddress(sql: postgres.Sql, userId: number, name: string): Promise<void> {
  await sql`INSERT INTO auth_email_owners (email, user_id) VALUES (${`${name}@example.com`}, ${userId})`
  await sql`UPDATE auth_keys SET proven_at = now() WHERE user_id = ${userId}`
}

/** Moves the user's waiting request into the past, as if its 7 days were over. */
async function makeDue(sql: postgres.Sql, userId: number): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    UPDATE account_deletions SET delete_after = now() - INTERVAL '1 second'
    WHERE user_id = ${userId}
    RETURNING id
  `
  return row.id
}

/** Every column that references `users.id` or `auth_users.id`, read from the catalog. */
async function userReferences(sql: postgres.Sql): Promise<{ table: string; column: string }[]> {
  return await sql<{ table: string; column: string }[]>`
    SELECT source.relname AS "table", source_column.attname AS "column"
    FROM pg_constraint
    INNER JOIN pg_class source ON source.oid = pg_constraint.conrelid
    INNER JOIN pg_class target ON target.oid = pg_constraint.confrelid
    INNER JOIN pg_namespace ON pg_namespace.oid = source.relnamespace
    CROSS JOIN LATERAL unnest(pg_constraint.conkey, pg_constraint.confkey)
      AS pairs(source_attnum, target_attnum)
    INNER JOIN pg_attribute source_column
      ON source_column.attrelid = pg_constraint.conrelid
      AND source_column.attnum = pairs.source_attnum
    INNER JOIN pg_attribute target_column
      ON target_column.attrelid = pg_constraint.confrelid
      AND target_column.attnum = pairs.target_attnum
    WHERE pg_constraint.contype = 'f'
      AND pg_namespace.nspname = current_schema()
      AND target.relname IN ('users', 'auth_users')
      AND target_column.attname = 'id'
    ORDER BY 1, 2
  `
}

/** For every referencing column and the two user tables, how many rows still hold `userId`. */
async function rowsPointingAt(sql: postgres.Sql, userId: number): Promise<Record<string, number>> {
  const columns = [
    { table: "users", column: "id" },
    { table: "auth_users", column: "id" },
    ...await userReferences(sql),
  ]
  const counts: Record<string, number> = {}
  for (const { table, column } of columns) {
    const [row] = await sql.unsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM "${table}" WHERE "${column}" = $1`,
      [userId],
    )
    counts[`${table}.${column}`] = row.count
  }
  return counts
}

Deno.test("deleting one's own account", async (t) => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)

    await t.step(
      "the delete for good leaves no row in any table that references the user",
      async () => {
        const ann = await signUp(app, "ann")
        const bob = await signUp(app, "bob")
        // Ann works in Bob's group: a note, an audit row, a member she added, an invitation.
        const shared = uuidV7()
        await app.db.group.create({ id: shared, name: "Bob's team" }, bob.id)
        const carl = await signUp(app, "carl")
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${shared}, ${ann.id}, 3, ${bob.id}), (${shared}, ${carl.id}, 1, ${ann.id})
        `
        const note = await app.db.note.create(
          { groupId: shared, id: uuidV7(), title: "Ann's note", body: "" },
          ann.id,
          null,
        )
        await sql`
          INSERT INTO group_invitations (id, group_id, token_hash, role, created_by_user_id,
            expires_at)
          VALUES (${uuidV7()}, ${shared}, ${"a".repeat(64)}, 1, ${ann.id},
            now() + INTERVAL '1 day')
        `
        // And she has her own: a second group, a push device and settings.
        await app.db.group.create({ id: uuidV7(), name: "Ann's own" }, ann.id)
        await sql`
          INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
          VALUES (${ann.id}, 'device', 'https://push.example.com/1', 'auth', 'key')
        `
        const before = await rowsPointingAt(sql, ann.id)
        // Her two groups record her as who added herself; Carl's row in Bob's group is the third.
        expect(before["notes.created_by_user_id"]).toBe(1)
        expect(before["group_members.added_by_user_id"]).toBe(3)
        expect(before["group_invitations.created_by_user_id"]).toBe(1)
        expect(before["user_push_tokens.user_id"]).toBe(1)

        await requestDeletion(app, sql, ann)
        expect(await hardDeleteAccount(sql, await makeDue(sql, ann.id))).toBe(
          HardDeleteOutcome.Deleted,
        )

        const after = await rowsPointingAt(sql, ann.id)
        expect(Object.keys(after).length).toBeGreaterThan(15)
        expect(Object.entries(after).filter(([, count]) => count > 0)).toEqual([])
        // What she left in Bob's group stays, by "Deleted user".
        const [kept] = await sql<{ createdByUserId: number | null }[]>`
          SELECT created_by_user_id FROM notes WHERE id = ${note.note.id}
        `
        expect(kept).toEqual({ createdByUserId: null })
        const members = await sql<{ userId: number; addedByUserId: number | null }[]>`
          SELECT user_id, added_by_user_id FROM group_members WHERE group_id = ${shared}
          ORDER BY user_id
        `
        expect(members).toEqual([
          { userId: bob.id, addedByUserId: bob.id },
          { userId: carl.id, addedByUserId: null },
        ])
      },
    )

    await t.step(
      "the request signs out every session of the user at once, and a restore brings none back",
      async () => {
        const dan = await signUp(app, "dan")
        const other = cookieOf(await signIn(app, "dan"))
        expect((await app.request("/me", { cookie: dan.cookie })).status).toBe(200)

        await requestDeletion(app, sql, dan, other)

        expect((await app.request("/me", { cookie: dan.cookie })).status).toBe(401)
        expect((await app.request("/me", { cookie: other })).status).toBe(401)
        const [deleted] = await sql<{ deleted: boolean }[]>`
          SELECT deleted_at IS NOT NULL AS deleted FROM users WHERE id = ${dan.id}
        `
        expect(deleted.deleted).toBe(true)

        // The soft delete alone refuses the old sessions; once a sign-in restores the account,
        // only the new session works.
        const restored = cookieOf(await signIn(app, "dan"))
        expect((await app.request("/me", { cookie: restored })).status).toBe(200)
        expect((await app.request("/me", { cookie: dan.cookie })).status).toBe(401)
        expect((await app.request("/me", { cookie: other })).status).toBe(401)
      },
    )

    await t.step(
      "the request queues the mail at once and the delete for good in 7 days",
      async () => {
        const eve = await signUp(app, "eve")
        const { id, deleteAfter } = await requestDeletion(app, sql, eve)

        const jobs = await sql<{ eventKind: string; availableAt: Date }[]>`
        SELECT event_kind, available_at FROM outbox_events
        WHERE aggregate_type = 'job' AND aggregate_id = ${id}
        ORDER BY available_at
      `
        expect(jobs.map((job) => job.eventKind)).toEqual([
          ACCOUNT_DELETION_MAIL_JOB,
          ACCOUNT_HARD_DELETE_JOB,
        ])
        expect(jobs[1].availableAt.toISOString()).toBe(deleteAfter)
        const days = (jobs[1].availableAt.getTime() - jobs[0].availableAt.getTime()) / 86_400_000
        expect(Math.round(days)).toBe(7)
        // Not due yet: the job does nothing if it runs early.
        expect(await hardDeleteAccount(sql, id)).toBe(HardDeleteOutcome.NothingDue)
      },
    )

    await t.step(
      "signing in during the wait restores the account and the delete then does nothing",
      async () => {
        const fay = await signUp(app, "fay")
        const { id } = await requestDeletion(app, sql, fay)

        const response = await signIn(app, "fay")

        expect(response.status).toBe(200)
        expect((await app.request("/me", { cookie: cookieOf(response) })).status).toBe(200)
        expect(await sql`SELECT 1 FROM account_deletions WHERE user_id = ${fay.id}`).toEqual([])
        expect(await hardDeleteAccount(sql, id)).toBe(HardDeleteOutcome.NothingDue)
        const [events] = await sql<{ types: number[] }[]>`
          SELECT array_agg(event_type ORDER BY id) AS types FROM auth_audits
          WHERE user_id = ${fay.id}
        `
        expect(events.types).toEqual([1, 5, 6, 2])
      },
    )

    await t.step(
      "with two-factor on, the password alone leaves the deletion waiting and the code restores",
      async () => {
        const quinn = await signUp(app, "quinn")
        await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${quinn.id}`
        await sql`
          INSERT INTO user_totp (user_id, secret, confirmed_at)
          VALUES (${quinn.id}, ${TOTP_SECRET}, now())
        `
        const { id } = await requestDeletion(app, sql, quinn)
        const state = () =>
          sql<{ request: string | null; deletedAt: Date | null; restores: number }[]>`
            SELECT
              (SELECT id FROM account_deletions WHERE user_id = ${quinn.id}) AS request,
              (SELECT deleted_at FROM users WHERE id = ${quinn.id}) AS "deletedAt",
              (SELECT count(*)::int FROM account_restorations WHERE user_id = ${quinn.id})
                AS restores
          `
        const [before] = await state()
        expect(before.deletedAt).not.toBeNull()

        const response = await signIn(app, "quinn")
        expect(response.status).toBe(200)
        const cookie = cookieOf(response)

        expect(await state()).toEqual([{ ...before, request: id }])
        const [session] = await sql<{ secondFactor: number }[]>`
          SELECT second_factor AS "secondFactor" FROM auth_sessions
          WHERE user_id = ${quinn.id} ORDER BY created_at DESC LIMIT 1
        `
        expect(session.secondFactor).toBe(SecondFactorStatus.Pending)
        expect((await app.request("/strong", { body: {}, cookie })).status).toBe(401)
        const wrong = await app.request("/totp/check", {
          body: { otp: totpCode(Date.now() + 10 * 60_000) },
          cookie,
        })
        expect(wrong.status).toBe(401)
        expect(await state()).toEqual([before])

        const right = await app.request("/totp/check", {
          body: { otp: totpCode(Date.now()) },
          cookie,
        })

        expect(right.status).toBe(200)
        expect(await state()).toEqual([{ request: null, deletedAt: null, restores: 1 }])
        expect((await app.request("/strong", { body: {}, cookie })).status).toBe(200)
        expect(await hardDeleteAccount(sql, id)).toBe(HardDeleteOutcome.NothingDue)
      },
    )

    await t.step(
      "a person blocked while their code is owed cannot restore the account with it",
      async () => {
        const bo = await signUp(app, "bo")
        await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${bo.id}`
        await sql`
          INSERT INTO user_totp (user_id, secret, confirmed_at)
          VALUES (${bo.id}, ${TOTP_SECRET}, now())
        `
        await requestDeletion(app, sql, bo)
        const response = await signIn(app, "bo")
        expect(response.status).toBe(200)
        const cookie = cookieOf(response)

        // The block lands after the password was checked and before the code (#146).
        await sql`UPDATE users SET blocked_at = now() WHERE id = ${bo.id}`
        const right = await app.request("/totp/check", {
          body: { otp: totpCode(Date.now()) },
          cookie,
        })

        expect(right.status).toBe(401)
        const [row] = await sql<{ deletedAt: Date | null }[]>`
          SELECT deleted_at FROM users WHERE id = ${bo.id}
        `
        expect(row.deletedAt).not.toBeNull()
        expect((await app.request("/strong", { body: {}, cookie })).status).toBe(401)
      },
    )
    await t.step(
      "a password reset while waiting drops an unproven second factor, so the password restores",
      async () => {
        const uma = await signUp(app, "uma")
        await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${uma.id}`
        await sql`
          INSERT INTO user_totp (user_id, secret, confirmed_at)
          VALUES (${uma.id}, ${TOTP_SECRET}, now())
        `
        await requestDeletion(app, sql, uma)
        const issued = (await issuePasswordReset(app.db.authStore, "uma@example.com"))!

        const reset = await app.request("/reset", {
          body: { email: issued.email, code: issued.code, password: PASSWORD },
        })
        expect(reset.status).toBe(200)
        const response = await signIn(app, "uma")

        expect(response.status).toBe(200)
        const cookie = cookieOf(response)
        expect((await app.request("/strong", { body: {}, cookie })).status).toBe(200)
        expect(await sql`SELECT 1 FROM account_deletions WHERE user_id = ${uma.id}`).toEqual([])
      },
    )

    await t.step(
      "a password reset while waiting restores the account itself, before any sign-in",
      async () => {
        const val = await signUp(app, "val")
        await requestDeletion(app, sql, val)
        const issued = await issuePasswordReset(app.db.authStore, "val@example.com")
        expect(issued).not.toBeNull()

        const reset = await app.request("/reset", {
          body: { email: issued!.email, code: issued!.code, password: PASSWORD },
        })

        expect(reset.status).toBe(200)
        const [state] = await sql<{ request: string | null; live: boolean; restores: number }[]>`
          SELECT
            (SELECT id FROM account_deletions WHERE user_id = ${val.id}) AS request,
            (SELECT deleted_at IS NULL FROM users WHERE id = ${val.id}) AS live,
            (SELECT count(*)::int FROM account_restorations WHERE user_id = ${val.id}) AS restores
        `
        expect(state).toEqual({ request: null, live: true, restores: 1 })
        const [audit] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM auth_audits
          WHERE user_id = ${val.id} AND event_type = ${AuthAuditEventType.ACCOUNT_RESTORED}
        `
        expect(audit.count).toBe(1)
      },
    )

    await t.step("a deleted account with no request waiting stays refused at sign-in", async () => {
      const gus = await signUp(app, "gus")
      await sql`UPDATE users SET deleted_at = now() WHERE id = ${gus.id}`

      expect((await signIn(app, "gus")).status).toBe(401)
      const [user] = await sql<{ deleted: boolean }[]>`
        SELECT deleted_at IS NOT NULL AS deleted FROM users WHERE id = ${gus.id}
      `
      expect(user.deleted).toBe(true)
    })

    await t.step(
      "refuses while the person owns a group others use, naming it, and changes nothing",
      async () => {
        const hal = await signUp(app, "hal")
        const ivy = await signUp(app, "ivy")
        const groupId = uuidV7()
        await app.db.group.create({ id: groupId, name: "Hal's club" }, hal.id)
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${groupId}, ${ivy.id}, 1, ${hal.id})
        `

        const response = await app.request("/delete", { body: {}, cookie: hal.cookie })

        expect(await response.json()).toEqual({
          blockers: [{
            groupId,
            name: "Hal's club",
            reason: AccountDeletionBlockReason.Members,
            endsAt: null,
          }],
        })
        expect((await app.request("/me", { cookie: hal.cookie })).status).toBe(200)
        expect(await sql`SELECT 1 FROM account_deletions WHERE user_id = ${hal.id}`).toEqual([])
      },
    )

    await t.step("a member who is waiting to be deleted stops the owner too", async () => {
      const jay = await signUp(app, "jay")
      const kim = await signUp(app, "kim")
      const groupId = uuidV7()
      await app.db.group.create({ id: groupId, name: "Jay's club" }, jay.id)
      await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${groupId}, ${kim.id}, 1, ${jay.id})
      `
      await requestDeletion(app, sql, kim)

      const response = await app.request("/delete", { body: {}, cookie: jay.cookie })

      // Kim may still sign in and come back, which would leave the group to an owner who is gone.
      expect(await response.json()).toEqual({
        blockers: [{
          groupId,
          name: "Jay's club",
          reason: AccountDeletionBlockReason.Members,
          endsAt: null,
        }],
      })
    })

    await t.step("refuses while a group of theirs has a subscription not cancelled", async () => {
      const lee = await signUp(app, "lee")
      const [personal] = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM groups WHERE owner_user_id = ${lee.id}
      `
      await sql`
        INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
          provider_event_at, provider_event_rank)
        VALUES (${personal.id}, 'sub_lee', 'pro', ${BillingStatus.Active}, now(), 1)
      `

      const response = await app.request("/delete", { body: {}, cookie: lee.cookie })

      expect(await response.json()).toEqual({
        blockers: [{
          groupId: personal.id,
          name: personal.name,
          reason: AccountDeletionBlockReason.Subscription,
          endsAt: null,
        }],
      })
    })

    await t.step("names the day a plan cancelled at the end of its period ends", async () => {
      const liz = await signUp(app, "liz")
      const [personal] = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM groups WHERE owner_user_id = ${liz.id}
      `
      await sql`
        INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
          provider_event_at, provider_event_rank, current_period_end, cancel_at_period_end)
        VALUES (${personal.id}, 'sub_liz', 'pro', ${BillingStatus.Active}, now(), 1,
          '2030-05-17T09:30:00Z', true)
      `

      const response = await app.request("/delete", { body: {}, cookie: liz.cookie })

      expect(await response.json()).toEqual({
        blockers: [{
          groupId: personal.id,
          name: personal.name,
          reason: AccountDeletionBlockReason.PlanEnding,
          endsAt: "2030-05-17T09:30:00.000Z",
        }],
      })
    })

    await t.step(
      "keeps an account due for deletion when a subscription arrived during the wait",
      async () => {
        const max = await signUp(app, "max")
        await requestDeletion(app, sql, max)
        const [personal] = await sql<{ id: string }[]>`
          SELECT id FROM groups WHERE owner_user_id = ${max.id}
        `
        await sql`
          INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
            provider_event_at, provider_event_rank)
          VALUES (${personal.id}, 'sub_max', 'pro', ${BillingStatus.Active}, now(), 1)
        `
        const id = await makeDue(sql, max.id)

        expect(await hardDeleteAccount(sql, id)).toBe(HardDeleteOutcome.Blocked)
        expect(await sql`SELECT 1 FROM auth_users WHERE id = ${max.id}`).toHaveLength(1)

        await sql`
          UPDATE subscriptions SET status = ${BillingStatus.Canceled} WHERE group_id = ${personal.id}
        `
        expect(await hardDeleteDueAccounts(sql)).toEqual({ deleted: 1, blocked: 0, failed: 0 })
        expect(await sql`SELECT 1 FROM auth_users WHERE id = ${max.id}`).toEqual([])
      },
    )

    await t.step(
      "the delete for good hands a shared group in the bin to its longest-standing live admin",
      async () => {
        const ada = await signUp(app, "ada")
        const tom = await signUp(app, "tom")
        const pam = await signUp(app, "pam")
        const rex = await signUp(app, "rex")
        const ed = await signUp(app, "ed")
        const shared = uuidV7()
        const alone = uuidV7()
        await app.db.group.create({ id: shared, name: "Ada's team" }, ada.id)
        await app.db.group.create({ id: alone, name: "Ada's editors" }, ada.id)
        // Tom is the oldest admin but waits to be deleted himself; Pam came before Rex.
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id, created_at)
          VALUES
            (${shared}, ${tom.id}, ${GroupRole.ADMIN}, ${ada.id}, now() - INTERVAL '3 days'),
            (${shared}, ${pam.id}, ${GroupRole.ADMIN}, ${ada.id}, now() - INTERVAL '2 days'),
            (${shared}, ${rex.id}, ${GroupRole.ADMIN}, ${ada.id}, now() - INTERVAL '1 day'),
            (${shared}, ${ed.id}, ${GroupRole.EDITOR}, ${ada.id}, now() - INTERVAL '4 days'),
            (${alone}, ${ed.id}, ${GroupRole.EDITOR}, ${ada.id}, now() - INTERVAL '4 days')
        `
        await sql`UPDATE users SET deleted_at = now() WHERE id = ${tom.id}`
        await sql`UPDATE groups SET deleted_at = now() WHERE id IN (${shared}, ${alone})`
        await requestDeletion(app, sql, ada)

        expect(await hardDeleteAccount(sql, await makeDue(sql, ada.id))).toBe(
          HardDeleteOutcome.Deleted,
        )

        const [group] = await sql<{ ownerUserId: number; inBin: boolean }[]>`
          SELECT owner_user_id, deleted_at IS NOT NULL AS "inBin" FROM groups WHERE id = ${shared}
        `
        expect(group).toEqual({ ownerUserId: pam.id, inBin: true })
        const members = await sql<{ userId: number; role: number }[]>`
          SELECT user_id, role FROM group_members WHERE group_id = ${shared} ORDER BY user_id
        `
        expect(members).toEqual([
          { userId: tom.id, role: GroupRole.ADMIN },
          { userId: pam.id, role: GroupRole.OWNER },
          { userId: rex.id, role: GroupRole.ADMIN },
          { userId: ed.id, role: GroupRole.EDITOR },
        ].sort((a, b) => a.userId - b.userId))
        const [audit] = await sql<{ actorUserId: number | null; targetUserId: number }[]>`
          SELECT actor_user_id, target_user_id FROM audit_events
          WHERE group_id = ${shared} AND event_kind = 'group.ownership_transferred'
        `
        expect(audit).toEqual({ actorUserId: null, targetUserId: pam.id })
        // A group in the bin with no other admin goes with the account, as before.
        expect(await sql`SELECT 1 FROM groups WHERE id = ${alone}`).toEqual([])
        expect(Object.entries(await rowsPointingAt(sql, ada.id)).filter(([, n]) => n > 0))
          .toEqual([])
      },
    )

    await t.step(
      "a request left behind never deletes an account that is live again, and is removed",
      async () => {
        const zoe = await signUp(app, "zoe")
        await requestDeletion(app, sql, zoe)
        const id = await makeDue(sql, zoe.id)
        // Restored with the request left in place: no code path writes this, the guard is for it.
        await sql`UPDATE users SET deleted_at = NULL WHERE id = ${zoe.id}`

        expect(await hardDeleteAccount(sql, id)).toBe(HardDeleteOutcome.NothingDue)

        expect(await sql`SELECT 1 FROM auth_users WHERE id = ${zoe.id}`).toHaveLength(1)
        expect(await sql`SELECT 1 FROM groups WHERE owner_user_id = ${zoe.id}`).toHaveLength(1)
        expect(await sql`SELECT 1 FROM account_deletions WHERE id = ${id}`).toEqual([])
      },
    )

    await t.step(
      "an account whose delete throws is logged with the error and holds up no other",
      async () => {
        const vic = await signUp(app, "vic")
        const wes = await signUp(app, "wes")
        await requestDeletion(app, sql, vic)
        await requestDeletion(app, sql, wes)
        const vicRequest = await makeDue(sql, vic.id)
        await makeDue(sql, wes.id)
        // Vic's request is the older one, so it is tried first; a row nothing cascades to makes
        // its delete throw.
        await sql`
          UPDATE account_deletions SET delete_after = now() - INTERVAL '1 hour'
          WHERE id = ${vicRequest}
        `
        await sql`CREATE TABLE delete_stopper (user_id INT4 REFERENCES auth_users (id))`
        const logged: string[] = []
        try {
          await sql`INSERT INTO delete_stopper (user_id) VALUES (${vic.id})`

          const result = await hardDeleteDueAccounts(sql, (line) => void logged.push(line))

          expect(result.failed).toBe(1)
          expect(await sql`SELECT 1 FROM auth_users WHERE id = ${wes.id}`).toEqual([])
          expect(await sql`SELECT 1 FROM auth_users WHERE id = ${vic.id}`).toHaveLength(1)
          expect(logged).toHaveLength(1)
          expect(logged[0]).toContain(
            `error: the account of deletion request ${vicRequest} was not deleted: `,
          )
          expect(logged[0]).toContain(`violates foreign key constraint`)

          // The nightly cleanup runs the same delete as one of its steps: it names the account in
          // its own log and fails, so the processor retries it.
          const nightly: string[] = []
          const processor = createOutboxProcessor(sql, {
            store: createPostgresAuthStore(sql),
            sender: null,
            brand: { webAppUrl: "http://app.localhost" },
            log: (line) => void nightly.push(line),
          })
          await sql`DELETE FROM outbox_events`
          // Started two days ago: its first 03:00 UTC run is due, and the next one it writes differs.
          await startRepeatingJobs(sql, new Date(Date.now() - 2 * 86_400_000))
          await sql`UPDATE outbox_events SET available_at = now()`

          expect(await processor.drainOnce()).toEqual({ claimed: 1, published: 0, failed: 1 })
          expect(nightly[0]).toContain(
            `error: the account of deletion request ${vicRequest} was not deleted: `,
          )
          expect(nightly[1]).toBe(
            `error: nightly cleanup step "delete accounts whose wait is over" failed: ` +
              `1 account(s) due for deletion were not deleted`,
          )
          await sql`DELETE FROM outbox_events`
        } finally {
          await sql`DROP TABLE delete_stopper`
        }
        // With the cause gone the next run deletes it.
        expect((await hardDeleteDueAccounts(sql)).failed).toBe(0)
        expect(await sql`SELECT 1 FROM auth_users WHERE id = ${vic.id}`).toEqual([])
      },
    )

    await t.step(
      "revokes the invitations into the person's groups and the ones they made elsewhere",
      async () => {
        const ned = await signUp(app, "ned")
        const oli = await signUp(app, "oli")
        const nedsGroup = uuidV7()
        await app.db.group.create({ id: nedsGroup, name: "Ned's club" }, ned.id)
        const olisGroup = uuidV7()
        await app.db.group.create({ id: olisGroup, name: "Oli's club" }, oli.id)
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${olisGroup}, ${ned.id}, 3, ${oli.id})
        `
        // One into Ned's group made by someone who left it, one Ned made into Oli's group, and
        // Oli's own, which stays.
        const [intoHis, byHim, untouched] = [
          uuidV7(),
          uuidV7(),
          uuidV7(),
        ]
        await sql`
          INSERT INTO group_invitations (id, group_id, token_hash, role, created_by_user_id,
            expires_at)
          VALUES
            (${intoHis}, ${nedsGroup}, ${"b".repeat(64)}, 1, ${oli.id}, now() + INTERVAL '1 day'),
            (${byHim}, ${olisGroup}, ${"c".repeat(64)}, 1, ${ned.id}, now() + INTERVAL '1 day'),
            (${untouched}, ${olisGroup}, ${"d".repeat(64)}, 1, ${oli.id}, now() + INTERVAL '1 day')
        `

        await requestDeletion(app, sql, ned)

        const invitations = await sql<{ id: string; revoked: boolean }[]>`
          SELECT id, revoked_at IS NOT NULL AS revoked FROM group_invitations
          WHERE id IN ${sql([intoHis, byHim, untouched])}
        `
        expect(Object.fromEntries(invitations.map((row) => [row.id, row.revoked]))).toEqual({
          [intoHis]: true,
          [byHim]: true,
          [untouched]: false,
        })
      },
    )

    await t.step("mails the day it goes to a proven address only, while it waits", async () => {
      const sent: EmailMessage[] = []
      const logged: string[] = []
      const job = accountDeletionMailJob({
        sql,
        sender: {
          send: (message: EmailMessage) => (
            sent.push(message),
              Promise.resolve({ ok: true, accepted: [message.to], duplicates: [] })
          ),
        } as unknown as EmailSender,
        brand: { webAppUrl: "https://app.example.com" },
        log: (line) => void logged.push(line),
      })
      const event = (id: string) => ({ aggregateId: id }) as OutboxEvent

      const ola = await signUp(app, "ola")
      await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('ola@example.com', ${ola.id})`
      await sql`UPDATE auth_keys SET proven_at = now() WHERE user_id = ${ola.id}`
      const proven = await requestDeletion(app, sql, ola)
      const pia = await signUp(app, "pia")
      const unproven = await requestDeletion(app, sql, pia)
      await job(event(proven.id))
      await job(event(unproven.id))

      expect(sent.map((mail) => mail.to)).toEqual(["ola@example.com"])
      expect(logged).toEqual([
        "warn: an account deletion mail was not sent: the account has no proven address",
      ])

      // Restored before the job ran: nothing is sent.
      expect((await signIn(app, "ola")).status).toBe(200)
      await job(event(proven.id))
      expect(sent).toHaveLength(1)
    })

    await t.step("a restore mails the proven address once, then forgets the restore", async () => {
      const sent: EmailMessage[] = []
      const logged: string[] = []
      const job = accountRestoredMailJob({
        sql,
        sender: {
          send: (message: EmailMessage) => (
            sent.push(message),
              Promise.resolve({ ok: true, accepted: [message.to], duplicates: [] })
          ),
        } as unknown as EmailSender,
        brand: { webAppUrl: "https://app.example.com" },
        log: (line) => void logged.push(line),
      })
      const restoresOf = (userId: number) =>
        sql<{ id: string }[]>`SELECT id FROM account_restorations WHERE user_id = ${userId}`

      const rae = await signUp(app, "rae")
      await proveAddress(sql, rae.id, "rae")
      await requestDeletion(app, sql, rae)
      const sam = await signUp(app, "sam")
      await requestDeletion(app, sql, sam)
      expect((await signIn(app, "rae")).status).toBe(200)
      expect((await signIn(app, "sam")).status).toBe(200)
      const [raeRestore] = await restoresOf(rae.id)
      const [samRestore] = await restoresOf(sam.id)
      expectVersion7Ids([raeRestore, samRestore])
      const [queued] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM outbox_events
        WHERE event_kind = ${ACCOUNT_RESTORED_MAIL_JOB}
          AND aggregate_id IN (${raeRestore.id}, ${samRestore.id})
      `
      expect(queued.count).toBe(2)

      await job({ aggregateId: raeRestore.id } as OutboxEvent)
      await job({ aggregateId: samRestore.id } as OutboxEvent)
      await job({ aggregateId: raeRestore.id } as OutboxEvent)

      expect(sent.map((mail) => [mail.to, mail.subject])).toEqual([
        ["rae@example.com", "Your account was restored"],
      ])
      expect(logged).toEqual([
        "warn: an account restored mail was not sent: the account has no proven address",
      ])
      expect([...await restoresOf(rae.id), ...await restoresOf(sam.id)]).toEqual([])
    })
  })
})
