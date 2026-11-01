/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono, type MiddlewareHandler } from "hono"
import postgres from "postgres"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import {
  createPasswordFailures,
  PASSWORD_LOCK_POLICY,
  passwordFailureSubject,
  prunePasswordFailures,
} from "../../apps/api/services/password-failures.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import { createAuthRoute } from "../../apps/api/routes/auth.ts"
import type { AuthRateLimits } from "../../apps/api/middlewares/auth-rate-limits.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { checkedError } from "../../apps/api/_testing/api-error.ts"
import { wireGroupTransferHandler } from "../../apps/api/cqrs/command-handlers/group-transfer-wiring.ts"
import { PasswordLockedError } from "../../apps/api/services/password-locked.ts"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { GroupError, GroupRole, GroupTransferCommand } from "@domain/groups"
import { UserMFAStatus } from "@domain/identity"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { insertUser } from "./group-team.ts"

/**
 * The short lock per sign-in name after repeated wrong passwords (#387), against a real Postgres:
 * the real sign-in route, the real sign-in and the real counter over `password_failures`, with a
 * clock the test moves. The limit per network address is switched off, so only the lock can refuse.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"
const WEB_APP_URL = "https://app.example.com"
const API = "http://app.example.com/api"
const MINUTE_MS = 60_000

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `password_lock_test_${uuidV7().replaceAll("-", "")}`
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

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()
const notCalled = () => Promise.reject(new Error("this limit is not part of the test"))
const openAuthLimits: AuthRateLimits = {
  strictByIp: passThrough,
  strictByUser: passThrough,
  otpByUser: passThrough,
  guestStart: notCalled,
  normal: passThrough,
  resetByAddress: notCalled,
  emailCodeByAddress: notCalled,
  signUpCode: notCalled,
  signInLink: notCalled,
  emailChangeByUser: notCalled,
  emailChangeByAddress: notCalled,
}
const openLockout = {
  begin: () => Promise.resolve(0),
  refund: () => Promise.resolve(),
  fail: () => Promise.resolve(),
}

/** The sign-in route as `index.ts` mounts it, with one account and a clock the test moves. */
async function buildApp(sql: postgres.Sql) {
  const clock = { ms: Date.UTC(2026, 9, 13, 8), now: () => clock.ms }
  const signIn = createSignIn({
    db: new AppDbBase({ sql }),
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  const app = new Hono<APIContext>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("requestId", uuidV7())
    await next()
  })
  app.use("*", signIn.auth.parseAuth)
  app.post("/sign-up", async (c) => {
    const { email } = await c.req.json()
    const result = await signIn.signUp(c, email, PASSWORD)
    return result ? c.json({ ok: true }) : c.json({ error: "refused" }, 401)
  })
  app.route(
    "/auth",
    createAuthRoute({
      signIn,
      emit: () => {},
      mutationGuards: createMutationGuards(WEB_APP_URL),
      rateLimits: openAuthLimits,
      totpFailures: openLockout,
      passwordFailures: createPasswordFailures({ sql, clock }),
      requestPasswordReset: () => Promise.resolve(),
      requestSignInLink: () => Promise.resolve(),
      emailCodeFailures: openLockout,
      requestEmailCode: () => Promise.resolve(),
    }),
  )
  const signUp = await app.request(`${API}/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com" }),
  })
  expect(signUp.status).toBe(200)

  let requests = 0
  /** The cookies the last sign-in set, as a browser sends them back. */
  let lastCookies: string[] = []
  /** One sign-in, each from a network address of its own. What a stranger sees of the answer. */
  const attempt = async (login: string, password: string) => {
    requests += 1
    const response = await app.request(`${API}/auth/password/check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: WEB_APP_URL,
        "sec-fetch-site": "same-origin",
        "x-real-ip": `198.51.100.${requests}`,
      },
      body: JSON.stringify({ login, password }),
    })
    lastCookies = response.headers.getSetCookie().map((line) => line.split(";")[0])
    return {
      status: response.status,
      retryAfter: response.headers.get("retry-after"),
      body: response.status === 200 ? "the profile" : refusal(await response.json()),
    }
  }
  /** Signs in with the right password and answers a client that sends this session's cookie. */
  const session = async () => {
    const signedIn = await attempt("ada@example.com", PASSWORD)
    expect(signedIn.status).toBe(200)
    const cookie = lastCookies.join("; ")
    return async (path: string, body: unknown) => {
      const response = await app.request(`${API}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: WEB_APP_URL,
          "sec-fetch-site": "same-origin",
          cookie,
        },
        body: JSON.stringify(body),
      })
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        body: response.ok ? await response.json() : refusal(await response.json()),
      }
    }
  }
  return { clock, attempt, session, signIn }
}

/**
 * A refusal's code and message: the parts two answers must share. The request's own id differs
 * between any two requests, so it is left out.
 */
function refusal(body: unknown): { code: string; message: string } {
  const { code, message } = checkedError(body)
  return { code, message }
}

Deno.test("repeated wrong passwords lock one account for a short time", async (t) => {
  await withSchema(async (sql) => {
    const { clock, attempt } = await buildApp(sql)

    await t.step("the right password signs in before any wrong one", async () => {
      expect((await attempt("ada@example.com", PASSWORD)).status).toBe(200)
    })

    const known: Awaited<ReturnType<typeof attempt>>[] = []
    const unknown: typeof known = []
    await t.step("six wrong passwords from six addresses are each answered 401", async () => {
      for (let guess = 0; guess < 6; guess++) {
        known.push(await attempt("ada@example.com", `wrong-guess-${guess}`))
        unknown.push(await attempt("nobody@example.com", `wrong-guess-${guess}`))
      }
      expect(known.map((answer) => answer.status)).toEqual([401, 401, 401, 401, 401, 401])
    })

    await t.step(
      "the seventh is refused with the time to wait, the right password too",
      async () => {
        const wrong = await attempt("ada@example.com", "wrong-guess-7")
        known.push(wrong)
        unknown.push(await attempt("nobody@example.com", "wrong-guess-7"))
        expect(wrong).toEqual({
          status: 429,
          retryAfter: "60",
          body: {
            code: "rate_limited",
            message: "Too many wrong passwords. Try again in 1 minute.",
          },
        })
        expect(await attempt("ada@example.com", PASSWORD)).toEqual(wrong)
      },
    )

    await t.step("a name no account uses gets the same answers, so a lock tells nothing", () => {
      expect(unknown).toEqual(known)
    })

    await t.step("the table holds a hash of the name, never the name", async () => {
      const rows = await sql<{ subject: string }[]>`SELECT subject FROM password_failures`
      for (const row of rows) expect(row.subject).toMatch(/^[0-9a-f]{64}$/)
      expect(rows.map((row) => row.subject).sort()).toEqual(
        [
          await passwordFailureSubject("ada@example.com"),
          await passwordFailureSubject("nobody@example.com"),
        ].sort(),
      )
    })

    await t.step("the right password works again once the lock ends", async () => {
      clock.ms += MINUTE_MS - 1
      expect((await attempt("ada@example.com", PASSWORD)).status).toBe(429)
      clock.ms += 1
      expect((await attempt("ada@example.com", PASSWORD)).status).toBe(200)
    })
  })
})

Deno.test("the wrong-password counter forgets rows that decide nothing any more", async () => {
  await withSchema(async (sql) => {
    const now = new Date("2026-10-13T08:00:00.000Z")
    const ago = (ms: number) => new Date(now.getTime() - ms)
    const quiet = PASSWORD_LOCK_POLICY.quietResetMs
    const rows = [
      // Counted within the quiet hour: still decides when the next lock comes.
      { subject: "a".repeat(64), failedAttempts: 3, lockedUntil: null, lastFailureAt: ago(quiet) },
      // A lock still runs, however old the last wrong password is.
      {
        subject: "b".repeat(64),
        failedAttempts: 9,
        lockedUntil: new Date(now.getTime() + 1),
        lastFailureAt: ago(2 * quiet),
      },
      // Quiet for longer than the reset, and its lock ended: the next check starts from 0 anyway.
      {
        subject: "c".repeat(64),
        failedAttempts: 9,
        lockedUntil: ago(1),
        lastFailureAt: ago(quiet + 1),
      },
      // Made by a check that was never counted.
      { subject: "d".repeat(64), failedAttempts: 0, lockedUntil: null, lastFailureAt: null },
    ]
    for (const row of rows) {
      await sql`
        INSERT INTO password_failures (subject, failed_attempts, locked_until, last_failure_at)
        VALUES (${row.subject}, ${row.failedAttempts}, ${row.lockedUntil}, ${row.lastFailureAt})
      `
    }

    expect(await prunePasswordFailures(sql, now)).toBe(2)

    const left = await sql<{ subject: string }[]>`
      SELECT subject FROM password_failures ORDER BY subject
    `
    expect(left.map((row) => row.subject[0])).toEqual(["a", "b"])
  })
})

Deno.test("an account with a password turns two-factor on only with that password (#406)", async (t) => {
  await withSchema(async (sql) => {
    const { session } = await buildApp(sql)
    const post = await session()

    await t.step("none and a wrong one are refused, and no set-up starts", async () => {
      expect((await post("/auth/totp/connect/start", {})).body).toEqual({
        code: "bad_request",
        message: "Invalid password",
      })
      expect((await post("/auth/totp/connect/start", { password: "wrong-guess" })).body)
        .toEqual({ code: "bad_request", message: "Invalid password" })
      expect(await sql`SELECT 1 FROM user_totp`).toEqual([])
    })

    await t.step("the right one starts it", async () => {
      // An unproven address cannot carry a second factor; `signUp` leaves it unproven.
      const [{ userId }] = await sql<{ userId: number }[]>`SELECT user_id FROM auth_keys`
      await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('ada@example.com', ${userId})`
      await sql`UPDATE auth_keys SET proven_at = now()`
      const started = await post("/auth/totp/connect/start", { password: PASSWORD })
      expect(started.status).toBe(200)
      expect(typeof started.body.secret).toBe("string")
    })
  })
})

