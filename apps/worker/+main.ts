import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import { postgresEnv } from "../api/services/db-direct.ts"
import { exitProcess, processEnv, readEnvRecord } from "@spy4x/platform/server/process"
import { runtimeFileSystem } from "@spy4x/platform/server/runtime-fs"
import { createOutboxProcessor, startRepeatingJobs } from "@server/jobs/wiring.ts"
import { TelegramClient } from "@spy4x/integrations/telegram"
import { readTelegramSetup } from "@server/telegram/setup.ts"
import { queueDueBlogJobs } from "@server/blog/blog-publish-job.ts"
import { readIndexNowSetup } from "@server/blog/blog-indexnow-job.ts"
import { readCrosspostSetup } from "@server/blog/blog-crosspost-job.ts"
import { loadDemoBlogPosts } from "@server/blog/seed-posts.ts"
import { PostgresIdempotencyStore } from "@spy4x/server/idempotency"
import { startIdempotencySweep } from "./idempotency-sweep.ts"
import { shutdownSignal, ShutdownSignalError } from "@spy4x/platform/server/shutdown-signal"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { createMailSender, mailOffWarning, readMailSetup } from "@server/mail/mail.ts"
import { readSubscribersSetup, subscribersOffWarning } from "@server/subscribers/subscribers.ts"
// The API's own reading of the billing variables, so both processes run one provider.
import { readBillingSetup } from "@server/billing/setup.ts"
import { isDemoMode } from "@server/auth/demo-accounts.ts"
import { AppDbBase } from "../api/services/db-base.ts"
import { demoDataSeed, startDemoReset } from "./demo/reset.ts"
import { isDemoSeeded, resetDemo } from "./demo/run.ts"
import { DEMO_ADMIN_ENV_NAMES, type DemoAdmin, readDemoAdmin } from "./demo/options.ts"
import { seedWorkspace } from "./demo/seed.ts"
import { s3ServerFiles } from "@server/files/files.ts"
import { readServerFilesSetup } from "@server/files/settings.ts"
import type { ImageScratch } from "@server/files/images.ts"

const sql = createSqlFromEnv(postgresEnv(), {
  transform: postgres.camel,
  applicationName: "app-backend",
  // In Compose these are connections to PgBouncer, which holds the connections to Postgres
  // (docs/stack.md, "Database connections"). 10 is the driver's own default
  // (postgres@3.4.7 src/index.js:449), kept explicitly over the package's 15.
  max: 10,
})
if (!sql) {
  console.error("❌ Missing environment variable: DB_HOST")
  exitProcess(1)
}

// Aborts once, on the first SIGINT or SIGTERM, and removes both listeners itself.
const signal = shutdownSignal()

console.log("Worker started")

// Mail goes out from here, never from the API: a reset code is made and sent in one step.
const domain = processEnv.get("DOMAIN")
if (!domain) {
  console.error("❌ Missing environment variable: DOMAIN")
  exitProcess(1)
}
const mailSetup = readMailSetup(processEnv)
const mailWarning = mailOffWarning(mailSetup)
if (mailWarning) console.warn(mailWarning)

// The worker signs the subscriber links it mails; the API checks them with the same secrets.
const subscribersSetup = readSubscribersSetup(
  processEnv,
  processEnv.get("ENV") === "dev" ? "dev" : "prod",
)
const subscribersWarning = subscribersOffWarning(subscribersSetup)
if (subscribersWarning) console.warn(subscribersWarning)

// A per-member subscription's quantity is changed from here, through the outbox, so a provider
// that is down never holds a new member back. A setup that cannot run stops the worker, as it stops
// the API. The worker verifies no webhook, so it neither needs nor reads the webhook secret.
const billingSetup = readBillingSetup(
  processEnv,
  processEnv.get("ENV") === "dev" ? "dev" : "prod",
  {
    webhooks: false,
  },
)

