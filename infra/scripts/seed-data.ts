/// <reference lib="deno.ns" />
/**
 * Seeds a development database with a small, neutral demo data set: a user `demo` (with the
 * first group every sign-up gets, named `Personal`) who owns a second group, `Demo team`.
 *
 * Usage, after `deno task db:migrate`, with the same `DB_*` values:
 * `DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=… DB_PASS=… DB_NAME=… AUTH_PEPPER=… SEED_PASSWORD=…
 * deno task db:seed`
 *
 * - `AUTH_PEPPER` must be the API's own, or the demo user cannot sign in: it is part of every
 *   password hash.
 * - `SEED_PASSWORD` is the demo user's password, 8 to 50 characters like any sign-up.
 *
 * The user is created through the API's own sign-up (`createSignIn`), so the auth user, password
 * key, profile and first group are written exactly as a real sign-up writes them. The session
 * that sign-up opens is signed out at once. Running the seed again changes nothing: it stops when
 * `demo` exists. It refuses to run when `ENV` is `prod`, so no production database gets a
 * `demo` account with a known password.
 *
 * @module
 */

import { Hono } from "hono"
import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import { authPasswordSchema } from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The demo user's username. */
export const DEMO_USERNAME = "demo"
/** The name of the shared group the demo user owns. */
export const DEMO_GROUP_NAME = "Demo team"

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

/**
 * Reads and checks `AUTH_PEPPER` and `SEED_PASSWORD`, with the API's rules for each, and refuses
 * to seed when `ENV` is `prod`.
 *
 * @throws {SeedConfigError} When `ENV` is `prod`, or a variable is missing or breaks its rule.
 */
export function readSeedOptions(env: Record<string, string | undefined>): SeedOptions {
  if (env.ENV === "prod") {
    throw new SeedConfigError("ENV is prod: the demo user is for development databases only")
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

/** Creates the demo data. `false` when the demo user already exists and nothing was written. */
export async function seed(db: AppDbBase, options: SeedOptions): Promise<boolean> {
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
      userId = (await signIn.signUp(c, DEMO_USERNAME, options.password))?.user.id ?? null
    } catch (error) {
      failure = error
    }
    return c.body(null, 204)
  })
  await app.request("/", { method: "POST" })
  if (failure) throw failure
  if (userId === null) return false

  await db.sessionStore.signOutUser(userId, null)
  await db.group.create({ id: uuidV7(), name: DEMO_GROUP_NAME }, userId)
  return true
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
        ? `✅ Seeded user "${DEMO_USERNAME}" and shared group "${DEMO_GROUP_NAME}".`
        : `✅ User "${DEMO_USERNAME}" exists already. Nothing to seed.`,
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (import.meta.main) await main()
