import type postgres from "postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { DEMO_USER_EMAIL } from "@server/auth/demo-accounts.ts"
import { scheduleNightlyJobs } from "@server/jobs/wiring.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import { AppDbBase } from "../../api/services/db-base.ts"
import type { SeedOptions } from "./options.ts"
import { demoDay } from "./reset.ts"
import { seedDemo } from "./seed.ts"
import { wipeDatabase } from "./wipe.ts"

/** Whether the demo user exists: the demo is seeded. */
export async function isDemoSeeded(sql: postgres.Sql): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM auth_keys WHERE method = ${PASSWORD_METHOD} AND subject = ${DEMO_USER_EMAIL}
  `
  return rows.length > 0
}

/**
 * Wipes the database and seeds the demo again, with fake data picked by the demo's date, so each
 * day looks a little different. The wipe empties the outbox too, so the nightly cleanup is
 * scheduled again. A failure part-way leaves the demo missing, and the next check runs it again.
 */
export async function resetDemo(
  sql: postgres.Sql,
  options: SeedOptions & { subscribers: SubscribersSetup | null },
  now = new Date(),
): Promise<void> {
  await wipeDatabase(sql)
  const dataSeed = Number(demoDay(now).replaceAll(`-`, ``))
  await seedDemo(new AppDbBase({ sql }), sql, { ...options, dataSeed })
  await scheduleNightlyJobs(sql, now)
}
