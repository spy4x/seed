/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { RedisKvStore } from "@spy4x/server/kv"
import { buildMethods } from "@spy4x/platform/cache"
import { ONE_MONTH_IN_SECONDS } from "@spy4x/platform/universal/time-constants"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type User, UserMFAStatus } from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createCacheService } from "../../apps/api/services/cache-service.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations } from "./migrations.ts"

/**
 * A signed-in request against a real Postgres and the API's real `RedisKvStore`, while the
 * "Valkey" behind it is stopped and started again. The Valkey is a small in-process server that
 * answers `PING`, `GET`, `SET` and `DEL` (no docker needed); stopping it closes the listener and
 * every open connection, which is what the store sees when Valkey goes down.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in HANDOFF.md). It fails when they
 * are missing rather than skipping.
 */

const RETRY_MS = 50
const KV_PASSWORD = "integration-test-only-valkey-password"
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"

/** Parses the RESP array a Redis client sends and returns its words. */
function commandWords(text: string): string[] {
  const lines = text.split("\r\n")
  const words: string[] = []
  for (let i = 1; i < lines.length; i += 2) if (lines[i + 1] !== undefined) words.push(lines[i + 1])
  return words
}

class FakeValkey {
  #listener: Deno.Listener | null = null
  #connections = new Set<Deno.Conn>()
  readonly port: number

  /** `values` is what Valkey holds; a restart keeps it, like a restart from a snapshot. */
  private constructor(
    listener: Deno.Listener,
    readonly values: Map<string, string>,
    readonly password: string,
  ) {
    this.port = (listener.addr as Deno.NetAddr).port
    this.#serve(listener)
  }

  static start(password: string, port = 0, values = new Map<string, string>()): FakeValkey {
    return new FakeValkey(Deno.listen({ hostname: "127.0.0.1", port }), values, password)
  }

  restart(): FakeValkey {
    return FakeValkey.start(this.password, this.port, this.values)
  }

  #serve(listener: Deno.Listener): void {
    this.#listener = listener
    ;(async () => {
      try {
        for await (const conn of listener) {
          this.#connections.add(conn)
          this.#handle(conn).catch(() => {}).finally(() => this.#connections.delete(conn))
        }
      } catch { /* listener closed */ }
    })()
  }

  async #handle(conn: Deno.Conn): Promise<void> {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const buffer = new Uint8Array(65536)
    // Like `requirepass`: nothing but AUTH is answered until the connection has sent the password.
    let authenticated = false
    for (;;) {
      const read = await conn.read(buffer)
      if (read === null) return
      const [name, key, value, ...rest] = commandWords(decoder.decode(buffer.subarray(0, read)))
      let reply = "+OK\r\n"
      if (name.toUpperCase() === "AUTH") {
        authenticated = key === this.password
        reply = authenticated ? "+OK\r\n" : "-WRONGPASS invalid username-password pair\r\n"
      } else if (!authenticated) reply = "-NOAUTH Authentication required.\r\n"
      else if (name.toUpperCase() === "PING") reply = "+PONG\r\n"
      else if (name.toUpperCase() === "GET") {
        const found = this.values.get(key)
        reply = found === undefined ? "$-1\r\n" : `$${encoder.encode(found).length}\r\n${found}\r\n`
      } else if (name.toUpperCase() === "SET") this.values.set(key, value)
      else if (name.toUpperCase() === "DEL") {
        const deleted = [key, value, ...rest].filter((k) =>
          k !== undefined && this.values.delete(k)
        )
        reply = `:${deleted.length}\r\n`
      } else if (name.toUpperCase() === "SCAN") {
        // Always one page: `SCAN 0 MATCH <prefix>:* COUNT n` -> cursor "0" and every matching key.
        const prefix = rest[0].slice(0, -1)
        const keys = [...this.values.keys()].filter((k) => k.startsWith(prefix))
        reply = `*2\r\n$1\r\n0\r\n*${keys.length}\r\n` +
          keys.map((k) => `$${encoder.encode(k).length}\r\n${k}\r\n`).join("")
      }
      await conn.write(encoder.encode(reply))
    }
  }

  stop(): void {
    this.#listener?.close()
    for (const conn of this.#connections) {
      try {
        conn.close()
      } catch { /* already closed */ }
    }
  }
}

