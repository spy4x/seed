/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import {
  createPasswordFailures,
  passwordFailureSubject,
} from "../../apps/api/services/password-failures.ts"
import {
  createPasswordFingerprint,
  createSignInDevice,
  SIGN_IN_DEVICE_COOKIE,
  SIGN_IN_DEVICE_TTL_MS,
} from "../../apps/api/services/sign-in-device.ts"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import {
  createAuthRateLimits,
  DEVICE_SIGN_IN_ATTEMPTS,
  DEVICE_SIGN_IN_WINDOW_MS,
} from "../../apps/api/middlewares/auth-rate-limits.ts"
import { createAuthRoute, DEVICE_BUDGET_SPENT } from "../../apps/api/routes/auth.ts"
import { memoryStore } from "../../apps/api/_testing/auth-routes.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * The device cookie against lockout (spy4x/seed#1071), against a real Postgres: the real
 * sign-in route, sign-in, lock per name over `password_failures` and auth rate limits, with one
 * clock the test moves. Every stranger comes from the one address all visitors share behind a
 * proxy that passes no client address on, unless a test says otherwise.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"
const NEW_PASSWORD = "N3w-Passw0rd!"
const OWNER = "ada@example.com"
const WEB_APP_URL = "https://app.example.com"
const API = "http://app.example.com/api"
/** The one address every visitor has behind such a proxy. */
const SHARED_ADDRESS = "203.0.113.1"
/** The strict budget per address, as production configures it: 30 a minute. */
const STRICT_LIMIT = 30
const LOCK_MESSAGE = "Too many wrong passwords. Try again in 1 minute."
/** Wrong passwords a lock lets through before it starts: the policy's free ones and one more. */
const LOCK_FREE_WRONG = 6
/** The answer of the strict budget per address, the rate-limit middleware's own. */
const STRICT_MESSAGE = "Too many requests, please try again later."

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `sign_in_device_test_${uuidV7().replaceAll("-", "")}`
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

/** One answer of the sign-in: what a client sees of it. */
interface Answer {
  status: number
  retryAfter: string | null
  /** The refusal's message: the lock's, the strict limit's or the device budget's. */
  message: string | null
  /** The device cookie the answer set, as the browser sends it back, or `null`. */
  device: string | null
}

