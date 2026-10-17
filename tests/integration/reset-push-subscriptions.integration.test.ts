/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { createPushTokenStore } from "../../apps/api/services/push-token-store.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
import { insertUser, withSchema } from "./group-team.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import { createPushNotificationRoute } from "../../apps/api/routes/pushNotification.ts"
import { createPushRegisterHandler } from "../../apps/api/features/push/handlers.ts"
import { createWebPushService } from "../../apps/api/services/web-push-service.ts"
import { browserKeys, fakePushService } from "../../apps/api/_testing/web-push.ts"
import { generateVapidKeyPair } from "@spy4x/integrations/push"

/**
 * A password reset removes every push subscription of the account (#409), against a real Postgres
 * built from schema.sql. The case it closes: somebody signs up first with the owner's address and
 * switches notifications on in their own browser; after the owner takes the account back with a
 * reset link, that browser must not get the account's notifications any more. Needs "DB_HOST",
 * "DB_USER", "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when they are missing.
 */

// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const EMAIL = "owner@example.com"
const WEB_APP_URL = "http://app.example.test"
const KEYS = await browserKeys()
const VAPID_JSON = JSON.stringify((await generateVapidKeyPair()).keys)

/** The sign-in service over the real stores, and the user id of an account signed up with EMAIL. */
async function signedUp(sql: postgres.Sql) {
  const db = new AppDbBase({ sql })
  const signIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  // Sign-up sets a cookie, so it runs inside a request.
  let userId: number | null = null
  await new Hono<APIContext>().post("/", async (c) => {
    userId = (await signIn.signUp(c, EMAIL, "Squatter-0123", uuidV7()))?.user.id ?? null
    return c.body(null, 204)
  }).request("/", { method: "POST" })
  if (userId === null) throw new Error("The sign-up was refused")
  return { db, signIn, userId: userId as number }
}

/** Stores a push subscription for `userId` on a device of its own. */
async function subscribe(sql: postgres.Sql, userId: number): Promise<void> {
  const deviceId = uuidV7()
  await createPushTokenStore(sql).upsert({
    userId,
    deviceId,
    endpoint: `https://push.example/${deviceId}`,
    auth: "auth",
    p256dh: "p256dh",
  })
}

async function liveSubscriptions(sql: postgres.Sql, userId: number): Promise<number> {
  return (await createPushTokenStore(sql).listByUser(userId)).length
}

async function isProven(sql: postgres.Sql, userId: number): Promise<boolean> {
  const [key] = await sql<{ provenAt: Date | null }[]>`
    SELECT proven_at FROM auth_keys WHERE user_id = ${userId} AND email = ${EMAIL}
  `
  if (!key) throw new Error("The account has no key for the address")
  return key.provenAt !== null
}

Deno.test("a reset that proves the address removes every push subscription of the account and none of another account's", async () => {
  await withSchema(async (sql) => {
    const { db, signIn, userId } = await signedUp(sql)
    const stranger = await insertUser(sql)
    // Whoever signed up with the address switches notifications on in two browsers.
    await subscribe(sql, userId)
    await subscribe(sql, userId)
    await subscribe(sql, stranger)
    expect(await isProven(sql, userId)).toBe(false)

    const issued = await issuePasswordReset(db.authStore, EMAIL)
    if (!issued) throw new Error("No reset was issued")
    expect(await signIn.resetPassword(issued.email, issued.code, "Owner-0123456")).toBe(true)

    expect(await isProven(sql, userId)).toBe(true)
    expect(await liveSubscriptions(sql, userId)).toBe(0)
    expect(await liveSubscriptions(sql, stranger)).toBe(1)
  })
})

Deno.test("a reset of an address proven before removes every push subscription of the account too", async () => {
  await withSchema(async (sql) => {
    const { db, signIn, userId } = await signedUp(sql)
    const first = await issuePasswordReset(db.authStore, EMAIL)
    if (!first) throw new Error("No reset was issued")
    expect(await signIn.resetPassword(first.email, first.code, "Owner-0123456")).toBe(true)
    expect(await isProven(sql, userId)).toBe(true)
    // The owner switches notifications on after the first reset; the second reset is the one
    // under test.
    await subscribe(sql, userId)
    expect(await liveSubscriptions(sql, userId)).toBe(1)

    const second = await issuePasswordReset(db.authStore, EMAIL)
    if (!second) throw new Error("No second reset was issued")
    expect(await signIn.resetPassword(second.email, second.code, "Owner-6543210")).toBe(true)

    expect(await liveSubscriptions(sql, userId)).toBe(0)
  })
})

/**
 * The account signed up with EMAIL, its session cookie, and `POST /push` as `index.ts` mounts it:
 * the real route, register handler, push service and store, with a fake push service behind them.
 */
