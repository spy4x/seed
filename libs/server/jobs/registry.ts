/**
 * Every background job the worker runs, in one list (docs/jobs.md). A job is one `defineJob` entry
 * in {@link JOBS}: its kind (the code the outbox row carries), the name the admin's Jobs module
 * shows, the handler, and optionally whether it sends mail, how it repeats and what its row is
 * about. The worker builds its handlers and repeating schedules from this list
 * (`createOutboxProcessor` in `wiring.ts`), and the operator area reads names and schedules from it.
 *
 * @module
 */

import { IMAGE_PROCESS_JOB, imageProcessJob, type ImageScratch } from "../files/images.ts"
import type postgres from "postgres"
import { stepsJob } from "@spy4x/server/outbox"
import { describeCron, parseCron } from "@spy4x/time/cron"
import type { BillingProvider } from "@spy4x/billing"
import { ONE_DAY_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { BillingNoticeKind } from "@domain/billing"
import { BLOG_PUBLISH_JOB } from "@domain/blog"
import { BILLING_NOTICE_JOBS } from "../billing/billing-notices.ts"
import { SEAT_SYNC_JOB, seatSyncJob } from "../billing/seat-sync.ts"
import { blogPublishJob } from "../blog/blog-publish-job.ts"
import type { SubscribersSetup } from "../subscribers/subscribers.ts"
import {
  ACCOUNT_DELETION_MAIL_JOB,
  ACCOUNT_HARD_DELETE_JOB,
  ACCOUNT_RESTORED_MAIL_JOB,
  accountDeletionMailJob,
  accountHardDeleteJob,
  accountRestoredMailJob,
} from "./account-deletion.ts"
import { API_TOKEN_CREATED_MAIL_JOB, apiTokenCreatedMailJob } from "./api-token-mail.ts"
import type { ServerFiles } from "../files/files.ts"
import {
  DATA_EXPORT_BUILD_JOB,
  DATA_EXPORT_EXPIRE_JOB,
  DATA_EXPORT_MAIL_JOB,
  dataExportBuildJob,
  dataExportExpireJob,
  dataExportMailJob,
} from "./data-export.ts"
import { billingNoticeMailJob } from "./billing-notice-mail.ts"
import { cleanupSteps } from "./cleanup.ts"
import { EMAIL_CODE_MAIL_JOB, emailCodeMailJob } from "./email-code-mail.ts"
import { type JobHandler, OUTBOX_CLEANUP_JOB } from "./jobs.ts"
import {
  PASSWORD_RESET_MAIL_JOB,
  type PasswordResetMailDeps,
  passwordResetMailJob,
} from "./password-reset-mail.ts"
import { SIGN_IN_METHOD_MAIL_JOB, signInMethodMailJob } from "./sign-in-method-mail.ts"
import { SIGN_UP_CODE_MAIL_JOB, signUpCodeMailJob } from "./sign-up-code-mail.ts"
import { SIGN_IN_LINK_MAIL_JOB, signInLinkMailJob } from "./sign-in-link-mail.ts"
import { STARTER_DATA_JOB, starterDataJob, type StarterDataPlan } from "./starter-data.ts"
import {
  TELEGRAM_NOTIFICATION_JOB,
  type TelegramNotificationDeps,
  telegramNotificationJob,
} from "./telegram-notification.ts"
import {
  SUBSCRIBER_CONFIRM_MAIL_JOB,
  SUBSCRIBER_SEND_ISSUE_JOB,
  SUBSCRIBER_WELCOME_MAIL_JOB,
  subscriberConfirmMailJob,
  subscriberSendIssueJob,
  subscriberWelcomeMailJob,
} from "./subscriber-mail.ts"

/** What a job's handler may use. The worker builds it once (`createOutboxProcessor`). */
export interface JobDeps {
  sql: postgres.Sql
  /** The one sender, brand and log every mail job shares. */
  mail: Omit<PasswordResetMailDeps, "sql">
  /** The billing provider, or `null` with billing off. */
  provider: BillingProvider | null
  /** The newsletter's setup, or `null` with no list configured. */
  subscribers: SubscribersSetup | null
  graceDays: number
  trialRequiresCard: boolean
  sampleData: StarterDataPlan["sampleData"]
  /** Where the worker keeps the files it makes, or `null` without file store settings. */
  files: ServerFiles | null
  /** Sends to Telegram, or `null` while the bot is off (#269). */
  telegram: TelegramNotificationDeps["client"]
  /** Where image processing works on disk, or `null` when the worker has none (#464). */
  imageScratch: ImageScratch | null
}

/**
 * How a job repeats. `everyMs`: each run, once it succeeded or was given up, writes the next one
 * that long after; the first run is at once. `cron`: five fields in UTC or an alias such as
 * `@daily` (docs/jobs.md); each run is at the next matching minute. Either way the worker starts
 * the chain once, at start-up, and a restart adds no second one.
 */
export type JobRepeat =
  | { everyMs: number }
  | { cron: string }

/**
 * What a job's `aboutId` names, so the admin can link it: a group, or a row of a table whose
 * `user_id` is a person. A job about neither leaves it out.
 */
export type JobAbout = { group: true } | { userIn: string }

/** One background job: see {@link defineJob}. */
export interface JobDefinition {
  /** The code on the outbox row, such as `auth.password-reset-mail`. At most 64 characters. */
  kind: string
  /** What the admin's Jobs module calls it, such as "Password reset email". */
  label: string
  /** Builds the handler from the worker's dependencies. */
  handler: (deps: JobDeps) => JobHandler
  /** The job sends mail: running it again may mail someone twice, so the admin asks first. */
  sendsMail?: boolean
  /**
   * Set when an operator must not cancel a waiting run: why, and what to do instead. The admin's
   * Jobs module then hides Cancel, and the API refuses it with this text.
   */
  cannotCancel?: string
  repeat?: JobRepeat
  about?: JobAbout
}

const KIND = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/
const TABLE = /^[a-z][a-z0-9_]*$/

/**
 * A job definition, checked: the kind is dotted lowercase words of at most 64 characters, the label
 * is not blank, `everyMs` is a whole number of at least one second and `userIn` names a table.
 *
 * ```ts
 * defineJob({
 *   kind: `invoices.reminder-mail`,
 *   label: `Invoice reminder email`,
 *   sendsMail: true,
 *   handler: ({ sql, mail }) => invoiceReminderMailJob({ sql, ...mail }),
 * })
 * ```
 *
 * @throws RangeError naming the field that is wrong.
 */
export function defineJob(definition: JobDefinition): JobDefinition {
  const { kind, label, repeat, about } = definition
  if (kind.length > 64 || !KIND.test(kind)) {
    throw new RangeError(
      `job kind must be dotted lowercase words of at most 64 characters: ${kind}`,
    )
  }
  if (label.trim() === ``) throw new RangeError(`job ${kind} needs a label`)
  if (
    repeat && `everyMs` in repeat &&
    !(Number.isSafeInteger(repeat.everyMs) && repeat.everyMs >= 1_000)
  ) {
    throw new RangeError(`job ${kind}: everyMs must be a whole number of at least 1000`)
  }
  if (repeat && `cron` in repeat) {
    try {
      parseCron(repeat.cron)
    } catch (error) {
      throw new RangeError(`job ${kind}: ${(error as Error).message}`)
    }
  }
  if (about && `userIn` in about && !TABLE.test(about.userIn)) {
    throw new RangeError(`job ${kind}: userIn must be a table name`)
  }
  return Object.freeze({ ...definition })
}

/** The mail dependencies every mail job takes, with the pool. */
function mailDeps({ sql, mail }: JobDeps) {
  return { sql, ...mail }
}

/** One mail job per billing notice, each about a group. */
const BILLING_NOTICE_LABELS: Record<BillingNoticeKind, string> = {
  [BillingNoticeKind.TrialEnding]: `Trial ending email`,
  [BillingNoticeKind.PaymentFailed]: `Payment failed email`,
  [BillingNoticeKind.PlanEnding]: `Plan ending email`,
}

/**
 * Every job, in the order the admin's Repeating tab and the docs list them. A new job is one entry
 * here; nothing else registers it.
 */
export const JOBS: readonly JobDefinition[] = [
  defineJob({
    kind: OUTBOX_CLEANUP_JOB,
    label: `Nightly cleanup`,
    repeat: { cron: `0 3 * * *` },
    handler: ({ sql, provider, mail, files }) =>
      stepsJob(`nightly cleanup`, cleanupSteps(sql, provider, mail.log, files), mail.log),
  }),
  defineJob({
    kind: SEAT_SYNC_JOB,
    label: `Seat count sync`,
    about: { group: true },
    handler: ({ sql, provider }) => provider ? seatSyncJob({ sql, provider }) : async () => {},
  }),
  defineJob({
    kind: PASSWORD_RESET_MAIL_JOB,
    label: `Password reset email`,
    sendsMail: true,
    handler: (deps) => passwordResetMailJob(mailDeps(deps)),
  }),
  defineJob({
    kind: EMAIL_CODE_MAIL_JOB,
    label: `Email address code`,
    sendsMail: true,
    about: { userIn: `email_code_requests` },
    handler: (deps) => emailCodeMailJob(mailDeps(deps)),
  }),
  defineJob({
    kind: SIGN_UP_CODE_MAIL_JOB,
    label: `Sign-up code email`,
    sendsMail: true,
    handler: (deps) => signUpCodeMailJob(mailDeps(deps)),
  }),
  defineJob({
    kind: SIGN_IN_LINK_MAIL_JOB,
    label: `Sign-in link email`,
    sendsMail: true,
    handler: (deps) => signInLinkMailJob(mailDeps(deps)),
  }),
  defineJob({
    kind: SIGN_IN_METHOD_MAIL_JOB,
    label: `Sign-in method change email`,
    sendsMail: true,
    about: { userIn: `sign_in_method_changes` },
    handler: (deps) => signInMethodMailJob(mailDeps(deps)),
  }),
  defineJob({
    kind: API_TOKEN_CREATED_MAIL_JOB,
    label: `New API token email`,
    sendsMail: true,
    about: { userIn: `api_tokens` },
    handler: (deps) => apiTokenCreatedMailJob(mailDeps(deps)),
  }),
  defineJob({
    kind: ACCOUNT_DELETION_MAIL_JOB,
    label: `Account deletion email`,
    sendsMail: true,
    about: { userIn: `account_deletions` },
    handler: (deps) => accountDeletionMailJob(mailDeps(deps)),
  }),
  defineJob({
    kind: ACCOUNT_RESTORED_MAIL_JOB,
    label: `Account restored email`,
    sendsMail: true,
    about: { userIn: `account_restorations` },
    handler: (deps) => accountRestoredMailJob(mailDeps(deps)),
  }),
  defineJob({
    kind: ACCOUNT_HARD_DELETE_JOB,
    label: `Account deletion for good`,
    about: { userIn: `account_deletions` },
    handler: ({ sql, mail }) => accountHardDeleteJob({ sql, log: mail.log }),
  }),
  defineJob({
    kind: IMAGE_PROCESS_JOB,
    label: `Image processing`,
    handler: ({ sql, files, imageScratch }) =>
      imageProcessJob({ sql, files, scratch: imageScratch }),
  }),
  defineJob({
    kind: DATA_EXPORT_BUILD_JOB,
    label: `Data export`,
    about: { userIn: `data_exports` },
    handler: ({ sql, files }) => dataExportBuildJob({ sql, files }),
  }),
  defineJob({
    kind: DATA_EXPORT_MAIL_JOB,
    label: `Data export ready email`,
    sendsMail: true,
    about: { userIn: `data_exports` },
    handler: (deps) => dataExportMailJob(mailDeps(deps)),
  }),
  defineJob({
    kind: DATA_EXPORT_EXPIRE_JOB,
    label: `Data export expiry`,
    about: { userIn: `data_exports` },
    cannotCancel: `Cancelling it would keep the person's file past its days. ` +
      `The nightly cleanup deletes it a day later anyway.`,
    handler: ({ sql, files }) => dataExportExpireJob({ sql, files }),
  }),
  defineJob({
    kind: STARTER_DATA_JOB,
    label: `Starter data for a new account`,
    about: { userIn: `starter_data_requests` },
    handler: ({ sql, provider, graceDays, sampleData }) =>
      starterDataJob(sql, { billingEnabled: provider !== null, graceDays, sampleData }),
  }),
  defineJob({
    kind: TELEGRAM_NOTIFICATION_JOB,
    label: `Telegram notification`,
    about: { userIn: `telegram_messages` },
    handler: ({ sql, mail, telegram }) =>
      telegramNotificationJob({
        sql,
        client: telegram,
        webAppUrl: mail.brand.webAppUrl,
        log: mail.log,
      }),
  }),
  ...[BillingNoticeKind.TrialEnding, BillingNoticeKind.PaymentFailed, BillingNoticeKind.PlanEnding]
    .map((notice) =>
      defineJob({
        kind: BILLING_NOTICE_JOBS[notice],
        label: BILLING_NOTICE_LABELS[notice],
        sendsMail: true,
        about: { group: true },
        handler: ({ sql, mail, graceDays, trialRequiresCard }) =>
          billingNoticeMailJob(notice, { sql, ...mail, graceDays, trialRequiresCard }),
      })
    ),
  defineJob({
    kind: SUBSCRIBER_CONFIRM_MAIL_JOB,
    label: `Newsletter confirmation email`,
    sendsMail: true,
    handler: (deps) => subscriberConfirmMailJob({ ...mailDeps(deps), setup: deps.subscribers }),
  }),
  defineJob({
    kind: SUBSCRIBER_WELCOME_MAIL_JOB,
    label: `Newsletter welcome email`,
    sendsMail: true,
    handler: (deps) => subscriberWelcomeMailJob({ ...mailDeps(deps), setup: deps.subscribers }),
  }),
  defineJob({
    kind: SUBSCRIBER_SEND_ISSUE_JOB,
    label: `Newsletter issue`,
    sendsMail: true,
    handler: (deps) => subscriberSendIssueJob({ ...mailDeps(deps), setup: deps.subscribers }),
  }),
  // Queues the newsletter issue but mails no one itself, and a second run queues nothing more.
  defineJob({
    kind: BLOG_PUBLISH_JOB,
    label: `Publish a blog post`,
    cannotCancel: `To stop a scheduled post, unschedule it on the Blog page. ` +
      `Cancelling its job would leave the post scheduled with nothing to publish it.`,
    handler: (deps) => blogPublishJob({ ...mailDeps(deps), setup: deps.subscribers }),
  }),
]

/** The job of `kind`, or `undefined` for a kind no entry has (an old row, a group change). */
export function jobDefinition(
  kind: string,
  jobs: readonly JobDefinition[] = JOBS,
): JobDefinition | undefined {
  return jobs.find((job) => job.kind === kind)
}

/** What the admin calls a kind: its label, or the kind itself for one no entry has. */
export function jobLabel(kind: string, jobs: readonly JobDefinition[] = JOBS): string {
  return jobDefinition(kind, jobs)?.label ?? kind
}

const UNITS: [ms: number, one: string, many: string][] = [
  [ONE_DAY_IN_MILLISECONDS, `day`, `days`],
  [3_600_000, `hour`, `hours`],
  [60_000, `minute`, `minutes`],
  [1_000, `second`, `seconds`],
]

/**
 * A schedule in words: `Every day`, `Every 15 minutes`, or for a cron schedule
 * `Every day at 03:00 UTC` (`describeCron`).
 */
export function describeRepeat(repeat: JobRepeat): string {
  if (`cron` in repeat) return describeCron(repeat.cron)
  const [ms, one, many] = UNITS.find(([unit]) => repeat.everyMs % unit === 0) ??
    UNITS[UNITS.length - 1]
  const count = Math.round(repeat.everyMs / ms)
  return count === 1 ? `Every ${one}` : `Every ${count} ${many}`
}
