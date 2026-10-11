/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import * as OTPAuth from "@hectorm/otpauth"
import { generateTotpSecret, SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import {
  createSignIn,
  EmailChangeOutcome,
  EmailVerifyOutcome,
  type SignIn,
  TOTP_NEEDS_PROVEN_EMAIL,
} from "../../apps/api/services/sign-in.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
import { sendEmailCode } from "../../libs/server/auth/email-verification.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * Proving an address with a code (#140), through the exact `createSignIn` and `AppDbBase` the API
 * runs, on a schema built from every migration. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME`
 * (recipe in docs/handoff.md); it fails when they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1 })
  const schema = `email_test_${uuidV7().replaceAll("-", "")}`
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

/** A client of the sign-in with its own cookie jar, over the routes these tests need. */
function client(signIn: SignIn) {
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.post("/sign-up", async (c) => {
    const { email } = await c.req.json()
    const result = await signIn.signUp(c, email, PASSWORD)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.post("/sign-in", async (c) => {
    const { login, password } = await c.req.json()
    const result = await signIn.signIn(c, login, password)
    return result ? c.json({ secondFactor: result.session.secondFactor }) : c.json({}, 401)
  })
  app.get("/me", signIn.auth.isAuthenticated2FA, (c) => c.json(c.get("auth")!.user))
  app.get("/email", signIn.auth.isAuthenticated2FA, async (c) => {
    return c.json(await signIn.emailStatus(c.get("auth")!))
  })
  app.post("/email/verify", signIn.auth.isAuthenticated2FA, async (c) => {
    const { code } = await c.req.json()
    return c.json({ outcome: await signIn.verifyEmail(c, c.get("auth")!, code) })
  })
  app.post("/email/change", signIn.auth.isAuthenticated2FA, async (c) => {
    const { email, password } = await c.req.json()
    return c.json({ outcome: await signIn.requestEmailChange(c.get("auth")!, password, email) })
  })
  app.post("/totp/start", signIn.auth.isAuthenticated1FA, async (c) => {
    return c.json(await signIn.connectTotpStart(c.get("auth")!))
  })
  app.post("/totp/finish", signIn.auth.isAuthenticated1FA, async (c) => {
    const { otp } = await c.req.json()
    return c.json({ ok: await signIn.connectTotpFinish(c.get("auth")!, otp) })
  })

  const cookies = new Map<string, string>()
  return async (method: string, path: string, body?: unknown) => {
    const headers = new Headers({ "content-type": "application/json" })
    if (cookies.size) {
      headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "))
    }
    const response = await app.request(`http://local${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";")
      const name = pair.slice(0, pair.indexOf("="))
      const value = pair.slice(pair.indexOf("=") + 1)
      if (value === "") cookies.delete(name)
      else cookies.set(name, value)
    }
    return { status: response.status, body: await response.json() }
  }
}

