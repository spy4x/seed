/// <reference lib="deno.ns" />
/**
 * Seeds a database with the demo's population (docs/demo.md): fake people with months of history,
 * groups, tags, notes, invitations, subscriptions and the newsletter. In development (`ENV=dev`) it
 * also adds `admin@example.com`, an administrator who signs in to the admin app with
 * `SEED_PASSWORD` and no second factor, with what an operator did and a finished backup, and three
 * blog posts by them: a draft, a scheduled one and a published one (`SAMPLE_POSTS`). The public
 * demo's worker runs the same seed after its nightly wipe, without the administrator and the
 * posts.
 *
 * Usage, after `deno task db:migrate`, with the same `DB_*` values:
 * `ENV=dev DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=… DB_PASS=… DB_NAME=… AUTH_PEPPER=…
 * SEED_PASSWORD=… deno task db:seed`
 *
 * - `AUTH_PEPPER` must be the API's own, or the administrator cannot sign in: it is part of every
 *   password hash.
 * - `SEED_PASSWORD` is the administrator's password, 8 to 50 characters like any sign-up.
 * - `SUBSCRIBERS_SECRET`, when set, keys the fake subscribers; development uses its own default.
 *
 * Running it again writes nothing but the administrator's role and proven address. It runs only
 * when `ENV` is `dev` or `DEMO_MODE` is `true` (`readSeedOptions`), so no product's database gets
 * an account with a published password.
 *
 * @module
 */

import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import { readSubscribersSetup } from "@server/subscribers/subscribers.ts"
import { DEV_ADMIN_EMAIL } from "@server/auth/demo-accounts.ts"
import { seedSamplePosts } from "@server/blog/sample-posts.ts"
import { seedSampleContactLinks } from "@server/contact-links/sample-links.ts"
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
    const dev = env.ENV === `dev`
    const subscribers = readSubscribersSetup(Deno.env, dev ? `dev` : `prod`)
    const created = await seedDemo(new AppDbBase({ sql }), sql, {
      pepper: options.pepper,
      // The public demo has no administrator: its password would be public (docs/demo.md).
      adminPassword: dev ? options.password : null,
      dataSeed: DEV_DATA_SEED,
      subscribers,
    })
    if (dev) {
      const [key] = await sql<{ userId: number }[]>`
        SELECT user_id FROM auth_keys WHERE method = 'password' AND subject = ${DEV_ADMIN_EMAIL}
      `
      if (key) await seedSamplePosts(sql, key.userId)
      await seedSampleContactLinks(sql)
    }
    const admin = dev ? `"${DEV_ADMIN_EMAIL}" is ready. ` : ``
    console.log(`✅ ${admin}${created ? `Seeded the fake data.` : `The fake data exists already.`}`)
  } catch (error) {
    if (!(error instanceof SeedRefusedError)) throw error
    console.error(`❌ ${error.message}`)
    Deno.exitCode = 1
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (import.meta.main) await main()
