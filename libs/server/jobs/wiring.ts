import type postgres from "postgres"
import {
  attemptFailureLine,
  ensureScheduledOutboxEvent,
  JobPublisher,
  OutboxProcessor,
  PostgresOutboxRepository,
} from "@spy4x/server/outbox"
import { nextCronRun } from "@spy4x/time/cron"
import type { BillingProvider } from "@spy4x/billing"
import { SeatSyncPublisher } from "../billing/seat-sync.ts"
import { GroupChangeNotifier } from "../groups/group-change-notify.ts"
import type { StarterDataPlan } from "./starter-data.ts"
import type { PasswordResetMailDeps } from "./password-reset-mail.ts"
import type { SubscribersSetup } from "../subscribers/subscribers.ts"
import { JOB_RETRY } from "./job-failures.ts"
import { JOB_AGGREGATE, JOB_AGGREGATE_ID, LEGACY_JOB_AGGREGATE_ID } from "./jobs.ts"
import { type JobDefinition, type JobDeps, JOBS } from "./registry.ts"
import type { ServerFiles } from "../files/files.ts"

/**
 * The worker's outbox processor: group changes go to the notifier, and jobs to the handlers of
 * {@link JOBS} (`registry.ts`, docs/jobs.md), each built here from the worker's dependencies. A job
 * that repeats every so many milliseconds writes its next run once it has succeeded or been given
 * up. The nightly cleanup is such a job (`cleanup.ts`). Every mail job, the owner's billing notices
 * included, shares one sender and brand.
 *
 * With a billing `provider`, a change to a group's members queues a seat sync, which sets a
 * per-member subscription's quantity to the member count, and the nightly cleanup queues one for
 * every group whose stored quantity has drifted. Without one, a seat sync left in the table does
 * nothing.
 *
 * With a `provider`, the welcome note of a new account respects the group's plan cap, counting the
 * plan with `graceDays`; without one, nothing caps it. The billing notice mails say what
 * `graceDays` and `trialRequiresCard` make true. `sampleData` adds to a new account's starter data
 * (`StarterDataPlan`).
 *
 * A row that fails is retried by {@link JOB_RETRY}; every failed attempt is logged through
 * `mail.log` with the row's kind and the error's name, and the last one as abandoned. A row that
 * is given up is closed, so the cleanup removes it a week later with the other processed rows. A
 * cleanup step that throws stops no other step, and a cleanup that is given up still writes the
 * next night's run.
 *
 * With `subscribers`, the subscriber jobs sign and mail confirm links, welcomes and issues. Without
 * it, they drop what they find.
 *
 * `jobs` is {@link JOBS} unless a test passes its own list. `files` is where the data export jobs
 * keep the person's file; without it they fail and are retried (docs/data-export.md). With
 * `telegram`, a notification also goes to the person's linked Telegram chat (#269); without it,
 * those jobs send nothing.
 *
 * @throws Error when two jobs share a kind: one handler would silently replace the other.
 */
export function createOutboxProcessor(
  sql: postgres.Sql,
  mail: Omit<PasswordResetMailDeps, "sql">,
  provider: BillingProvider | null = null,
  subscribers: SubscribersSetup | null = null,
  graceDays = 0,
  trialRequiresCard = true,
  sampleData: StarterDataPlan["sampleData"] = null,
  jobs: readonly JobDefinition[] = JOBS,
  files: ServerFiles | null = null,
  telegram: JobDeps["telegram"] = null,
): OutboxProcessor {
  const notifier = new GroupChangeNotifier(sql)
  const deps: JobDeps = {
    sql,
    mail,
    provider,
    subscribers,
    graceDays,
    trialRequiresCard,
    sampleData,
    files,
    telegram,
  }
  const kinds = jobs.map((job) => job.kind)
  const twice = kinds.filter((kind, index) => kinds.indexOf(kind) !== index)
  if (twice.length > 0) throw new Error(`Two jobs share a kind: ${[...new Set(twice)].join(`, `)}`)
  const { repeatEveryMs, repeatCron } = repeatSchedules(jobs)
  return new OutboxProcessor(
    new PostgresOutboxRepository(sql),
    new JobPublisher({
      aggregateType: JOB_AGGREGATE,
      handlers: Object.fromEntries(jobs.map((job) => [job.kind, job.handler(deps)])),
      fallback: provider ? new SeatSyncPublisher(sql, notifier) : notifier,
    }),
    {
      repeatEveryMs,
      repeatCron,
      repeatAfterGiveUp: true,
      onAttemptFailed: (failure) => mail.log(attemptFailureLine(failure)),
      ...JOB_RETRY,
    },
  )
}

/** The repeating jobs' schedules, split the way the processor takes them. */
export function repeatSchedules(jobs: readonly JobDefinition[]): {
  repeatEveryMs: Record<string, number>
  repeatCron: Record<string, string>
} {
  const repeatEveryMs: Record<string, number> = {}
  const repeatCron: Record<string, string> = {}
  for (const { kind, repeat } of jobs) {
    if (!repeat) continue
    if (`cron` in repeat) repeatCron[kind] = repeat.cron
    else repeatEveryMs[kind] = repeat.everyMs
  }
  return { repeatEveryMs, repeatCron }
}

/**
 * Starts the chain of every repeating job unless a run of it is already waiting, under
 * `JOB_AGGREGATE_ID` or `LEGACY_JOB_AGGREGATE_ID`, so the worker calls it at every start and two
 * workers starting together still leave one chain. A job repeating every so many milliseconds
 * first runs at once; a cron job at its next matching minute, so the nightly
 * cleanup at the next 03:00 UTC. The processor
 * closes a row it gives up and writes the next run itself, so a chain never stays stopped; one an
 * operator cancelled starts again here. A row an older worker gave up was closed by migration
 * `2026_11_01_0001_close_given_up_outbox_rows.sql`, and this then writes a fresh one.
 */
export async function startRepeatingJobs(
  sql: postgres.Sql,
  now = new Date(),
  jobs: readonly JobDefinition[] = JOBS,
): Promise<void> {
  for (const { kind, repeat } of jobs) {
    if (!repeat) continue
    // A chain started under the old id is still this job: a second one would run beside it.
    const legacy = await sql`
      SELECT 1 FROM outbox_events
      WHERE event_kind = ${kind}
        AND aggregate_type = ${JOB_AGGREGATE}
        AND aggregate_id = ${LEGACY_JOB_AGGREGATE_ID}
        AND processed_at IS NULL
      LIMIT 1
    `
    if (legacy.length > 0) continue
    await ensureScheduledOutboxEvent(
      sql,
      { eventKind: kind, aggregateType: JOB_AGGREGATE, aggregateId: JOB_AGGREGATE_ID },
      `cron` in repeat ? { at: nextCronRun(repeat.cron, now) } : { inMs: 0 },
    )
  }
}