/** The sign-in route as `index.ts` mounts it, with two accounts and one clock. */
async function buildApp(sql: postgres.Sql) {
  const clock = { ms: Date.UTC(2026, 10, 16, 8), now: () => clock.ms }
  const db = new AppDbBase({ sql })
  const signIn = createSignIn({
    db,
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
  // A password change as the signed-in route makes it, other sessions kept.
  app.post("/change/:id", async (c) => {
    const state = { user: { id: Number(c.req.param("id")) } } as never
    const changed = await signIn.changePassword(c, state, PASSWORD, NEW_PASSWORD, false)
    return changed ? c.json({ ok: true }) : c.json({ error: "refused" }, 401)
  })
  const notCalled = () => Promise.reject(new Error("this limit is not part of the test"))
  const lockout = { begin: () => Promise.resolve(0), refund: notCalled, fail: notCalled }
  app.route(
    "/auth",
    createAuthRoute({
      signIn,
      emit: () => {},
      mutationGuards: createMutationGuards(WEB_APP_URL),
      rateLimits: createAuthRateLimits({
        windowMs: 60_000,
        strictLimit: STRICT_LIMIT,
        limit: 1_000,
        otpWindowMs: 900_000,
        otpLimit: 1_000,
        store: memoryStore,
        onStoreError: () => {},
        clock: clock.now,
      }),
      totpFailures: lockout,
      passwordFailures: createPasswordFailures({ sql, clock }),
      signInDevice: createSignInDevice({
        cookieSecret: COOKIE_SECRET,
        secureCookie: false,
        passwordFingerprint: createPasswordFingerprint(sql),
        now: clock.now,
      }),
      emailCodeFailures: lockout,
      requestEmailCode: notCalled,
    }),
  )
  for (const email of [OWNER, "eve@example.com"]) {
    const signUp = await app.request(`${API}/sign-up`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    })
    expect(signUp.status).toBe(200)
  }

  let addresses = 0
  /** One sign-in from `from` (a fresh address when left out), sending `device` when given. */
  const attempt = async (
    login: string,
    password: string,
    { from, device }: { from?: string; device?: string | null } = {},
  ): Promise<Answer> => {
    addresses += 1
    const response = await app.request(`${API}/auth/password/check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: WEB_APP_URL,
        "sec-fetch-site": "same-origin",
        "x-real-ip": from ?? `198.51.100.${addresses}`,
        ...(device ? { cookie: device } : {}),
      },
      body: JSON.stringify({ login, password }),
    })
    const set = response.headers.getSetCookie()
      .find((line) => line.startsWith(`${SIGN_IN_DEVICE_COOKIE}=`))
    const body = response.ok ? null : await response.json()
    return {
      status: response.status,
      retryAfter: response.headers.get("retry-after"),
      // The API's errors carry `{ error: { message } }`; the rate-limit middleware's `{ error }`.
      message: typeof body?.error === "string" ? body.error : body?.error?.message ?? null,
      device: set ? set.split(";")[0] : null,
    }
  }
  /** Signs `login` in with `password` and answers the device cookie it earned. */
  const deviceOf = async (login: string, password = PASSWORD): Promise<string> => {
    const answer = await attempt(login, password)
    expect(answer.status).toBe(200)
    if (!answer.device) throw new Error("the right password set no device cookie")
    return answer.device
  }
  /** The wrong passwords counted on `login`'s name, 0 when it has no row. */
  const failuresOf = async (login: string): Promise<number> => {
    const subject = await passwordFailureSubject(login)
    const [row] = await sql<{ failedAttempts: number }[]>`
      SELECT failed_attempts FROM password_failures WHERE subject = ${subject}
    `
    return row?.failedAttempts ?? 0
  }
  /** The owner's password, reset with a mailed code or changed while signed in, to NEW_PASSWORD. */
  const newPassword = async (how: "reset" | "change"): Promise<void> => {
    if (how === "reset") {
      // Issued on the host clock: the reset checks its code against the host clock too.
      const issued = await issuePasswordReset(db.authStore, OWNER)
      if (!issued) throw new Error("no reset code was issued")
      expect(await signIn.resetPassword(OWNER, issued.code, NEW_PASSWORD)).toBe(true)
      return
    }
    const [key] = await sql<{ userId: number }[]>`
      SELECT user_id FROM auth_keys WHERE subject = ${OWNER}
    `
    const response = await app.request(`${API}/change/${key.userId}`, { method: "POST" })
    expect(response.status).toBe(200)
  }
  return { clock, attempt, deviceOf, failuresOf, newPassword }
}

/**
 * The cookies that must earn nothing: the owner's own one with its signature changed, Eve's own,
 * and the owner's from 180 days ago. Built before any stranger starts, so they spend no budget.
 */
async function deadCookies(built: Awaited<ReturnType<typeof buildApp>>) {
  const expired = await built.deviceOf(OWNER)
  built.clock.ms += SIGN_IN_DEVICE_TTL_MS
  const valid = await built.deviceOf(OWNER)
  // A character inside the signature, not the last one, so the token stays canonical base64url.
  const at = valid.length - 5
  const forged = `${valid.slice(0, at)}${valid[at] === "A" ? "B" : "A"}${valid.slice(at + 1)}`
  const foreign = await built.deviceOf("eve@example.com")
  // A minute on, so the sign-ins above spend nothing of the strangers' window.
  built.clock.ms += 60_000
  return { valid, dead: { forged, foreign, expired } }
}

Deno.test("the owner signs in from their browser through 50 strangers' wrong passwords a minute", async () => {
  await withSchema(async (sql) => {
    const { attempt, deviceOf } = await buildApp(sql)
    const device = await deviceOf(OWNER)

    const strangers: number[] = []
    for (let guess = 0; guess < 50; guess++) {
      strangers.push(
        (await attempt(OWNER, `wrong-guess-${guess}`, { from: SHARED_ADDRESS })).status,
      )
    }
    const strangerWithPassword = await attempt(OWNER, PASSWORD, { from: SHARED_ADDRESS })
    const owner = await attempt(OWNER, PASSWORD, { from: SHARED_ADDRESS, device })

    // Six wrong passwords set the lock off; the strict budget then runs out too.
    expect(strangers.slice(0, 6)).toEqual(Array(6).fill(401))
    expect(strangers.slice(6)).toEqual(Array(44).fill(429))
    expect(strangerWithPassword.status).toBe(429)
    expect(owner.status).toBe(200)
  })
})

Deno.test("a forged, foreign or expired device cookie gets no way past the lock per name", async (t) => {
  await withSchema(async (sql) => {
    const built = await buildApp(sql)
    const { valid, dead } = await deadCookies(built)
    for (let guess = 0; guess < 7; guess++) await built.attempt(OWNER, `wrong-guess-${guess}`)

    for (const [name, device] of Object.entries(dead)) {
      await t.step(
        `the ${name} cookie is refused by the lock, the right password too`,
        async () => {
          const answer = await built.attempt(OWNER, PASSWORD, { device })
          expect([answer.status, answer.message]).toEqual([429, LOCK_MESSAGE])
        },
      )
    }
    await t.step("the owner's own cookie still signs in", async () => {
      expect((await built.attempt(OWNER, PASSWORD, { device: valid })).status).toBe(200)
    })
  })
})

Deno.test("a forged, foreign or expired device cookie gets no way past the address's budget", async (t) => {
  await withSchema(async (sql) => {
    const built = await buildApp(sql)
    const { valid, dead } = await deadCookies(built)
    // Another name, so only the address's budget runs out, not the owner's lock.
    for (let guess = 0; guess < STRICT_LIMIT; guess++) {
      await built.attempt("nobody@example.com", `wrong-guess-${guess}`, { from: SHARED_ADDRESS })
    }

    for (const [name, device] of Object.entries(dead)) {
      await t.step(`the ${name} cookie is refused by the address's budget`, async () => {
        const answer = await built.attempt(OWNER, PASSWORD, { from: SHARED_ADDRESS, device })
        expect(answer.status).toBe(429)
        expect(answer.message).toBe(STRICT_MESSAGE)
      })
    }
    await t.step("the owner's own cookie still signs in from that address", async () => {
      const answer = await built.attempt(OWNER, PASSWORD, { from: SHARED_ADDRESS, device: valid })
      expect(answer.status).toBe(200)
    })
  })
})

