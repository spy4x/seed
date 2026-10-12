import type postgres from "postgres"
import { nextUtcHour } from "@spy4x/platform/universal/time"
import {
  ensureScheduledOutboxEvent,
  JobPublisher,
  OutboxProcessor,
  PostgresOutboxRepository,
} from "@spy4x/server/outbox"
import type { BillingProvider } from "@spy4x/billing"
import { BillingNoticeKind } from "@domain/billing"
import { BILLING_NOTICE_JOBS } from "../billing/billing-notices.ts"
import {
  queueSeatDrift,
  SEAT_SYNC_JOB,
  seatSyncJob,
  SeatSyncPublisher,
} from "../billing/seat-sync.ts"
import { GroupChangeNotifier } from "../groups/group-change-notify.ts"
import { purgeDeadInvitations } from "../groups/purge-dead-invitations.ts"
import { purgeDeletedNotes } from "../notes/purge-deleted-notes.ts"
import { purgeDeletedGroups } from "../groups/purge-deleted-groups.ts"
import { purgeReadNotifications } from "../notifications/purge-notifications.ts"
import { purgeOldAuditEvents } from "../groups/purge-audit-events.ts"
import { purgeExpiredApiTokens } from "../api-tokens/purge-expired-api-tokens.ts"
import { hardDeleteDueAccounts } from "../auth/account-deletion.ts"
import {
  ACCOUNT_DELETION_MAIL_JOB,
  ACCOUNT_HARD_DELETE_JOB,
  ACCOUNT_RESTORED_MAIL_JOB,
  accountDeletionMailJob,
  accountHardDeleteJob,
  accountRestoredMailJob,
} from "./account-deletion.ts"
import { STARTER_DATA_JOB, starterDataJob } from "./starter-data.ts"
import { API_TOKEN_CREATED_MAIL_JOB, apiTokenCreatedMailJob } from "./api-token-mail.ts"
import { type BillingNoticeMailDeps, billingNoticeMailJob } from "./billing-notice-mail.ts"
import {
  EMAIL_CODE_MAIL_JOB,
  emailCodeMailJob,
  removeStaleEmailCodeRequests,
} from "./email-code-mail.ts"
import {
  PASSWORD_RESET_MAIL_JOB,
  type PasswordResetMailDeps,
  passwordResetMailJob,
  removeStalePasswordResetRequests,
} from "./password-reset-mail.ts"
import {
  removeStaleSubscriptionRequests,
  SUBSCRIBER_CONFIRM_MAIL_JOB,
  SUBSCRIBER_SEND_ISSUE_JOB,
  SUBSCRIBER_WELCOME_MAIL_JOB,
  subscriberConfirmMailJob,
  subscriberSendIssueJob,
  subscriberWelcomeMailJob,
} from "./subscriber-mail.ts"
import type { SubscribersSetup } from "../subscribers/subscribers.ts"
import { cleanupJob, type CleanupStep, JOB_RETRY, logAttemptFailure } from "./job-failures.ts"
import {
  JOB_AGGREGATE,
  JOB_AGGREGATE_ID,
  type JobHandler,
  OUTBOX_CLEANUP_JOB,
  removeProcessedOutboxEvents,
} from "./jobs.ts"

const DAY_MS = 24 * 60 * 60_000

/** The hour, in UTC, at which the nightly jobs first run. */
const NIGHTLY_HOUR_UTC = 3

