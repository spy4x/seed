/// <reference lib="deno.ns" />
import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import { createOutboxProcessor, startRepeatingJobs } from "@server/jobs/wiring.ts"
import { TelegramClient } from "@spy4x/integrations/telegram"
import { readTelegramSetup } from "@server/telegram/setup.ts"
import { queueDueBlogJobs } from "@server/blog/blog-publish-job.ts"
import { PostgresIdempotencyStore } from "@spy4x/server/idempotency"
import { startIdempotencySweep } from "./idempotency-sweep.ts"
import { shutdownSignal, ShutdownSignalError } from "@spy4x/platform/server/shutdown-signal"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { createMailSender, mailOffWarning, readMailSetup } from "@server/mail/mail.ts"
import { systemEnv } from "@spy4x/server/config"
import { readSubscribersSetup, subscribersOffWarning } from "@server/subscribers/subscribers.ts"
// The API's own reading of the billing variables, so both processes run one provider.
import { readBillingSetup } from "@server/billing/setup.ts"
import { isDemoMode } from "@server/auth/demo-accounts.ts"
import { AppDbBase } from "../api/services/db-base.ts"
import { demoDataSeed, startDemoReset } from "./demo/reset.ts"
import { isDemoSeeded, resetDemo } from "./demo/run.ts"
import { type DemoAdmin, readDemoAdmin } from "./demo/options.ts"
import { seedWorkspace } from "./demo/seed.ts"
import { s3ServerFiles } from "@server/files/files.ts"
import { readServerFilesSetup } from "@server/files/settings.ts"
import type { ImageScratch } from "@server/files/images.ts"

const sql = createSqlFromEnv(Deno.env.toObject(), {
  transform: postgres.camel,
  applicationName: "app-backend",
  // In Compose these are connections to PgBouncer, which holds the connections to Postgres
  // (docs/stack.md, "Database connections"). 10 is the driver's own default
  // (postgres@3.4.7 src/index.js:449), kept explicitly over the package's 15.
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

// A person's data export (docs/data-export.md) is built here and kept in the file store, and the
// nightly clean-up deletes removed attachments and abandoned uploads from it. Without its settings
// the export jobs fail and are retried, so a fixed env file still delivers them.
const filesSetup = readServerFilesSetup(Deno.env)
if (!filesSetup.success) console.warn(filesSetup.error)
const files = filesSetup.success ? s3ServerFiles(filesSetup.output) : null

// Image processing (#464) runs `vips` on files: each run gets a folder of its own under the one
// directory the worker may read and write (`--allow-read`/`--allow-write` in compose), and removes
// it when done.
const IMAGE_SCRATCH_ROOT = `/tmp/images`
const imageScratch: ImageScratch = {
  async open(bytes) {
    await Deno.mkdir(IMAGE_SCRATCH_ROOT, { recursive: true })
    const dir = await Deno.makeTempDir({ dir: IMAGE_SCRATCH_ROOT })
    const input = `${dir}/original`
    await Deno.writeFile(input, bytes)
    return { dir, input }
  },
  read: (path) => Deno.readFile(path),
  close: (dir) => Deno.remove(dir, { recursive: true }),
}

// Notifications also go to a linked Telegram chat (#269, docs/telegram.md) while the bot is on. The
// worker only sends, so it needs no webhook secret.
const telegramSetup = readTelegramSetup(systemEnv, Deno.env.get("ENV") === "dev" ? "dev" : "prod", {
  webhook: false,
})
const telegram = telegramSetup
  ? new TelegramClient({ token: telegramSetup.token, apiBaseUrl: telegramSetup.apiBaseUrl })
  : null

// The public demo (docs/demo.md) gives every new account its own sample groups.
const demo = isDemoMode(Deno.env.toObject())
// The owner's private administrator on the demo, when `DEMO_ADMIN_PASSWORD` is set. A bad value
// stops the worker here.
let demoAdmin: DemoAdmin | null = null
try {
  demoAdmin = readDemoAdmin(Deno.env.toObject())
} catch (error) {
  // A SeedConfigError: it names the variable, never its value.
  console.error(`❌ ${(error as Error).message}`)
  Deno.exit(1)
}

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
  billingSetup.trialRequiresCard,
  demo
    ? (userId) =>
      seedWorkspace(
        new AppDbBase({ sql }),
        sql,
        userId,
        demoDataSeed(new Date()),
        new Date(),
        files,
      )
    : null,
  undefined,
  files,
  telegram,
  imageScratch,
)

// Starts the nightly chain the first time; a restart finds the waiting row and adds nothing. A run
// that is given up is closed by the processor, which writes the next night's run itself.
await startRepeatingJobs(sql)
// A scheduled post whose job was lost (a restored backup, the demo's wipe) gets it back.
await queueDueBlogJobs(sql)

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

// The public demo (docs/demo.md): wiped and seeded again at midnight on the US west coast.
if (demo) {
  startDemoReset({
    signal,
    isSeeded: () => isDemoSeeded(sql, new Date(), demoAdmin !== null),
    reset: async () => {
      await resetDemo(sql, { subscribers: subscribersSetup, admin: demoAdmin })
      console.log("Demo wiped and seeded again")
    },
    now: () => new Date(),
    onError: (error) => console.error("Demo reset failed, retrying next minute", error),
  })
}

try {
  startIdempotencySweep({
    signal,
    sweep: sweepIdempotencyKeys,
    onError: reportSweepFailure,
    intervalMs: SWEEP_INTERVAL_MS,
  })
  await processor.run(signal, OUTBOX_IDLE_MS)
} finally {
  await sql.end({ timeout: 5 })
  const reason = signal.reason instanceof ShutdownSignalError ? ` on ${signal.reason.signal}` : ""
  console.log(`Worker stopped${reason}`)
}