Deno.test("a login's devices share ten sign-ins in 15 minutes, then wait", async () => {
  await withSchema(async (sql) => {
    const { clock, attempt, deviceOf } = await buildApp(sql)
    const devices = [await deviceOf(OWNER), await deviceOf(OWNER)]
    const eves = await deviceOf("eve@example.com")

    const statuses: number[] = []
    for (let signIn = 0; signIn < DEVICE_SIGN_IN_ATTEMPTS; signIn++) {
      // The right password, so the devices' locks stay off, from a fresh address each time: only
      // the login's device budget can run out. The two devices take turns.
      statuses.push((await attempt(OWNER, PASSWORD, { device: devices[signIn % 2] })).status)
    }
    const eleventh = await attempt(OWNER, PASSWORD, { device: devices[0] })
    const otherDevice = await attempt(OWNER, PASSWORD, { device: devices[1] })
    const otherLogin = await attempt("eve@example.com", PASSWORD, { device: eves })
    clock.ms += DEVICE_SIGN_IN_WINDOW_MS
    const afterWindow = await attempt(OWNER, PASSWORD, { device: devices[1] })

    expect(statuses).toEqual(Array(DEVICE_SIGN_IN_ATTEMPTS).fill(200))
    expect(eleventh.status).toBe(429)
    expect(eleventh.message).toBe(DEVICE_BUDGET_SPENT)
    expect(Number(eleventh.retryAfter)).toBeGreaterThan(0)
    expect([otherDevice.status, otherDevice.message]).toEqual([429, DEVICE_BUDGET_SPENT])
    expect(otherLogin.status).toBe(200)
    expect(afterWindow.status).toBe(200)
  })
})

Deno.test("one address that mints cookies for its own login gets no more password checks than the login's budget", async () => {
  await withSchema(async (sql) => {
    const { attempt } = await buildApp(sql)
    const minted: string[] = []
    for (let mint = 0; mint < 3; mint++) {
      const { status, device } = await attempt(OWNER, PASSWORD, { from: SHARED_ADDRESS })
      expect(status).toBe(200)
      if (!device) throw new Error("the right password set no device cookie")
      minted.push(device)
    }

    const answers: Answer[] = []
    for (let signIn = 0; signIn < DEVICE_SIGN_IN_ATTEMPTS * 3; signIn++) {
      const device = minted[signIn % minted.length]
      answers.push(await attempt(OWNER, PASSWORD, { from: SHARED_ADDRESS, device }))
    }

    // Every cookie is a device of the one login, so they spend one budget between them.
    expect(answers.slice(0, DEVICE_SIGN_IN_ATTEMPTS).map((a) => a.status))
      .toEqual(Array(DEVICE_SIGN_IN_ATTEMPTS).fill(200))
    expect(answers.slice(DEVICE_SIGN_IN_ATTEMPTS).map((a) => [a.status, a.message]))
      .toEqual(Array(DEVICE_SIGN_IN_ATTEMPTS * 2).fill([429, DEVICE_BUDGET_SPENT]))
  })
})

Deno.test("wrong passwords from a device do not count towards the lock per name", async () => {
  await withSchema(async (sql) => {
    const { attempt, deviceOf, failuresOf } = await buildApp(sql)
    const device = await deviceOf(OWNER)
    const before = await failuresOf(OWNER)

    for (let guess = 0; guess < LOCK_FREE_WRONG; guess++) {
      expect((await attempt(OWNER, `wrong-guess-${guess}`, { device })).status).toBe(401)
    }

    expect(await failuresOf(OWNER)).toBe(before)
    expect((await attempt(OWNER, PASSWORD)).status).toBe(200)
  })
})