/**
 * The worker's outbox processor: group changes go to the notifier, jobs to their handlers, and the
 * nightly cleanup is one row that writes its next run, a day later, once it has succeeded. The
 * cleanup also drops password reset and e-mail code requests whose mail gave up, and removes for
 * good the groups whose 30 days for restoring are over, the invitations dead for over 30 days,
 * the personal API tokens that expired or were revoked over 30 days ago, the audit events older than a year and
 * the accounts whose 7 days of waiting are over (a backstop for their own jobs). Every mail job,
 * the owner's billing notices included, shares one sender and brand.
 *
 * With a billing `provider`, a change to a group's members queues a seat sync, which sets a
 * per-member subscription's quantity to the member count, and the nightly cleanup queues one for
 * every group whose stored quantity has drifted. Without one, a seat sync left in the table does
 * nothing.
 *
 * With a `provider`, the welcome note of a new account respects the group's plan cap, counting the
 * plan with `graceDays`; without one, nothing caps it. The billing notice mails say what
 * `graceDays` and `trialRequiresCard` make true.
 *
 * A row that fails is retried by {@link JOB_RETRY}; every failed attempt is logged through
 * `mail.log` with the row's kind and the error's name, and the last one as abandoned. A row that
 * is given up is closed, so the cleanup removes it a week later with the other processed rows. A
 * cleanup step that throws stops no other step, and a cleanup that is given up still writes the
 * next night's run.
 *
 * With `subscribers`, the subscriber jobs sign and mail confirm links, welcomes and issues. Without
 * it, they drop what they find.
 */
export function createOutboxProcessor(
  sql: postgres.Sql,
  mail: Omit<PasswordResetMailDeps, "sql">,
  provider: BillingProvider | null = null,
  subscribers: SubscribersSetup | null = null,
  graceDays = 0,
  trialRequiresCard = true,
): OutboxProcessor {
  const notifier = new GroupChangeNotifier(sql)
  return new OutboxProcessor(
    new PostgresOutboxRepository(sql),
    new JobPublisher({
      aggregateType: JOB_AGGREGATE,
      handlers: {
        [OUTBOX_CLEANUP_JOB]: cleanupJob(cleanupSteps(sql, provider, mail.log), mail.log),
        [SEAT_SYNC_JOB]: provider ? seatSyncJob({ sql, provider }) : async () => {},
        [PASSWORD_RESET_MAIL_JOB]: passwordResetMailJob({ sql, ...mail }),
        [EMAIL_CODE_MAIL_JOB]: emailCodeMailJob({ sql, ...mail }),
        [ACCOUNT_DELETION_MAIL_JOB]: accountDeletionMailJob({ sql, ...mail }),
        [ACCOUNT_RESTORED_MAIL_JOB]: accountRestoredMailJob({ sql, ...mail }),
        [API_TOKEN_CREATED_MAIL_JOB]: apiTokenCreatedMailJob({ sql, ...mail }),
        [ACCOUNT_HARD_DELETE_JOB]: accountHardDeleteJob({ sql, log: mail.log }),
        [STARTER_DATA_JOB]: starterDataJob(sql, { billingEnabled: provider !== null, graceDays }),
        ...billingNoticeJobs(sql, mail, { graceDays, trialRequiresCard }),
        [SUBSCRIBER_CONFIRM_MAIL_JOB]: subscriberConfirmMailJob({
          sql,
          ...mail,
          setup: subscribers,
        }),
        [SUBSCRIBER_WELCOME_MAIL_JOB]: subscriberWelcomeMailJob({
          sql,
          ...mail,
          setup: subscribers,
        }),
        [SUBSCRIBER_SEND_ISSUE_JOB]: subscriberSendIssueJob({ sql, ...mail, setup: subscribers }),
      },
      fallback: provider ? new SeatSyncPublisher(sql, notifier) : notifier,
    }),
    {
      repeatEveryMs: { [OUTBOX_CLEANUP_JOB]: DAY_MS },
      repeatAfterGiveUp: true,
      onAttemptFailed: logAttemptFailure(mail.log),
      ...JOB_RETRY,
    },
  )
}

/**
 * The parts of the nightly cleanup, in the order they run. Each removes only what is due, so one
 * that ran again finds nothing.
 */