// A person's data export (docs/data-export.md) is built here and kept in the file store, and the
// nightly clean-up deletes removed attachments and abandoned uploads from it. Without its settings
// the export jobs fail and are retried, so a fixed env file still delivers them.
const filesSetup = readServerFilesSetup(processEnv)
if (!filesSetup.success) console.warn(filesSetup.error)
const files = filesSetup.success ? s3ServerFiles(filesSetup.output) : null

// Image processing runs `vips` on files: each run gets a folder of its own under the one
// directory the worker may read and write (`--allow-read`/`--allow-write` in compose), and removes
// it when done.
const IMAGE_SCRATCH_ROOT = `/tmp/images`
const imageScratch: ImageScratch = {
  async open(bytes) {
    await runtimeFileSystem.mkdirp(IMAGE_SCRATCH_ROOT)
    const dir = await runtimeFileSystem.makeTempDir!(IMAGE_SCRATCH_ROOT)
    const input = `${dir}/original`
    await runtimeFileSystem.writeBytes!(input, bytes)
    return { dir, input }
  },
  async read(path) {
    const bytes = await runtimeFileSystem.readBytes!(path)
    if (bytes === null) throw new Error(`No file at ${path}`)
    return bytes
  },
  close: (dir) => runtimeFileSystem.removeTree!(dir),
}

// Notifications also go to a linked Telegram chat (docs/telegram.md) while the bot is on. The
// worker only sends, so it needs no webhook secret.
const telegramSetup = readTelegramSetup(
  processEnv,
  processEnv.get("ENV") === "dev" ? "dev" : "prod",
  {
    webhook: false,
  },
)
const telegram = telegramSetup
  ? new TelegramClient({ token: telegramSetup.token, apiBaseUrl: telegramSetup.apiBaseUrl })
  : null

// IndexNow (docs/blog.md): with `INDEXNOW_KEY` and `MPA_DOMAIN`, a blog post that goes live,
// changes, moves or leaves is announced to the search engines. A malformed key stops the worker.
const indexNow = readIndexNowSetup(processEnv, processEnv.get("ENV") === "dev" ? "dev" : "prod")
if (!indexNow && processEnv.get("INDEXNOW_KEY")?.trim()) {
  console.warn("IndexNow is off: INDEXNOW_KEY is set, but MPA_DOMAIN is not")
}

// The Dev.to cross-post (docs/blog.md): with `DEVTO_API_KEY` and `MPA_DOMAIN`, a live post
// is posted to Dev.to once ever, with its canonical address on the website. The key stays in the
// client and is never logged.
const crosspost = readCrosspostSetup(processEnv, processEnv.get("ENV") === "dev" ? "dev" : "prod")
if (!crosspost && processEnv.get("DEVTO_API_KEY")?.trim()) {
  console.warn("The Dev.to cross-post is off: DEVTO_API_KEY is set, but MPA_DOMAIN is not")
}

// The public demo (docs/demo.md) gives every new account its own sample groups.
const demo = isDemoMode(readEnvRecord([`DEMO_MODE`]))
// The owner's private administrator on the demo, when `DEMO_ADMIN_PASSWORD` is set. A bad value
// stops the worker here.
let demoAdmin: DemoAdmin | null = null
try {
  demoAdmin = readDemoAdmin(readEnvRecord(DEMO_ADMIN_ENV_NAMES))
} catch (error) {
  // A SeedConfigError: it names the variable, never its value.
  console.error(`❌ ${(error as Error).message}`)
  exitProcess(1)
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
    brand: { webAppUrl: `http${processEnv.get("ENV") === "dev" ? "" : "s"}://${domain}` },
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
  indexNow,
  crosspost,
)

// Starts the nightly chain the first time; a restart finds the waiting row and adds nothing. A run
// that is given up is closed by the processor, which writes the next night's run itself.
await startRepeatingJobs(sql)
// The public demo shows Seed's own blog posts, kept as files (libs/server/blog/seed-posts/), so a
// deploy brings their latest version. A broken file is logged and leaves the blog as it was:
// `deno task check` refuses one before it ships.
try {
  await loadDemoBlogPosts(sql, { demo, fs: runtimeFileSystem })
} catch (error) {
  console.error("Seed's blog posts were not loaded", error)
}
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
