import type postgres from "postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { randomBase64Url } from "@spy4x/platform/tokens"
import { ADMIN_MIN_ROLE, UserRole } from "@domain/identity"
import { DEV_ADMIN_EMAIL, PUBLIC_DEMO_ADMIN } from "@server/auth/demo-accounts.ts"
import { startRepeatingJobs } from "@server/jobs/wiring.ts"
import { queueDueBlogJobs } from "@server/blog/blog-publish-job.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import type { NotesSetup } from "@server/notes/setup.ts"
import { AppDbBase } from "../../api/services/db-base.ts"
import type { DemoAdmins } from "./options.ts"
import { demoDataSeed } from "./reset.ts"
import { createAdmin, populationMarker, seedDemo } from "./seed.ts"
import { wipeDatabase } from "./wipe.ts"

/** Which administrators the demo must have (docs/demo.md); every other operator is unwanted. */
export interface DemoAccounts {
  /** The owner's private administrator, {@link DEV_ADMIN_EMAIL} (`DEMO_ADMIN_PASSWORD` is set). */
  privateAdmin: boolean
  /** The visitors' administrator, {@link PUBLIC_DEMO_ADMIN}. */
  publicAdmin: boolean
}

/**
 * Whether the demo is seeded for the demo's date at `now`: the population's first fake person
 * exists, each administrator `accounts` names is an administrator, and nobody else holds an
 * operator role or higher. Any other operator (an account left by an older seed, or one a visitor
 * promoted) makes the worker wipe and seed again on its next check.
 */
export async function isDemoSeeded(
  sql: postgres.Sql,
  now = new Date(),
  accounts: DemoAccounts = { privateAdmin: false, publicAdmin: false },
): Promise<boolean> {
  const marker = populationMarker(demoDataSeed(now))
  const admins = [
    ...(accounts.privateAdmin ? [DEV_ADMIN_EMAIL] : []),
    ...(accounts.publicAdmin ? [PUBLIC_DEMO_ADMIN.email] : []),
  ]
  // An empty string is no address, so with no administrator nobody is set apart.
  const allowed = admins.length > 0 ? admins : [``]
  const rows = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM auth_keys WHERE method = ${PASSWORD_METHOD} AND subject = ${marker}
      ) AS "seeded",
      EXISTS (
        SELECT 1 FROM users u WHERE u.role >= ${ADMIN_MIN_ROLE} AND NOT EXISTS (
          SELECT 1 FROM auth_keys k
          WHERE k.user_id = u.id AND k.method = ${PASSWORD_METHOD} AND k.subject IN ${sql(allowed)}
        )
      ) AS "operator",
      (
        SELECT COUNT(DISTINCT k.subject)::int FROM users u JOIN auth_keys k ON k.user_id = u.id
        WHERE k.method = ${PASSWORD_METHOD} AND k.subject IN ${sql(allowed)}
          AND u.role = ${UserRole.ADMIN}
      ) AS "admins"
  `
  const [row] = rows
  return row.seeded === true && row.operator === false && row.admins === admins.length
}

/**
 * Wipes the database and seeds the demo again, with fake data picked by the demo's date, so each
 * day looks a little different. With `admins`, the visitors' administrator ({@link PUBLIC_DEMO_ADMIN})
 * is created first, and the owner's private one when its password is set, each hashed with the
 * API's pepper so it signs in; the seed adds no operator history or backup for them, so the admin
 * panel shows the demo as it is. The wipe empties the outbox too, so
 * the nightly cleanup is scheduled again. A failure part-way is tried again on the next check. A
 * worker that restarts in between finds the population and keeps the half-seeded demo until the
 * next midnight, unless an administrator is missing. With `notes` off (`NOTES=false`), the seed
 * writes no notes, tags or attachments; on by default.
 */
export async function resetDemo(
  sql: postgres.Sql,
  options: { subscribers: SubscribersSetup | null; admins: DemoAdmins | null; notes?: NotesSetup },
  now = new Date(),
): Promise<void> {
  await wipeDatabase(sql)
  const db = new AppDbBase({ sql })
  // A visitor cannot take a seeded address in between: every way in that claims one waits for a
  // code or a link mailed to it, or for Google or GitHub to vouch for it, and `example.com` takes
  // no mail (docs/demo.md).
  const { admins } = options
  if (admins) {
    await createAdmin(db, sql, admins.pepper, PUBLIC_DEMO_ADMIN.password, PUBLIC_DEMO_ADMIN)
    if (admins.privatePassword) await createAdmin(db, sql, admins.pepper, admins.privatePassword)
  }
  await seedDemo(db, sql, {
    // Nobody signs in as a fake person, so the pepper that hashes their passwords is random too.
    pepper: randomBase64Url(32),
    adminPassword: null,
    dataSeed: demoDataSeed(now),
    subscribers: options.subscribers,
    now,
    notes: options.notes,
  })
  await startRepeatingJobs(sql, now)
  // The wipe keeps the blog but empties the job table: scheduled posts get their jobs back.
  await queueDueBlogJobs(sql)
}