function cleanupSteps(
  sql: postgres.Sql,
  provider: BillingProvider | null,
  log: (line: string) => void,
): CleanupStep[] {
  return [
    ["remove old processed outbox rows", async () => {
      const removed = await removeProcessedOutboxEvents(sql)
      if (removed > 0) console.log(`Removed ${removed} old processed outbox row(s)`)
    }],
    ["remove unsent password reset requests", async () => {
      const stale = await removeStalePasswordResetRequests(sql)
      if (stale > 0) console.log(`Removed ${stale} unsent password reset request(s)`)
    }],
    ["remove unsent e-mail code requests", async () => {
      const staleCodes = await removeStaleEmailCodeRequests(sql)
      if (staleCodes > 0) console.log(`Removed ${staleCodes} unsent e-mail code request(s)`)
    }],
    ["remove unsent subscription requests", async () => {
      const staleSubs = await removeStaleSubscriptionRequests(sql)
      if (staleSubs > 0) console.log(`Removed ${staleSubs} unsent subscription request(s)`)
    }],
    ["purge deleted groups", async () => {
      const groups = await purgeDeletedGroups(sql)
      if (groups.removed > 0) console.log(`Removed ${groups.removed} deleted group(s) for good`)
      if (groups.kept > 0) {
        console.warn(
          `Kept ${groups.kept} deleted group(s) with a live subscription; cancel it in Stripe`,
        )
      }
    }],
    ["purge deleted notes", async () => {
      const notes = await purgeDeletedNotes(sql)
      if (notes.removed > 0) console.log(`Removed ${notes.removed} deleted note(s) for good`)
    }],
    ["purge dead invitations", async () => {
      const invitations = await purgeDeadInvitations(sql)
      if (invitations > 0) console.log(`Removed ${invitations} dead group invitation(s)`)
    }],
    ["purge expired API tokens", async () => {
      const tokens = await purgeExpiredApiTokens(sql)
      if (tokens > 0) console.log(`Removed ${tokens} expired or revoked API token(s) for good`)
    }],
    ["purge old audit events", async () => {
      const audit = await purgeOldAuditEvents(sql)
      if (audit > 0) console.log(`Removed ${audit} audit event(s) past their retention`)
    }],
    ["purge read notifications", async () => {
      const inbox = await purgeReadNotifications(sql)
      if (inbox > 0) console.log(`Removed ${inbox} read notification(s) past their retention`)
    }],
    ["delete accounts whose wait is over", async () => {
      const accounts = await hardDeleteDueAccounts(sql, log)
      if (accounts.deleted > 0) console.log(`Deleted ${accounts.deleted} account(s) for good`)
      if (accounts.blocked > 0) {
        console.warn(
          `Kept ${accounts.blocked} account(s) due for deletion: a shared or paid group`,
        )
      }
      if (accounts.failed > 0) {
        throw new Error(`${accounts.failed} account(s) due for deletion were not deleted`)
      }
    }],
    ["queue seat syncs for drifted groups", async () => {
      if (!provider) return
      const drifted = await queueSeatDrift(sql)
      if (drifted > 0) console.log(`Queued a seat sync for ${drifted} group(s)`)
    }],
  ]
}

/** One mail job per billing notice. */
function billingNoticeJobs(
  sql: postgres.Sql,
  { sender, brand, log }: Omit<PasswordResetMailDeps, "sql">,
  billing: Pick<BillingNoticeMailDeps, "graceDays" | "trialRequiresCard">,
): Record<string, JobHandler> {
  const kinds = [
    BillingNoticeKind.TrialEnding,
    BillingNoticeKind.PaymentFailed,
    BillingNoticeKind.PlanEnding,
  ]
  return Object.fromEntries(
    kinds.map((kind) => [
      BILLING_NOTICE_JOBS[kind],
      billingNoticeMailJob(kind, { sql, sender, brand, log, ...billing }),
    ]),
  )
}

/**
 * Starts the nightly cleanup chain at the next 03:00 UTC unless a run is already waiting. The
 * processor closes a cleanup row it gives up and writes the next run itself, so a chain never
 * stays stopped; a row an older worker gave up was closed by migration
 * `2026_11_01_0001_close_given_up_outbox_rows.sql`, and this then writes a fresh one.
 */
export async function scheduleNightlyJobs(sql: postgres.Sql, now = new Date()): Promise<void> {
  await ensureScheduledOutboxEvent(
    sql,
    { eventKind: OUTBOX_CLEANUP_JOB, aggregateType: JOB_AGGREGATE, aggregateId: JOB_AGGREGATE_ID },
    { at: nextUtcHour(now, NIGHTLY_HOUR_UTC) },
  )
}
