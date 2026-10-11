/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { AuthAuditEventType } from "@domain/identity"
import { SessionStatus } from "@spy4x/server/sign-in"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * Signed-in devices (#151) against a real Postgres: what a session remembers about its device, the
 * list, ending one session or all the others, and a password change that keeps or ends them.
 * Ending a session must leave nothing the realtime hub could keep a socket open on:
 * `entitledSession` is what the hub asks.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"
const NEW_PASSWORD = "N3w-passw0rd!"

const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `sessions_test_${uuidV7().replaceAll("-", "")}`
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

/** A device: the headers its requests carry. */
interface Device {
  userAgent: string
  /** What the proxy in front of the API puts in `X-Real-IP`. */
  ip: string
  /** Any other header, such as one the client forged. */
  headers?: Record<string, string>
}

const laptop: Device = { userAgent: FIREFOX_LINUX, ip: "203.0.113.42" }
const phone: Device = { userAgent: SAFARI_IPHONE, ip: "2001:db8:85a3:8d3::7" }

/** A test app over the real sign-in, with the session operations the routes call. */
function buildApp(sql: postgres.Sql, db: AppDbBase = new AppDbBase({ sql })) {
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
    const { email } = await c.req.json()
    const result = await signIn.signUp(c, email, PASSWORD)
    return result ? c.json(result.session) : c.json({ error: "refused" }, 401)
  })
  app.post("/sign-in", async (c) => {
    const { login, password } = await c.req.json()
    const result = await signIn.signIn(c, login, password)
    return result ? c.json(result.session) : c.json({ error: "refused" }, 401)
  })
  app.get("/sessions", signIn.auth.isAuthenticated2FA, async (c) => {
    return c.json(await signIn.listSessions(c.get("auth")!))
  })
  app.post("/end", signIn.auth.isAuthenticated2FA, async (c) => {
    const { id } = await c.req.json()
    return c.json({ ended: await signIn.endSession(c, c.get("auth")!, id) })
  })
  app.post("/end-others", signIn.auth.isAuthenticated2FA, async (c) => {
    return c.json({ ended: await signIn.endOtherSessions(c, c.get("auth")!) })
  })
  app.post("/password", signIn.auth.isAuthenticated2FA, async (c) => {
    const { password, newPassword, signOutOthers } = await c.req.json()
    const done = await signIn.changePassword(
      c,
      c.get("auth")!,
      password,
      newPassword,
      signOutOthers,
    )
    return c.json({ ok: done !== null })
  })
  const request = (
    path: string,
    device: Device,
    init: { body?: unknown; cookie?: string } = {},
  ) =>
    app.request(`http://local${path}`, {
      method: path === "/sessions" ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": device.userAgent,
        ...device.headers,
        "x-real-ip": device.ip,
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  return { signIn, request }
}

type App = ReturnType<typeof buildApp>

/** The session cookie a response set, as a browser sends it back. */
function cookieOf(response: Response): string {
  const header = response.headers.get("set-cookie")
  if (!header) throw new Error("the response set no cookie")
  return header.split(";")[0]
}

/** A signed-in device: its session id and cookie. */
interface Signed {
  id: number
  cookie: string
}

async function signUp(app: App, email: string, device: Device): Promise<Signed> {
  const response = await app.request("/sign-up", device, { body: { email } })
  expect(response.status).toBe(200)
  return { id: (await response.json()).id, cookie: cookieOf(response) }
}

async function signIn(app: App, email: string, device: Device): Promise<Signed> {
  const response = await app.request("/sign-in", device, {
    body: { login: email, password: PASSWORD },
  })
  expect(response.status).toBe(200)
  return { id: (await response.json()).id, cookie: cookieOf(response) }
}

Deno.test("each device is listed by name and masked address, this one marked", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const onLaptop = await signUp(app, "ada@example.com", laptop)
    const onPhone = await signIn(app, "ada@example.com", phone)

    const response = await app.request("/sessions", laptop, { cookie: onLaptop.cookie })
    const listed = await response.json()

    expect(listed.map((row: Record<string, unknown>) => [row.id, row.deviceName, row.ipHint]))
      .toEqual([
        [onLaptop.id, "Firefox on Linux", "203.0.113.*"],
        [onPhone.id, "Safari on iPhone", "2001:db8:*"],
      ])
    expect(listed.map((row: { current: boolean }) => row.current)).toEqual([true, false])
    // Neither the full address nor the user agent is kept with the session.
    const stored = await sql`SELECT * FROM auth_sessions`
    expect(JSON.stringify(stored)).not.toContain("203.0.113.42")
    expect(JSON.stringify(stored)).not.toContain("Mozilla")
  })
})

Deno.test("a client cannot choose the address shown for its session with CF-Connecting-IP", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    // Traefik rewrites X-Real-IP but passes a client's CF-Connecting-IP through untouched.
    const forger: Device = { ...laptop, headers: { "cf-connecting-ip": "198.51.100.77" } }
    const signed = await signUp(app, "ada@example.com", forger)

    const listed = await (await app.request("/sessions", forger, { cookie: signed.cookie })).json()

    expect(listed.map((row: { ipHint: string }) => row.ipHint)).toEqual(["203.0.113.*"])
  })
})

