import type postgres from "postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { randomBase64Url } from "@spy4x/platform/tokens"
import { ADMIN_MIN_ROLE, UserRole } from "@domain/identity"
import { DEV_ADMIN_EMAIL } from "@server/auth/demo-accounts.ts"
import { startRepeatingJobs } from "@server/jobs/wiring.ts"
import { queueDueBlogJobs } from "@server/blog/blog-publish-job.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import { AppDbBase } from "../../api/services/db-base.ts"
import type { DemoAdmin } from "./options.ts"
import { demoDataSeed } from "./reset.ts"
import { createAdmin, populationMarker, seedDemo } from "./seed.ts"
import { wipeDatabase } from "./wipe.ts"

/**
 * Whether the demo is seeded for the demo's date at `now`: the population's first fake person
 * exists and nobody holds an operator role or higher. The public demo has no operator, so one
 * found here (an account left by an older seed, whose password is public) makes the worker wipe
 * and seed again on its next check.
 *
 * With `privateAdmin` (`DEMO_ADMIN_PASSWORD` is set, docs/demo.md), {@link DEV_ADMIN_EMAIL} must
 * be an administrator too, and is the one operator allowed; any other still makes it `false`.
 */
export async function isDemoSeeded(
  sql: postgres.Sql,
  now = new Date(),
  privateAdmin = false,
): Promise<boolean> {
  const marker = populationMarker(demoDataSeed(now))
  // `NULL` matches no key, so without the private administrator nobody is set apart.
  const admin = privateAdmin ? DEV_ADMIN_EMAIL : null
  const rows = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM auth_keys WHERE method = ${PASSWORD_METHOD} AND subject = ${marker}
      ) AS "seeded",
      EXISTS (
        SELECT 1 FROM users u WHERE u.role >= ${ADMIN_MIN_ROLE} AND NOT EXISTS (
          SELECT 1 FROM auth_keys k
          WHERE k.user_id = u.id AND k.method = ${PASSWORD_METHOD} AND k.subject = ${admin}
        )
      ) AS "operator",
      EXISTS (
        SELECT 1 FROM users u JOIN auth_keys k ON k.user_id = u.id
        WHERE k.method = ${PASSWORD_METHOD} AND k.subject = ${admin} AND u.role = ${UserRole.ADMIN}
      ) AS "admin"
  `
  const [row] = rows
  return row.seeded === true && row.operator === false && (!privateAdmin || row.admin === true)
}

/**
 * Wipes the database and seeds the demo again, with fake data picked by the demo's date, so each
 * day looks a little different. With `admin`, the owner's private administrator is created first,
 * hashed with the API's pepper so it signs in; the seed adds no operator history or backup for
 * it, so the admin panel shows the demo as it is. The wipe empties the outbox too, so
 * the nightly cleanup is scheduled again. A failure part-way is tried again on the next check. A
 * worker that restarts in between finds the population and keeps the half-seeded demo until the
 * next midnight, unless the private administrator is missing.
 */
export async function resetDemo(
  sql: postgres.Sql,
  options: { subscribers: SubscribersSetup | null; admin: DemoAdmin | null },
  now = new Date(),
): Promise<void> {
  await wipeDatabase(sql)
  const db = new AppDbBase({ sql })
  // Right after the wipe, so a visitor has only that moment to sign up as the address first.
  if (options.admin) await createAdmin(db, sql, options.admin.pepper, options.admin.password)
  await seedDemo(db, sql, {
    // Nobody signs in as a fake person, so the pepper that hashes their passwords is random too.
    pepper: randomBase64Url(32),
    adminPassword: null,
    dataSeed: demoDataSeed(now),
    subscribers: options.subscribers,
    now,
  })
  await startRepeatingJobs(sql, now)
  // The wipe keeps the blog but empties the job table: scheduled posts get their jobs back.
  await queueDueBlogJobs(sql)
}