/** A database schema of its own, a fake Valkey behind the API's real `RedisKvStore`, and an app. */
async function withValkeyApp(
  body: (fixture: {
    sql: postgres.Sql
    db: AppDbBase
    app: Hono<APIContext>
    reports: string[]
    valkey: () => FakeValkey
    restartValkey: () => void
    stopValkey: () => void
  }) => Promise<void>,
): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1 })
  const schema = `valkey_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  let valkey = FakeValkey.start(KV_PASSWORD)
  let kv: RedisKvStore | undefined
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await applyMigrations(sql)
    kv = await RedisKvStore.connect("127.0.0.1", valkey.port, "api", {
      password: KV_PASSWORD,
    })
    const reports: string[] = []
    const cache = createCacheService(kv, (operation) => reports.push(operation), RETRY_MS)
    const userCache = buildMethods<User>(cache, "user", ONE_MONTH_IN_SECONDS)
    const db = new AppDbBase({ sql, userCache })
    const signIn = createSignIn({
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
      const result = await signIn.signUp(c, "alice@example.com", "Passw0rd!")
      return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
    })
    app.post("/sign-in", async (c) => {
      const result = await signIn.signIn(c, "alice@example.com", "Passw0rd!")
      if (!result) return c.json({ error: "refused" }, 401)
      return c.json(
        result.user,
        result.session.secondFactor === SecondFactorStatus.Pending ? 202 : 200,
      )
    })
    app.get("/me", signIn.auth.isAuthenticated2FA, (c) => c.json(c.get("auth")!.user))
    // The profile display is what still reads the cache.
    app.get("/profile", signIn.auth.isAuthenticated2FA, async (c) => {
      return c.json(await db.user.findOneCached({ id: c.get("auth")!.user.id }))
    })
    await body({
      sql,
      db,
      app,
      reports,
      valkey: () => valkey,
      restartValkey: () => {
        valkey = valkey.restart()
      },
      stopValkey: () => valkey.stop(),
    })
  } finally {
    kv?.close()
    valkey.stop()
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

const cookieOf = (response: Response) =>
  response.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ")

Deno.test("a signed-in request survives a Valkey outage and recovers after it", async () => {
  await withValkeyApp(async ({ db, app, reports, valkey, restartValkey, stopValkey }) => {
    const signUp = await app.request("http://local/sign-up", { method: "POST" })
    expect(signUp.status).toBe(200)
    const cookie = cookieOf(signUp)
    const userId = (await signUp.json()).id as number
    const me = () => app.request("http://local/profile", { headers: { cookie } })

    expect((await me()).status).toBe(200)
    expect(reports).toEqual([])

    stopValkey()
    // The update commits to Postgres while Valkey cannot be told: its old copy must not come back.
    await db.user.updateOne({ id: userId, data: { firstName: "Changed" } })
    for (let i = 0; i < 3; i++) {
      const response = await me()
      expect(response.status).toBe(200)
      expect((await response.json()).firstName).toBe("Changed")
    }
    expect(reports.length).toBeGreaterThan(0)

    restartValkey()
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS * 2))
    expect((await me()).status).toBe(200)
    expect((await (await me()).json()).firstName).toBe("Changed")
    expect(valkey().values.size).toBeGreaterThan(0)
    const reportsAfterRecovery = reports.length
    expect((await me()).status).toBe(200)
    expect(reports.length).toBe(reportsAfterRecovery)
  })
})

Deno.test("a forged cached user row cannot turn a password into a full session", async () => {
  await withValkeyApp(async ({ sql, db, app, valkey }) => {
    const signUp = await app.request("http://local/sign-up", { method: "POST" })
    expect(signUp.status).toBe(200)
    const userId = (await signUp.json()).id as number
    // Postgres says the user has an authenticator app.
    await sql`
      INSERT INTO user_totp (user_id, secret, confirmed_at)
      VALUES (${userId}, ${"JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"}, NOW())
    `
    await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${userId}`
    // Someone who can write to Valkey caches the same row with `mfa` reset to "not configured".
    const key = `api:user_${userId}`
    const forged = { ...(await db.user.findOne({ id: userId })), mfa: UserMFAStatus.NOT_CONFIGURED }
    valkey().values.set(key, JSON.stringify(forged))
    expect((await db.user.findOneCached({ id: userId }))?.mfa).toBe(UserMFAStatus.NOT_CONFIGURED)

    const signedIn = await app.request("http://local/sign-in", { method: "POST" })
    expect(signedIn.status).toBe(202)
    // Signing in rewrote the cached row from Postgres; forge it again for the requests that follow.
    valkey().values.set(key, JSON.stringify(forged))
    const me = await app.request("http://local/me", { headers: { cookie: cookieOf(signedIn) } })
    expect(me.status).toBe(401)
    // A session that claims no second factor is required is refused too: whether the user owes one
    // comes from Postgres, not from the cached row.
    await sql`
      UPDATE auth_sessions SET second_factor = ${SecondFactorStatus.NotRequired}
      WHERE user_id = ${userId}
    `
    const notRequired = await app.request("http://local/me", {
      headers: { cookie: cookieOf(signedIn) },
    })
    expect(notRequired.status).toBe(401)
  })
})