function buildSignIn(sql: postgres.Sql): SignIn {
  return createSignIn({
    db: new AppDbBase({ sql }),
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
}

/**
 * Issues a code for `email` as the worker does, and returns it instead of mailing it. The code is
 * for the account that signs in with `account`, which defaults to `email` itself.
 */
async function mailedCode(sql: postgres.Sql, email: string, account = email): Promise<string> {
  const [key] = await sql<{ userId: number }[]>`
    SELECT user_id AS "userId" FROM auth_keys WHERE subject = ${account}
  `
  let code = ""
  await sendEmailCode(new AppDbBase({ sql }).authStore, key.userId, email, (_to, sent) => {
    code = sent
    return Promise.resolve()
  })
  return code
}

/** Signs up `email` in a new client and returns that client. */
async function signedUp(signIn: SignIn, email: string) {
  const request = client(signIn)
  expect((await request("POST", "/sign-up", { email })).status).toBe(200)
  return request
}

Deno.test("a new account proves its address with a code", async (t) => {
  await withSchema(async (sql) => {
    const signIn = buildSignIn(sql)
    const ann = await signedUp(signIn, "ann@example.com")

    await t.step("an unproven address cannot turn on an authenticator app", async () => {
      expect((await ann("GET", "/email")).body).toEqual({
        email: "ann@example.com",
        proven: false,
        pending: null,
      })
      const start = await ann("POST", "/totp/start")
      expect(start.body).toEqual({ error: TOTP_NEEDS_PROVEN_EMAIL, qrcode: null, secret: null })
      expect(await sql`SELECT 1 FROM user_totp`).toHaveLength(0)
    })

    await t.step("an enrolment begun before the rule cannot finish either", async () => {
      const secret = generateTotpSecret()
      const [user] = await sql<{ id: number }[]>`SELECT id FROM users`
      await sql`INSERT INTO user_totp (user_id, secret) VALUES (${user.id}, ${secret})`
      const otp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate()

      expect((await ann("POST", "/totp/finish", { otp })).body).toEqual({ ok: false })
      await sql`DELETE FROM user_totp`
    })

    await t.step("a wrong code and an expired code get the same answer", async () => {
      const code = await mailedCode(sql, "ann@example.com")
      const wrong = await ann("POST", "/email/verify", { code: `${code}x` })
      await sql`UPDATE auth_challenges SET expires_at = now() - interval '1 second'`
      const expired = await ann("POST", "/email/verify", { code })

      expect(wrong.body).toEqual({ outcome: EmailVerifyOutcome.WrongCode })
      expect(expired.body).toEqual(wrong.body)
      expect((await ann("GET", "/email")).body.proven).toBe(false)
    })

    await t.step("five wrong guesses use a code up, so even the right one is refused", async () => {
      const code = await mailedCode(sql, "ann@example.com")
      for (let guess = 0; guess < 5; guess++) {
        await ann("POST", "/email/verify", { code: `wrong-${guess}` })
      }

      expect((await ann("POST", "/email/verify", { code })).body).toEqual({
        outcome: EmailVerifyOutcome.WrongCode,
      })
      await sql`DELETE FROM auth_challenges`
    })

    await t.step("the right code proves the address, and two-factor may then start", async () => {
      const code = await mailedCode(sql, "ann@example.com")

      expect((await ann("POST", "/email/verify", { code: ` ${code} ` })).body).toEqual({
        outcome: EmailVerifyOutcome.Verified,
      })
      expect((await ann("GET", "/email")).body).toEqual({
        email: "ann@example.com",
        proven: true,
        pending: null,
      })
      expect((await ann("POST", "/totp/start")).body.qrcode).toContain("<svg")
      expect((await ann("POST", "/email/verify", { code })).body).toEqual({
        outcome: EmailVerifyOutcome.NothingToVerify,
      })
    })
  })
})

Deno.test("changing the address waits for the new one's code", async (t) => {
  await withSchema(async (sql) => {
    const signIn = buildSignIn(sql)
    const ann = await signedUp(signIn, "ann@example.com")
    await ann("POST", "/email/verify", { code: await mailedCode(sql, "ann@example.com") })
    const otherDevice = client(signIn)
    const signInAs = (email: string) =>
      client(signIn)("POST", "/sign-in", { login: email, password: PASSWORD })

    await t.step("a wrong password changes nothing", async () => {
      const answer = await ann("POST", "/email/change", {
        email: "ann@new.example",
        password: "wrong-password",
      })

      expect(answer.body).toEqual({ outcome: EmailChangeOutcome.WrongPassword })
      expect((await ann("GET", "/email")).body.pending).toBe(null)
    })

    await t.step("until its code arrives, the account keeps its old address", async () => {
      expect(
        (await otherDevice("POST", "/sign-in", {
          login: "ann@example.com",
          password: PASSWORD,
        })).status,
      ).toBe(200)
      const answer = await ann("POST", "/email/change", {
        email: " Ann@New.Example ",
        password: PASSWORD,
      })

      expect(answer.body).toEqual({ outcome: EmailChangeOutcome.Requested })
      expect((await ann("GET", "/email")).body).toEqual({
        email: "ann@example.com",
        proven: true,
        pending: "ann@new.example",
      })
      expect((await signInAs("ann@example.com")).status).toBe(200)
      expect((await signInAs("ann@new.example")).status).toBe(401)
      // A code for the old address proves nothing now: the new one is the one to prove.
      const oldCode = await mailedCode(sql, "ann@example.com")
      expect((await ann("POST", "/email/verify", { code: oldCode })).body.outcome).toBe(
        EmailVerifyOutcome.WrongCode,
      )
    })

    await t.step("the new address's code moves the account onto it", async () => {
      const code = await mailedCode(sql, "ann@new.example", "ann@example.com")

      expect((await ann("POST", "/email/verify", { code })).body).toEqual({
        outcome: EmailVerifyOutcome.Verified,
      })
      expect((await ann("GET", "/email")).body).toEqual({
        email: "ann@new.example",
        proven: true,
        pending: null,
      })
      expect((await signInAs("ann@new.example")).status).toBe(200)
      expect((await signInAs("ann@example.com")).status).toBe(401)
      // The device that changed it carries on; every session on the old key ended.
      expect((await ann("GET", "/me")).status).toBe(200)
      expect((await otherDevice("GET", "/me")).status).toBe(401)
      const owners = await sql<{ email: string }[]>`SELECT email FROM auth_email_owners`
      expect(owners.map((row) => row.email)).toEqual(["ann@new.example"])
      const keys = await sql<{ method: string; subject: string }[]>`
        SELECT method, subject FROM auth_keys
      `
      expect(keys).toEqual([{ method: "password", subject: "ann@new.example" }])
    })

    await t.step("an address another account owns is refused, and the old one stays", async () => {
      await signedUp(signIn, "bea@example.com").then(async (bea) =>
        bea("POST", "/email/verify", { code: await mailedCode(sql, "bea@example.com") })
      )
      await ann("POST", "/email/change", { email: "bea@example.com", password: PASSWORD })
      const code = await mailedCode(sql, "bea@example.com", "ann@new.example")

      expect((await ann("POST", "/email/verify", { code })).body).toEqual({
        outcome: EmailVerifyOutcome.Taken,
      })
      expect((await ann("GET", "/email")).body).toEqual({
        email: "ann@new.example",
        proven: true,
        pending: null,
      })
      expect((await signInAs("bea@example.com")).status).toBe(200)
    })

    await t.step("a proven new address takes over an unproven claim to it", async () => {
      await signedUp(signIn, "cat@example.com")
      await ann("POST", "/email/change", { email: "cat@example.com", password: PASSWORD })
      const code = await mailedCode(sql, "cat@example.com", "ann@new.example")

      expect((await ann("POST", "/email/verify", { code })).body.outcome).toBe(
        EmailVerifyOutcome.Verified,
      )
      const keys = await sql<{ subject: string }[]>`
        SELECT subject FROM auth_keys WHERE subject = 'cat@example.com'
      `
      expect(keys).toHaveLength(1)
      expect((await ann("GET", "/email")).body.email).toBe("cat@example.com")
    })
  })
})

Deno.test("a reset link takes a squatted address back from its second factor", async (t) => {
  await withSchema(async (sql) => {
    const signIn = buildSignIn(sql)
    const db = new AppDbBase({ sql })

    /** An account with an authenticator app, as one made before this rule could have. */
    async function withAuthenticator(email: string): Promise<void> {
      await signedUp(signIn, email)
      const [key] = await sql<{ userId: number }[]>`
        SELECT user_id AS "userId" FROM auth_keys WHERE subject = ${email}
      `
      await sql`
        INSERT INTO user_totp (user_id, secret, confirmed_at)
        VALUES (${key.userId}, ${generateTotpSecret()}, now())
      `
      await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${key.userId}`
    }

    async function reset(email: string): Promise<void> {
      const issued = (await issuePasswordReset(db.authStore, email, new Date()))!
      expect(await signIn.resetPassword(email, issued.code, "N3w-Passw0rd")).toBe(true)
    }

    await t.step("the owner signs in without the squatter's second factor", async () => {
      await withAuthenticator("victim@example.com")

      await reset("victim@example.com")

      const answer = await client(signIn)("POST", "/sign-in", {
        login: "victim@example.com",
        password: "N3w-Passw0rd",
      })
      expect(answer.status).toBe(200)
      expect(answer.body.secondFactor).toBe(SecondFactorStatus.NotRequired)
      const [user] = await sql<{ mfa: number }[]>`
        SELECT mfa FROM users WHERE id = (
          SELECT user_id FROM auth_keys WHERE subject = 'victim@example.com'
        )
      `
      expect(user.mfa).toBe(UserMFAStatus.NOT_CONFIGURED)
      expect(await sql`SELECT 1 FROM user_totp`).toHaveLength(0)
    })

    await t.step("a reset of an address proven before keeps its second factor", async () => {
      await withAuthenticator("owner@example.com")
      const [key] = await sql<{ id: number }[]>`
        SELECT id FROM auth_keys WHERE subject = 'owner@example.com'
      `
      await db.authStore.proveKey(key.id, new Date())

      await reset("owner@example.com")

      const answer = await client(signIn)("POST", "/sign-in", {
        login: "owner@example.com",
        password: "N3w-Passw0rd",
      })
      expect(answer.status).toBe(200)
      expect(answer.body.secondFactor).toBe(SecondFactorStatus.Pending)
      expect(await sql`SELECT 1 FROM user_totp`).toHaveLength(1)
    })
  })
})

Deno.test("another account cannot spend this account's code", async (t) => {
  await withSchema(async (sql) => {
    const signIn = buildSignIn(sql)
    const ann = await signedUp(signIn, "ann@example.com")
    const bea = await signedUp(signIn, "bea@example.com")

    await t.step(
      "a change to the same address and five wrong guesses leave Ann's code working",
      async () => {
        const annCode = await mailedCode(sql, "ann@example.com")
        expect(
          (await bea("POST", "/email/change", {
            email: "ann@example.com",
            password: PASSWORD,
          })).body,
        ).toEqual({ outcome: EmailChangeOutcome.Requested })
        const beaCode = await mailedCode(sql, "ann@example.com", "bea@example.com")
        for (let guess = 0; guess < 5; guess++) {
          expect((await bea("POST", "/email/verify", { code: `wrong-${guess}` })).body)
            .toEqual({ outcome: EmailVerifyOutcome.WrongCode })
        }

        expect((await ann("POST", "/email/verify", { code: annCode })).body).toEqual({
          outcome: EmailVerifyOutcome.Verified,
        })
        expect((await bea("POST", "/email/verify", { code: beaCode })).body.outcome).toBe(
          EmailVerifyOutcome.WrongCode,
        )
      },
    )
  })
})

Deno.test("a username account and its second factor", async (t) => {
  await withSchema(async (sql) => {
    const signIn = buildSignIn(sql)
    await signedUp(signIn, "legacy@example.com")
    // What a username sign-up wrote before #139: the username as subject, and no address.
    await sql`
      UPDATE auth_keys SET subject = 'legacyuser', email = NULL WHERE subject = 'legacy@example.com'
    `
    const legacy = client(signIn)
    expect((await legacy("POST", "/sign-in", { login: "legacyuser", password: PASSWORD })).status)
      .toBe(200)

    await t.step("a username account may turn on an authenticator app", async () => {
      expect((await legacy("POST", "/totp/start")).body.qrcode).toContain("<svg")
      await sql`DELETE FROM user_totp`
    })

    await t.step("adding an address moves sign-in from the username to the address", async () => {
      await legacy("POST", "/email/change", { email: "legacy@new.example", password: PASSWORD })
      const code = await mailedCode(sql, "legacy@new.example", "legacyuser")

      expect((await legacy("POST", "/email/verify", { code })).body.outcome).toBe(
        EmailVerifyOutcome.Verified,
      )
      const signInAs = (login: string) =>
        client(signIn)("POST", "/sign-in", { login, password: PASSWORD })
      expect((await signInAs("legacy@new.example")).status).toBe(200)
      expect((await signInAs("legacyuser")).status).toBe(401)
    })
  })
})

Deno.test("a move keeps the second factor the session already gave", async (t) => {
  await withSchema(async (sql) => {
    const signIn = buildSignIn(sql)
    const ann = await signedUp(signIn, "ann@example.com")
    await ann("POST", "/email/verify", { code: await mailedCode(sql, "ann@example.com") })
    const { secret } = (await ann("POST", "/totp/start")).body
    const otp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate()
    expect((await ann("POST", "/totp/finish", { otp })).body).toEqual({ ok: true })

    await t.step("the device that moved the address stays past the second factor", async () => {
      await ann("POST", "/email/change", { email: "ann@new.example", password: PASSWORD })
      const code = await mailedCode(sql, "ann@new.example", "ann@example.com")

      expect((await ann("POST", "/email/verify", { code })).body.outcome).toBe(
        EmailVerifyOutcome.Verified,
      )
      expect((await ann("GET", "/me")).status).toBe(200)
      const sessions = await sql<{ secondFactor: number }[]>`
        SELECT second_factor AS "secondFactor" FROM auth_sessions
      `
      expect(sessions.map((row) => row.secondFactor)).toEqual([SecondFactorStatus.Completed])
    })
  })
})

Deno.test("a password reset and an address move of one account", async (t) => {
  await withSchema(async (sql) => {
    const signIn = buildSignIn(sql)
    const db = new AppDbBase({ sql })
    const NEW_PASSWORD = "N3w-Passw0rd"
    const signInAs = (login: string, password: string) =>
      client(signIn)("POST", "/sign-in", { login, password })

    /** A proven account for `email`, a change to `next` waiting, its code and a reset link. */
    async function moving(email: string, next: string) {
      const account = await signedUp(signIn, email)
      await account("POST", "/email/verify", { code: await mailedCode(sql, email) })
      await account("POST", "/email/change", { email: next, password: PASSWORD })
      const code = await mailedCode(sql, next, email)
      const link = (await issuePasswordReset(db.authStore, email, new Date()))!.code
      return { account, code, link }
    }

    /** How many statements of this database wait for a lock. */
    const waiting = async () =>
      (await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database()
      `)[0].n
    const untilWaiting = async (n: number) => {
      for (let poll = 0; poll < 100 && (await waiting()) < n; poll++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(await waiting()).toBe(n)
    }

    /**
     * Holds the password key of `email` while `first` and then `second` start, so both wait on it
     * in that order, then lets them go. Returns what each answered.
     */
    async function inFlight<A, B>(
      email: string,
      first: () => Promise<A>,
      second: () => Promise<B>,
    ): Promise<[A, B]> {
      let started: [Promise<A>, Promise<B>] | null = null
      await sql.begin(async (hold) => {
        await hold`SELECT 1 FROM auth_keys WHERE subject = ${email} FOR UPDATE`
        const a = first()
        await untilWaiting(1)
        const b = second()
        await untilWaiting(2)
        started = [a, b]
      })
      const [a, b] = started!
      return [await a, await b]
    }

    await t.step("a reset drops the address change waiting for its code", async () => {
      const { account, link } = await moving("ann@example.com", "ann@new.example")

      expect(await signIn.resetPassword("ann@example.com", link, NEW_PASSWORD)).toBe(true)

      expect(await sql`SELECT 1 FROM email_changes`).toHaveLength(0)
      expect((await account("GET", "/me")).status).toBe(401)
      expect((await signInAs("ann@example.com", NEW_PASSWORD)).status).toBe(200)
    })

    await t.step("a reset that runs first keeps its password and refuses the move", async () => {
      const { account, code, link } = await moving("bea@example.com", "bea@new.example")

      const [reset, moved] = await inFlight(
        "bea@example.com",
        () => signIn.resetPassword("bea@example.com", link, NEW_PASSWORD),
        () => account("POST", "/email/verify", { code }),
      )

      expect(reset).toBe(true)
      expect(moved.body.outcome).toBe(EmailVerifyOutcome.NothingToVerify)
      expect((await signInAs("bea@example.com", NEW_PASSWORD)).status).toBe(200)
      expect((await signInAs("bea@new.example", PASSWORD)).status).toBe(401)
    })

    await t.step(
      "a move that runs first wins, and the reset for the old address is refused",
      async () => {
        const { account, code, link } = await moving("cat@example.com", "cat@new.example")

        const [moved, reset] = await inFlight(
          "cat@example.com",
          () => account("POST", "/email/verify", { code }),
          () => signIn.resetPassword("cat@example.com", link, NEW_PASSWORD),
        )

        expect(moved.body.outcome).toBe(EmailVerifyOutcome.Verified)
        expect(reset).toBe(false)
        expect((await signInAs("cat@new.example", PASSWORD)).status).toBe(200)
        expect((await signInAs("cat@example.com", NEW_PASSWORD)).status).toBe(401)
      },
    )
  })
})

Deno.test("checking a password accepts only the account's current one", async () => {
  await withSchema(async (sql) => {
    const signIn = buildSignIn(sql)
    const ann = await signedUp(signIn, "ann@example.com")
    const annId = (await ann("GET", "/me")).body.id as number

    expect(await signIn.checkPassword(annId, PASSWORD)).toBe(true)
    expect(await signIn.checkPassword(annId, "wrong-password")).toBe(false)
    // An account with no password key is refused rather than let through.
    await sql`DELETE FROM auth_keys WHERE user_id = ${annId}`
    expect(await signIn.checkPassword(annId, PASSWORD)).toBe(false)
  })
})