Deno.test("nobody can list or end another person's session", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await signUp(app, "ada@example.com", laptop)
    const bob = await signUp(app, "bob@example.com", phone)

    const bobsList = await (await app.request("/sessions", phone, { cookie: bob.cookie })).json()
    expect(bobsList.map((row: { id: number }) => row.id)).toEqual([bob.id])

    const response = await app.request("/end", phone, { cookie: bob.cookie, body: { id: ada.id } })
    expect(await response.json()).toEqual({ ended: false })
    expect(await app.signIn.entitledSession(ada.id)).not.toBeNull()
    const [{ count }] =
      await sql`SELECT count(*)::int AS count FROM auth_sessions WHERE id = ${ada.id}`
    expect(count).toBe(1)
  })
})

Deno.test("ending a device's session deletes it, so no socket stays entitled to it", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const onLaptop = await signUp(app, "ada@example.com", laptop)
    const onPhone = await signIn(app, "ada@example.com", phone)
    expect(await app.signIn.entitledSession(onPhone.id)).not.toBeNull()

    const response = await app.request("/end", laptop, {
      cookie: onLaptop.cookie,
      body: { id: onPhone.id },
    })

    expect(await response.json()).toEqual({ ended: true })
    const rows = await sql`SELECT id FROM auth_sessions WHERE id = ${onPhone.id}`
    expect(rows).toHaveLength(0)
    expect(await app.signIn.entitledSession(onPhone.id)).toBeNull()
    expect((await app.request("/sessions", phone, { cookie: onPhone.cookie })).status).toBe(401)
    const [audit] = await sql<{ eventType: number; identifier: string }[]>`
      SELECT event_type, identifier FROM auth_audits ORDER BY id DESC LIMIT 1
    `
    expect(audit).toEqual({
      eventType: AuthAuditEventType.SESSIONS_ENDED,
      identifier: String(onPhone.id),
    })
  })
})

Deno.test("signing out of all other devices keeps only this one", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const onLaptop = await signUp(app, "ada@example.com", laptop)
    const onPhone = await signIn(app, "ada@example.com", phone)
    const onTablet = await signIn(app, "ada@example.com", { ...phone, ip: "198.51.100.9" })
    const bob = await signUp(app, "bob@example.com", phone)
    // Sessions the list does not show: one expired, one signed out. They are not counted.
    const onOldPhone = await signIn(app, "ada@example.com", phone)
    const onOldTablet = await signIn(app, "ada@example.com", phone)
    await sql`UPDATE auth_sessions SET expires_at = now() - interval '1 minute'
      WHERE id = ${onOldPhone.id}`
    await sql`UPDATE auth_sessions SET status = ${SessionStatus.SignedOut}
      WHERE id = ${onOldTablet.id}`

    const response = await app.request("/end-others", laptop, { cookie: onLaptop.cookie })

    expect(await response.json()).toEqual({ ended: 2 })
    const [audit] = await sql<{ identifier: string }[]>`
      SELECT identifier FROM auth_audits WHERE event_type = ${AuthAuditEventType.SESSIONS_ENDED}
    `
    expect(audit).toEqual({ identifier: "all other sessions" })
    expect(await app.signIn.entitledSession(onPhone.id)).toBeNull()
    expect(await app.signIn.entitledSession(onTablet.id)).toBeNull()
    expect(await app.signIn.entitledSession(onLaptop.id)).not.toBeNull()
    // Someone else's session is untouched.
    expect(await app.signIn.entitledSession(bob.id)).not.toBeNull()
  })
})

Deno.test("a password change signs the other devices out unless asked to keep them", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const onLaptop = await signUp(app, "ada@example.com", laptop)
    const onPhone = await signIn(app, "ada@example.com", phone)

    const kept = await app.request("/password", laptop, {
      cookie: onLaptop.cookie,
      body: { password: PASSWORD, newPassword: NEW_PASSWORD, signOutOthers: false },
    })
    expect(await kept.json()).toEqual({ ok: true })
    expect(await app.signIn.entitledSession(onPhone.id)).not.toBeNull()
    expect(await app.signIn.entitledSession(onLaptop.id)).not.toBeNull()
    const oldPassword = await app.request("/sign-in", phone, {
      body: { login: "ada@example.com", password: PASSWORD },
    })
    expect(oldPassword.status).toBe(401)

    // Left out, the choice is to sign the others out.
    const ended = await app.request("/password", laptop, {
      cookie: onLaptop.cookie,
      body: { password: NEW_PASSWORD, newPassword: PASSWORD },
    })
    expect(await ended.json()).toEqual({ ok: true })
    expect(await app.signIn.entitledSession(onPhone.id)).toBeNull()
    // The change gives this device a new session, which remembers the device too.
    const listed = await (await app.request("/sessions", laptop, { cookie: cookieOf(ended) }))
      .json()
    expect(
      listed.map((row: { deviceName: string; current: boolean }) => [row.deviceName, row.current]),
    )
      .toEqual([["Firefox on Linux", true]])
  })
})

