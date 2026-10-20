import type postgres from "postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { ADMIN_MIN_ROLE } from "@domain/identity"
import { DEMO_USER_EMAIL } from "@server/auth/demo-accounts.ts"
import { scheduleNightlyJobs } from "@server/jobs/wiring.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import { AppDbBase } from "../../api/services/db-base.ts"
import type { SeedOptions } from "./options.ts"
import { demoDay } from "./reset.ts"
import { seedDemo } from "./seed.ts"
import { wipeDatabase } from "./wipe.ts"

/**
 * Whether the demo is seeded: the demo user exists and nobody holds an operator role or higher.
 * The public demo has no operator, so one found here (an account left by an older seed, whose
 * password is public) makes the worker wipe and seed again on its next check.
 */
export async function isDemoSeeded(sql: postgres.Sql): Promise<boolean> {
  const rows = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM auth_keys WHERE method = ${PASSWORD_METHOD} AND subject = ${DEMO_USER_EMAIL}
      ) AS "demo",
      EXISTS (SELECT 1 FROM users WHERE role >= ${ADMIN_MIN_ROLE}) AS "operator"
  `
  return rows[0].demo === true && rows[0].operator === false
}

/**
 * Wipes the database and seeds the demo again, with fake data picked by the demo's date, so each
 * day looks a little different. The wipe empties the outbox too, so the nightly cleanup is
 * scheduled again. A failure part-way is tried again on the next check. A worker that restarts
 * in between finds the demo user and keeps the half-seeded demo until the next midnight.
 */
export async function resetDemo(
  sql: postgres.Sql,
  options: SeedOptions & { subscribers: SubscribersSetup | null },
  now = new Date(),
): Promise<void> {
  await wipeDatabase(sql)
  const dataSeed = Number(demoDay(now).replaceAll(`-`, ``))
  await seedDemo(new AppDbBase({ sql }), sql, { ...options, dataSeed, operator: false })
  await scheduleNightlyJobs(sql, now)
}
