import type postgres from "postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { randomBase64Url } from "@spy4x/platform/tokens"
import { ADMIN_MIN_ROLE } from "@domain/identity"
import { scheduleNightlyJobs } from "@server/jobs/wiring.ts"
import { queueDueBlogJobs } from "@server/blog/blog-publish-job.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import { AppDbBase } from "../../api/services/db-base.ts"
import { demoDataSeed } from "./reset.ts"
import { populationMarker, seedDemo } from "./seed.ts"
import { wipeDatabase } from "./wipe.ts"

/**
 * Whether the demo is seeded for the demo's date at `now`: the population's first fake person
 * exists and nobody holds an operator role or higher. The public demo has no operator, so one
 * found here (an account left by an older seed, whose password is public) makes the worker wipe
 * and seed again on its next check.
 */
export async function isDemoSeeded(sql: postgres.Sql, now = new Date()): Promise<boolean> {
  const marker = populationMarker(demoDataSeed(now))
  const rows = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM auth_keys WHERE method = ${PASSWORD_METHOD} AND subject = ${marker}
      ) AS "seeded",
      EXISTS (SELECT 1 FROM users WHERE role >= ${ADMIN_MIN_ROLE}) AS "operator"
  `
  return rows[0].seeded === true && rows[0].operator === false
}

/**
 * Wipes the database and seeds the demo again, with fake data picked by the demo's date, so each
 * day looks a little different. The wipe empties the outbox too, so the nightly cleanup is
 * scheduled again. A failure part-way is tried again on the next check. A worker that restarts
 * in between finds the population and keeps the half-seeded demo until the next midnight.
 */
export async function resetDemo(
  sql: postgres.Sql,
  options: { subscribers: SubscribersSetup | null },
  now = new Date(),
): Promise<void> {
  await wipeDatabase(sql)
  await seedDemo(new AppDbBase({ sql }), sql, {
    // Nobody signs in as a fake person, so the pepper that hashes their passwords is random too.
    pepper: randomBase64Url(32),
    adminPassword: null,
    dataSeed: demoDataSeed(now),
    subscribers: options.subscribers,
    now,
  })
  await scheduleNightlyJobs(sql, now)
  // The wipe keeps the blog but empties the job table: scheduled posts get their jobs back.
  await queueDueBlogJobs(sql)
}