async function pushApp(sql: postgres.Sql) {
  const db = new AppDbBase({ sql })
  const signIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  const service = await createWebPushService(
    VAPID_JSON,
    fakePushService().options,
    createPushTokenStore(sql),
  )
  const register = createPushRegisterHandler({
    webPush: () => Promise.resolve(service),
    emit: () => {},
  })
  const unused = () => Promise.reject(new Error("not used by this test"))
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", uuidV7())
    await next()
  })
  app.use("*", signIn.auth.parseAuth)
  let userId: number | null = null
  app.post("/sign-up", async (c) => {
    userId = (await signIn.signUp(c, EMAIL, "Squatter-0123", uuidV7()))?.user.id ?? null
    return c.body(null, 204)
  })
  app.route(
    "/push",
    createPushNotificationRoute({
      auth: signIn.auth,
      mutationGuards: createMutationGuards(WEB_APP_URL),
      getPublicKey: () => "",
      register,
      remove: unused,
      list: unused,
    }),
  )
  const signUp = await app.request(`${WEB_APP_URL}/sign-up`, { method: "POST" })
  if (userId === null) throw new Error("The sign-up was refused")
  const cookie = signUp.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ")
  /** Sends `POST /push` with the session's cookie and `body`. */
  const subscribe = async (body: ReadableStream<Uint8Array> | string) =>
    await app.request(`${WEB_APP_URL}/push`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin: WEB_APP_URL,
        "sec-fetch-site": "same-origin",
      },
      body,
      duplex: "half",
    } as RequestInit)
  /** Spends a reset link mailed to EMAIL: the owner takes the account back. */
  const reset = async () => {
    const issued = await issuePasswordReset(db.authStore, EMAIL)
    if (!issued) throw new Error("No reset was issued")
    return await signIn.resetPassword(issued.email, issued.code, "Owner-0123456")
  }
  return { userId: userId as number, subscribe, reset }
}

function subscribeBody(deviceId: string): string {
  return JSON.stringify({
    deviceId,
    subscription: {
      endpoint: `https://push.example/${deviceId}`,
      keys: KEYS,
      expirationTime: null,
    },
  })
}

/**
 * A body that is sent only when `release` is called, as a client that holds it back would. The
 * route reads it after authentication, so `read` settles once the request passed that check.
 */
function heldBody(text: string) {
  let release!: () => void
  let reached!: () => void
  const opened = new Promise<void>((resolve) => release = resolve)
  const read = new Promise<void>((resolve) => reached = resolve)
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      reached()
      await opened
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  }, { highWaterMark: 0 })
  return { stream, read, release }
}

Deno.test("a subscribe that authenticated before a password reset and finishes after it stores nothing", async () => {
  await withSchema(async (sql) => {
    const { userId, subscribe, reset } = await pushApp(sql)

    // Without a reset, a held body is stored once it arrives: the harness itself works.
    const before = heldBody(subscribeBody("before"))
    const stored = subscribe(before.stream)
    await before.read
    before.release()
    expect((await stored).status).toBe(200)
    expect(await liveSubscriptions(sql, userId)).toBe(1)

    // The squatter holds a subscribe open while the owner resets the password.
    const held = heldBody(subscribeBody("held"))
    const answer = subscribe(held.stream)
    await held.read
    expect(await reset()).toBe(true)
    held.release()

    expect((await answer).status).toBe(401)
    expect(await liveSubscriptions(sql, userId)).toBe(0)
  })
})

/**
 * Waits until `count` statements that store a push subscription or lock a user wait on a lock, or
 * until `done` settles. Fails loudly, with what the database runs, when neither happens.
 */
async function blockedStatements(sql: postgres.Sql, count: number, done: Promise<unknown>) {
  let settled = false
  done.then(() => settled = true, () => settled = true)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND (query ILIKE '%INSERT INTO user_push_tokens%' OR query ILIKE '%FROM users%FOR UPDATE%')
    `
    if (row.count >= count || settled) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const running = await sql`
    SELECT state, wait_event_type, wait_event, query FROM pg_stat_activity
    WHERE datname = current_database()
  `
  throw new Error(`${count} blocked statements not seen in 10 s: ${JSON.stringify(running)}`)
}

Deno.test("a reset waits for a subscribe that already checked its session, and removes what it stored", async () => {
  await withSchema(async (sql) => {
    const { userId, subscribe, reset } = await pushApp(sql)
    // The subscribe's insert waits on an advisory lock this test holds, after its session check:
    // the moment a reset could slip in between the two. The trigger lives in this run's schema;
    // the key is this run's own.
    const key = Number(BigInt(`0x${uuidV7().replaceAll("-", "").slice(-12)}`))
    await sql.unsafe(`
      CREATE FUNCTION hold_push_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock_shared(${key});
        RETURN NEW;
      END $$;
      CREATE TRIGGER hold_push_insert BEFORE INSERT ON user_push_tokens
        FOR EACH ROW EXECUTE FUNCTION hold_push_insert();
    `)
    const holder = await sql.reserve()
    try {
      await holder`SELECT pg_advisory_lock(${key})`
      const answer = subscribe(subscribeBody("phone"))
      await blockedStatements(sql, 1, answer)
      const resetDone = reset()
      // The reset waits for the subscribe's lock on the user; without that lock it finishes here.
      await blockedStatements(sql, 2, resetDone)
      await holder`SELECT pg_advisory_unlock(${key})`

      expect((await answer).status).toBe(200)
      expect(await resetDone).toBe(true)
      expect(await liveSubscriptions(sql, userId)).toBe(0)
    } finally {
      await holder`SELECT pg_advisory_unlock_all()`.catch(() => {})
      holder.release()
    }
  })
})
