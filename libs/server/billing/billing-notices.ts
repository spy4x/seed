import type postgres from "postgres"
import { ONE_DAY_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { BillingNoticeKind, TRIAL_NOTICE_DAYS } from "@domain/billing"
import { JOB_AGGREGATE } from "@server/jobs/jobs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The worker's job that mails each billing notice to the group's owner. */
export const BILLING_NOTICE_JOBS: Readonly<Record<BillingNoticeKind, string>> = {
  [BillingNoticeKind.TrialEnding]: "billing.trial-ending-mail",
  [BillingNoticeKind.PaymentFailed]: "billing.payment-failed-mail",
  [BillingNoticeKind.PlanEnding]: "billing.plan-ending-mail",
}

/** When the mail that a trial ends soon goes out: {@link TRIAL_NOTICE_DAYS} days before its end. */
export function trialNoticeAt(trialEnd: Date): Date {
  return new Date(trialEnd.getTime() - TRIAL_NOTICE_DAYS * ONE_DAY_IN_MILLISECONDS)
}

/**
 * Queues the mail of one notice for the group, to run at `at`, in the caller's transaction, so the
 * mail is queued exactly when the change that calls for it commits. The run time is the row's
 * version too: the same notice for the same group at the same moment is queued once, so a
 * duplicate never fails the webhook.
 */
export async function scheduleBillingNotice(
  sql: postgres.Sql,
  kind: BillingNoticeKind,
  groupId: string,
  at: Date,
): Promise<void> {
  await sql`
    INSERT INTO outbox_events (
      id, event_kind, aggregate_type, aggregate_id, aggregate_version, available_at
    ) VALUES (
      ${uuidV7()}, ${BILLING_NOTICE_JOBS[kind]}, ${JOB_AGGREGATE}, ${groupId},
      ${at.getTime()}, ${at}
    )
    ON CONFLICT (aggregate_type, aggregate_id, aggregate_version, event_kind) DO NOTHING
  `
}