Deno.test("wrong passwords at every signed-in step share one lock per account (#406)", async (t) => {
  await withSchema(async (sql) => {
    const { session, attempt } = await buildApp(sql)
    const post = await session()
    const wrong = "wrong-guess"

    await t.step("six wrong passwords over five different steps are each refused", async () => {
      const answers = [
        await post("/auth/totp/connect/start", { password: wrong }),
        await post("/auth/totp/disconnect", { password: wrong }),
        await post("/auth/account/delete", { password: wrong }),
        await post("/auth/email/change", { email: "ada@new.example", password: wrong }),
        await post("/auth/password/change", { password: wrong, newPassword: "Battery-staple1" }),
        await post("/auth/totp/disconnect", { password: wrong }),
      ]
      expect(answers.map((answer) => answer.status)).toEqual([400, 400, 400, 400, 400, 400])
    })

    await t.step(
      "the right password is then refused with the time to wait, at any step",
      async () => {
        const locked = {
          status: 429,
          retryAfter: "60",
          body: {
            code: "rate_limited",
            message: "Too many wrong passwords. Try again in 1 minute.",
          },
        }
        expect(await post("/auth/totp/disconnect", { password: PASSWORD })).toEqual(locked)
        expect(await post("/auth/totp/connect/start", { password: PASSWORD })).toEqual(locked)
        expect(await sql`SELECT 1 FROM user_totp`).toEqual([])
      },
    )

    await t.step("the count is kept per account, not per sign-in name", async () => {
      const rows = await sql<{ userId: number }[]>`SELECT user_id FROM password_check_failures`
      expect(rows.length).toBe(1)
      expect(await sql`SELECT 1 FROM password_failures WHERE failed_attempts > 0`).toEqual([])
      // The sign-in page keeps its own count, which the session's guesses did not touch.
      expect((await attempt("ada@example.com", PASSWORD)).status).toBe(200)
    })
  })
})

