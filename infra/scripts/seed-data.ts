/// <reference lib="deno.ns" />
/**
 * Seeds a database with the demo data (docs/demo.md): the shared account `demo@example.com`, a
 * plain user, and in development (`ENV=dev`) also `admin@example.com`, an administrator who signs
 * in to the admin app, both with `SEED_PASSWORD` and no second factor, plus fake people, groups, tags, notes, invitations and
 * newsletter subscribers. The public demo's worker runs the same seed after its nightly wipe.
 *
 * Usage, after `deno task db:migrate`, with the same `DB_*` values:
 * `ENV=dev DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=… DB_PASS=… DB_NAME=… AUTH_PEPPER=…
 * SEED_PASSWORD=… deno task db:seed`
 *
 * - `AUTH_PEPPER` must be the API's own, or the accounts cannot sign in: it is part of every
 *   password hash.
 * - `SEED_PASSWORD` is the shared password, 8 to 50 characters like any sign-up.
 * - `SUBSCRIBERS_SECRET`, when set, keys the fake subscribers; development uses its own default.
 *
 * Running it again writes nothing but the accounts' roles and proven addresses. It runs only
 * when `ENV` is `dev` or `DEMO_MODE` is `true` (`readSeedOptions`), so no product's database gets
 * an account with a published password.
 *
 * @module
 */

import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import { readSubscribersSetup } from "@server/subscribers/subscribers.ts"
import { DEMO_USER_EMAIL, DEV_ADMIN_EMAIL } from "@server/auth/demo-accounts.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { readSeedOptions, type SeedOptions } from "../../apps/worker/demo/options.ts"
import { seedDemo, SeedRefusedError } from "../../apps/worker/demo/seed.ts"

export { readSeedOptions, SeedConfigError } from "../../apps/worker/demo/options.ts"

/** The fake data a development seed uses, so every developer sees the same names. */
export const DEV_DATA_SEED = 1

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
    console.error(`❌ Missing environment variable: DB_HOST`)
    Deno.exit(1)
  }
  try {
    const subscribers = readSubscribersSetup(Deno.env, env.ENV === `dev` ? `dev` : `prod`)
    const created = await seedDemo(new AppDbBase({ sql }), sql, {
      ...options,
      dataSeed: DEV_DATA_SEED,
      subscribers,
      // The public demo has no administrator: its password would be public (docs/demo.md).
      operator: env.ENV === `dev`,
    })
    console.log(
      created
        ? `✅ Seeded "${DEMO_USER_EMAIL}"${
          env.ENV === `dev` ? `, "${DEV_ADMIN_EMAIL}"` : ``
        } and the fake data.`
        : `✅ "${DEMO_USER_EMAIL}" exists already. Nothing else to seed.`,
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
