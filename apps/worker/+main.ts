/// <reference lib="deno.ns" />
import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import { createOutboxProcessor, scheduleNightlyJobs } from "@server/jobs/wiring.ts"
import { PostgresIdempotencyStore } from "@spy4x/server/idempotency"
import { startIdempotencySweep } from "./idempotency-sweep.ts"
import { shutdownSignal, ShutdownSignalError } from "@spy4x/platform/server/shutdown-signal"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { createMailSender, mailOffWarning, readMailSetup } from "@server/mail/mail.ts"
import { systemEnv } from "@spy4x/server/config"
import { readSubscribersSetup, subscribersOffWarning } from "@server/subscribers/subscribers.ts"
// The API's own reading of the billing variables, so both processes run one provider.
import { readBillingSetup } from "@server/billing/setup.ts"

const sql = createSqlFromEnv(Deno.env.toObject(), {
  transform: postgres.camel,
  applicationName: "app-backend",
  // The driver's own default (postgres@3.4.7 src/index.js:449) was 10, not the
  // package's default of 15; compose limits Postgres to max_connections=30 and both
  // this pool and the api's draw from it, so the old ceiling is kept explicitly.
  max: 10,
})
if (!sql) {
  console.error("❌ Missing environment variable: DB_HOST")
  Deno.exit(1)
}

// Aborts once, on the first SIGINT or SIGTERM, and removes both listeners itself.
const signal = shutdownSignal()

console.log("Worker started")

// Mail goes out from here, never from the API: a reset link is made and sent in one step.
const domain = Deno.env.get("DOMAIN")
if (!domain) {
  console.error("❌ Missing environment variable: DOMAIN")
  Deno.exit(1)
}
const mailSetup = readMailSetup(Deno.env)
const mailWarning = mailOffWarning(mailSetup)
if (mailWarning) console.warn(mailWarning)

// The worker signs the subscriber links it mails; the API checks them with the same secrets.
const subscribersSetup = readSubscribersSetup(
  Deno.env,
  Deno.env.get("ENV") === "dev" ? "dev" : "prod",
)
const subscribersWarning = subscribersOffWarning(subscribersSetup)
if (subscribersWarning) console.warn(subscribersWarning)

// A per-member subscription's quantity is changed from here, through the outbox, so a provider
// that is down never holds a new member back. A setup that cannot run stops the worker, as it stops
// the API. The worker verifies no webhook, so it neither needs nor reads the webhook secret.
const billingSetup = readBillingSetup(systemEnv, Deno.env.get("ENV") === "dev" ? "dev" : "prod", {
  webhooks: false,
})

// A committed group change is announced on a Postgres channel; the API process, which holds the
// sockets, turns it into a hint for the group's members. The same table holds jobs: a row that
// belongs to no group and runs when its time has come.
const processor = createOutboxProcessor(
  sql,
  {
    store: createPostgresAuthStore(sql),
    sender: createMailSender(mailSetup, sql),
    // The API's own rule (apps/api/services/config.ts): plain HTTP only in development.
    brand: { webAppUrl: `http${Deno.env.get("ENV") === "dev" ? "" : "s"}://${domain}` },
    log: (line) => console.error(line),
  },
  billingSetup.provider,
  subscribersSetup,
  billingSetup.graceDays,
)

// Starts the nightly chain the first time; a restart finds the row and adds nothing.
await scheduleNightlyJobs(sql)

/** How often the outbox is looked at when it is empty; the delay before a push. */
const OUTBOX_IDLE_MS = 250
const SWEEP_INTERVAL_MS = 60 * 60_000

const idempotencyKeys = new PostgresIdempotencyStore(sql)

/** Removes idempotency keys past their retention. */
async function sweepIdempotencyKeys(): Promise<void> {
  const removed = await idempotencyKeys.sweep()
  if (removed > 0) console.log(`Swept ${removed} expired idempotency key(s)`)
}

function reportSweepFailure(error: unknown): void {
  console.error("Idempotency sweep failed, retrying next interval", error)
}

try {
  await Promise.all([
    processor.run(signal, OUTBOX_IDLE_MS),
    startIdempotencySweep({
      signal,
      sweep: sweepIdempotencyKeys,
      onError: reportSweepFailure,
      intervalMs: SWEEP_INTERVAL_MS,
    }),
  ])
} finally {
  await sql.end({ timeout: 5 })
  const reason = signal.reason instanceof ShutdownSignalError ? ` on ${signal.reason.signal}` : ""
  console.log(`Worker stopped${reason}`)
}