for (
  const [name, password, newPassword] of [
    ["still needs the current password", "Wrong-passw0rd!", NEW_PASSWORD],
    // Eight UTF-16 units, which the route schema accepts, but four code points.
    ["still refuses a new password shorter than eight characters", PASSWORD, "😀😀😀😀"],
  ]
) {
  Deno.test(`a password change that keeps the other devices ${name}`, async () => {
    await withSchema(async (sql) => {
      const app = buildApp(sql)
      const onLaptop = await signUp(app, "ada@example.com", laptop)

      const refused = await app.request("/password", laptop, {
        cookie: onLaptop.cookie,
        body: { password, newPassword, signOutOthers: false },
      })

      expect(await refused.json()).toEqual({ ok: false })
      const withOld = await app.request("/sign-in", phone, {
        body: { login: "ada@example.com", password: PASSWORD },
      })
      expect(withOld.status).toBe(200)
      const withNew = await app.request("/sign-in", phone, {
        body: { login: "ada@example.com", password: newPassword },
      })
      expect(withNew.status).toBe(401)
    })
  })
}

Deno.test("a request marks its session as used, at most once every few minutes", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const onLaptop = await signUp(app, "ada@example.com", laptop)
    const lastUsed = async () =>
      (await sql<{ lastUsedAt: Date }[]>`
        SELECT last_used_at FROM auth_sessions WHERE id = ${onLaptop.id}
      `)[0].lastUsedAt.getTime()

    // The request does not wait for the write, so the test waits for it, up to two seconds.
    const settled = async (done: (at: number) => boolean) => {
      for (let attempt = 0; attempt < 20 && !done(await lastUsed()); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return await lastUsed()
    }

    await sql`UPDATE auth_sessions SET last_used_at = now() - interval '1 minute'`
    const recent = await lastUsed()
    await app.request("/sessions", laptop, { cookie: onLaptop.cookie })
    // Nothing should change, so this waits the full two seconds for a write that would.
    expect(await settled((at) => at !== recent)).toBe(recent)

    await sql`UPDATE auth_sessions SET last_used_at = now() - interval '1 hour'`
    const stale = await lastUsed()
    await app.request("/sessions", laptop, { cookie: onLaptop.cookie })
    expect(await settled((at) => at > stale + 50 * 60_000)).toBeGreaterThan(stale + 50 * 60_000)
  })
})

Deno.test("a user's last-seen time moves at most once every five minutes, whatever the session", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    const app = buildApp(sql, db)
    const onLaptop = await signUp(app, "ada@example.com", laptop)
    const onPhone = await signIn(app, "ada@example.com", phone)
    const [{ userId }] = await sql<{ userId: number }[]>`
      SELECT user_id FROM auth_sessions WHERE id = ${onLaptop.id}
    `
    const seen = async () =>
      (await sql<{ lastSeenAt: Date | null }[]>`
        SELECT last_seen_at FROM users WHERE id = ${userId}
      `)[0].lastSeenAt?.getTime() ?? null

    // The fake clock: each call says what time it is.
    const start = new Date("2026-10-04T08:00:00.000Z")
    const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000)
    expect(await seen()).toBeNull()

    await db.userSeen.touch(userId, start)
    expect(await seen()).toBe(start.getTime())
    // Activity on any session, one minute and then just under five minutes later, writes nothing.
    await db.userSeen.touch(userId, at(1))
    await db.userSeen.touch(userId, new Date(at(5).getTime() - 1))
    expect(await seen()).toBe(start.getTime())
    // At five minutes it writes, and the window starts again from that write.
    await db.userSeen.touch(userId, at(5))
    expect(await seen()).toBe(at(5).getTime())
    await db.userSeen.touch(userId, at(9))
    expect(await seen()).toBe(at(5).getTime())

    // A real request on either session records the first sighting through the middleware.
    await sql`UPDATE users SET last_seen_at = NULL`
    await app.request("/sessions", phone, { cookie: onPhone.cookie })
    for (let attempt = 0; attempt < 20 && (await seen()) === null; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(await seen()).not.toBeNull()
  })
})

/** A database whose last-used write always fails, as during a short Postgres outage. */
class FailingTouchDb extends AppDbBase {
  override get sessionStore() {
    return { ...super.sessionStore, touch: () => Promise.reject(new Error("database is down")) }
  }
  override get userSeen() {
    return { touch: () => Promise.reject(new Error("database is down")) }
  }
}

Deno.test("a failed last-used or last-seen write is only logged, and the request still succeeds", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, new FailingTouchDb({ sql }))
    const onLaptop = await signUp(app, "ada@example.com", laptop)
    await sql`UPDATE auth_sessions SET last_used_at = now() - interval '1 hour'`
    const response = await app.request("/sessions", laptop, { cookie: onLaptop.cookie })
    expect(response.status).toBe(200)
    await response.body?.cancel()
    // An uncaught rejection would surface here and fail the test, as it would stop the API.
    await new Promise((resolve) => setTimeout(resolve, 200))
  })
})