Deno.test("a sign-in that came with a working device cookie keeps it", async () => {
  await withSchema(async (sql) => {
    const { attempt, deviceOf } = await buildApp(sql)
    const device = await deviceOf(OWNER)

    const answer = await attempt(OWNER, PASSWORD, { device })

    expect(answer.status).toBe(200)
    expect(answer.device).toBeNull()
  })
})

for (const how of ["reset", "change"] as const) {
  Deno.test(`a device cookie from before a password ${how} gets no way past the lock per name or the address's budget`, async (t) => {
    await withSchema(async (sql) => {
      const { attempt, deviceOf, newPassword } = await buildApp(sql)
      const old = await deviceOf(OWNER)
      await newPassword(how)
      const fresh = await deviceOf(OWNER, NEW_PASSWORD)
      for (let guess = 0; guess <= LOCK_FREE_WRONG; guess++) {
        await attempt(OWNER, `wrong-guess-${guess}`)
      }

      await t.step("the old cookie is refused by the lock, the new password too", async () => {
        const answer = await attempt(OWNER, NEW_PASSWORD, { device: old })
        expect([answer.status, answer.message]).toEqual([429, LOCK_MESSAGE])
      })
      await t.step("the old cookie is refused by the address's budget", async () => {
        // Another name, so only the address's budget runs out.
        for (let guess = 0; guess < STRICT_LIMIT; guess++) {
          await attempt("nobody@example.com", `wrong-guess-${guess}`, { from: SHARED_ADDRESS })
        }
        const answer = await attempt(OWNER, NEW_PASSWORD, { from: SHARED_ADDRESS, device: old })
        expect([answer.status, answer.message]).toEqual([429, STRICT_MESSAGE])
      })
      await t.step("a cookie earned with the new password still signs in", async () => {
        const answer = await attempt(OWNER, NEW_PASSWORD, { from: SHARED_ADDRESS, device: fresh })
        expect(answer.status).toBe(200)
      })
    })
  })
}

Deno.test("a device is locked after six wrong passwords, while the owner's other browser signs in through strangers' lock", async () => {
  await withSchema(async (sql) => {
    const { attempt, deviceOf } = await buildApp(sql)
    const guesser = await deviceOf(OWNER)
    const owner = await deviceOf(OWNER)

    const statuses: number[] = []
    for (let guess = 0; guess < LOCK_FREE_WRONG; guess++) {
      statuses.push((await attempt(OWNER, `wrong-guess-${guess}`, { device: guesser })).status)
    }
    const locked = await attempt(OWNER, `wrong-guess-last`, { device: guesser })
    const lockedRight = await attempt(OWNER, PASSWORD, { device: guesser })
    // Strangers without a cookie set off the lock on the owner's name.
    for (let guess = 0; guess <= LOCK_FREE_WRONG; guess++) {
      await attempt(OWNER, `stranger-guess-${guess}`, { from: SHARED_ADDRESS })
    }
    const stranger = await attempt(OWNER, PASSWORD, { from: SHARED_ADDRESS })
    const other = await attempt(OWNER, PASSWORD, { from: SHARED_ADDRESS, device: owner })

    expect(statuses).toEqual(Array(LOCK_FREE_WRONG).fill(401))
    expect([locked.status, locked.message]).toEqual([429, LOCK_MESSAGE])
    expect(Number(locked.retryAfter)).toBeGreaterThan(0)
    expect([lockedRight.status, lockedRight.message]).toEqual([429, LOCK_MESSAGE])
    expect([stranger.status, stranger.message]).toEqual([429, LOCK_MESSAGE])
    expect(other.status).toBe(200)
  })
})

Deno.test("the right password from a device gives back the check its lock counted", async () => {
  await withSchema(async (sql) => {
    const { attempt, deviceOf } = await buildApp(sql)
    const device = await deviceOf(OWNER)

    const statuses: number[] = []
    for (let guess = 0; guess < LOCK_FREE_WRONG - 1; guess++) {
      statuses.push((await attempt(OWNER, `wrong-guess-${guess}`, { device })).status)
    }
    // Without the refund each right password would count as wrong and set the lock off.
    for (let signIn = 0; signIn < 3; signIn++) {
      statuses.push((await attempt(OWNER, PASSWORD, { device })).status)
    }
    statuses.push((await attempt(OWNER, "wrong-guess-last", { device })).status)

    expect(statuses).toEqual([...Array(LOCK_FREE_WRONG - 1).fill(401), 200, 200, 200, 401])
  })
})