Deno.test("a group transfer counts its wrong passwords on the account's one lock (#406)", async (t) => {
  await withSchema(async (sql) => {
    const { session, signIn } = await buildApp(sql)
    const post = await session()
    const [{ id: owner }] = await sql<{ id: number }[]>`SELECT id FROM users`
    const repository = new PostgresGroupRepository(sql)
    const { group } = await repository.create({ id: uuidV7(), name: "Team" }, owner)
    const member = await insertUser(sql)
    await sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      VALUES (${group.id}, ${member}, ${GroupRole.EDITOR}, ${owner})
    `
    // The API's own wiring of the handler, over this test's database and sign-in.
    const handle = wireGroupTransferHandler({
      db: new AppDbBase({ sql }),
      signIn,
      eventBus: { emit: () => {} },
    })
    const transfer = (password: string) =>
      handle(
        new GroupTransferCommand({
          actor: {
            userId: owner,
            userMfa: UserMFAStatus.NOT_CONFIGURED,
            sessionSecondFactor: SecondFactorStatus.NotRequired,
          },
          groupId: group.id,
          userId: member,
          name: "Team",
          password,
        }),
      ).then(() => "transferred", (error) => {
        if (error instanceof GroupError) return error.code
        if (error instanceof PasswordLockedError) return "locked"
        throw error
      })

    await t.step("six wrong passwords at the transfer are each refused", async () => {
      const answers = []
      for (let guess = 0; guess < 6; guess++) answers.push(await transfer("wrong-guess"))
      expect(answers).toEqual(Array(6).fill("PASSWORD_INVALID"))
    })

    await t.step(
      "the right password is then refused, at the transfer and at another step",
      async () => {
        expect(await transfer(PASSWORD)).toBe("locked")
        expect((await post("/auth/totp/disconnect", { password: PASSWORD })).status).toBe(429)
        const [{ ownerUserId }] = await sql<{ ownerUserId: number }[]>`
        SELECT owner_user_id FROM groups WHERE id = ${group.id}
      `
        expect(ownerUserId).toBe(owner)
      },
    )
  })
})
