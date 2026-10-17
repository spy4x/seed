/// <reference lib="deno.ns" />
/**
 * Seeds a development database with a small, neutral demo data set: a user who signs in as
 * `demo@example.com` (with the first group every sign-up gets, named `Personal`) and owns a second
 * group, `Demo team`. The demo user is an administrator, so it signs in to the admin app (#146).
 *
 * Usage, after `deno task db:migrate`, with the same `DB_*` values:
 * `ENV=dev DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=… DB_PASS=… DB_NAME=… AUTH_PEPPER=…
 * SEED_PASSWORD=… deno task db:seed`
 *
 * - `AUTH_PEPPER` must be the API's own, or the demo user cannot sign in: it is part of every
 *   password hash.
 * - `SEED_PASSWORD` is the demo user's password, 8 to 50 characters like any sign-up.
 *
 * The user is created through the API's own sign-up (`createSignIn`), so the auth user, password
 * key, profile and first group are written exactly as a real sign-up writes them. The session
 * that sign-up opens is signed out at once, and the address is marked proven, as a finished
 * sign-up leaves it. Running the seed again makes the demo user an administrator again and marks
 * their address proven if it is not yet: it looks the address up first and writes nothing else
 * when the user exists. When sign-up refuses a user that does not
 * exist, the seed fails instead of reporting success. It runs only when `ENV` is `dev`, the same
 * rule as `db:reset`, so no production database gets a demo account with a known password.
 *
 * @module
 */

import { Hono } from "hono"
import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import { authPasswordSchema, UserRole } from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * The address the demo user signs in with, on a domain reserved for examples (RFC 2606). Written
 * as sign-up stores it (trimmed, lower case), so the lookup before sign-up finds it.
 */
export const DEMO_EMAIL = "demo@example.com"
/** The name of the shared group the demo user owns. */
export const DEMO_GROUP_NAME = "Demo team"

/** Who the audit row of the demo user's role names (#425). */
export const SEED_ACTOR = "seed"

/** What the seed needs besides the database connection. */
export interface SeedOptions {
  pepper: string
  password: string
}

/** Raised when an environment variable the seed needs is missing or invalid. Never has a value. */
export class SeedConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SeedConfigError"
  }
}

/** Raised when sign-up refuses to create the demo user although no such user exists. */
export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SeedRefusedError"
  }
}

/**
 * Reads and checks `AUTH_PEPPER` and `SEED_PASSWORD`, with the API's rules for each, and refuses
 * to seed unless `ENV` is `dev`. `db:reset` calls it before it drops anything.
 *
 * @throws {SeedConfigError} When `ENV` is not `dev`, or a variable is missing or breaks its rule.
 */
export function readSeedOptions(env: Record<string, string | undefined>): SeedOptions {
  if (env.ENV !== "dev") {
    throw new SeedConfigError("ENV must be dev: the demo user is for development databases only")
  }
  const pepper = env.AUTH_PEPPER ?? ""
  if (pepper.length < 32) {
    throw new SeedConfigError("AUTH_PEPPER must be set to the API's value (32 characters or more)")
  }
  const password = env.SEED_PASSWORD ?? ""
  if (!authPasswordSchema.allows({ password })) {
    throw new SeedConfigError("SEED_PASSWORD must be set, 8 to 50 characters")
  }
  return { pepper, password }
}

/**
 * Creates the demo data and makes the demo user an administrator. `false` when the demo user
 * already exists: then only the role is written, and the address is marked proven if it is not.
 *
 * @throws {SeedRefusedError} When the user does not exist and sign-up still refuses to create it.
 */
export async function seed(db: AppDbBase, options: SeedOptions): Promise<boolean> {
  // Sign-up answers `null` for a taken address and for a refused one alike, so "exists already"
  // is decided here, not from its answer.
  if (await db.authStore.findKey(PASSWORD_METHOD, DEMO_EMAIL)) {
    // A demo user seeded before #411 has an unproven address; a rerun proves it.
    await proveDemoAddress(db)
    await db.admin.setRoleByAddress(DEMO_EMAIL, UserRole.ADMIN, SEED_ACTOR)
    return false
  }
  const signIn = createSignIn({
    db,
    pepper: options.pepper,
    // The session cookie never leaves this process, so any secret signs it.
    cookieSecret: crypto.randomUUID() + crypto.randomUUID(),
    secureCookie: false,
    sessionMinutes: 1,
    totpIssuer: "seed",
  })
  // Sign-up sets a cookie, so it runs inside a request. Hono would answer a throw with a 500, so
  // the error is kept and rethrown here.
  let userId: number | null = null
  let failure: unknown = null
  const app = new Hono().post("/", async (c) => {
    try {
      userId = (await signIn.signUp(c, DEMO_EMAIL, options.password))?.user.id ?? null
    } catch (error) {
      failure = error
    }
    return c.body(null, 204)
  })
  await app.request("/", { method: "POST" })
  if (failure) throw failure
  if (userId === null) {
    throw new SeedRefusedError(`sign-up refused to create the user "${DEMO_EMAIL}"`)
  }

  await db.sessionStore.signOutUser(userId, null)
  await proveDemoAddress(db)
  await db.group.create({ id: uuidV7(), name: DEMO_GROUP_NAME }, userId)
  await db.admin.setRoleByAddress(DEMO_EMAIL, UserRole.ADMIN, SEED_ACTOR)
  return true
}

/**
 * Marks the demo user's address proven, as a finished sign-up leaves it: an account with an
 * unproven address cannot invite (#411). Does nothing when it is proven already.
 */
async function proveDemoAddress(db: AppDbBase): Promise<void> {
  const key = await db.authStore.findKey(PASSWORD_METHOD, DEMO_EMAIL)
  if (key && key.provenAt === null) await db.authStore.proveKey(key.id, new Date())
}

async function main(): Promise<void> {
  const env = Deno.env.toObject()
  let options: SeedOptions
  try {
    options = readSeedOptions(env)
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`)
    Deno.exit(1)
  }
  // Column names are camelCase in code, as in apps/api/services/db.ts.
  const sql = createSqlFromEnv(env, { transform: postgres.camel, max: 2 })
  if (!sql) {
    console.error("❌ Missing environment variable: DB_HOST")
    Deno.exit(1)
  }
  try {
    const created = await seed(new AppDbBase({ sql }), options)
    console.log(
      created
        ? `✅ Seeded user "${DEMO_EMAIL}" and shared group "${DEMO_GROUP_NAME}".`
        : `✅ User "${DEMO_EMAIL}" exists already. Nothing to seed.`,
    )
  } catch (error) {
    if (!(error instanceof SeedRefusedError)) throw error
    console.error(`❌ ${error.message}`)
    Deno.exitCode = 1
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (import.meta.main) await main()
