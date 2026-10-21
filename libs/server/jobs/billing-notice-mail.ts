import type postgres from "postgres"
import type { EmailSender } from "@spy4x/email/sender"
import {
  accessEndsAt,
  BillingNoticeKind,
  billingNoticeKindOf,
  effectivePlanId,
  findPlan,
  FREE_PLAN_ID,
  graceEndsAt,
  type StoredSubscription,
} from "@domain/billing"
import { trialNoticeAt } from "../billing/billing-notices.ts"
import { PostgresBillingRepository } from "../billing/postgres-billing-repository.ts"
import { billingNoticeMail, type MailBrand } from "../mail/mail.ts"
import type { JobHandler } from "./jobs.ts"

/** What a billing notice mail job needs. */
export interface BillingNoticeMailDeps {
  sql: postgres.Sql
  /** `null` when mail is off: nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails or the owner has no address; gets no address. */
  log: (line: string) => void
  /** The current time; tests pass a fixed one. */
  now?: () => Date
  /** `BILLING_GRACE_DAYS`: how long a failed payment keeps the plan. Unset: no grace. */
  graceDays?: number
  /** `BILLING_TRIAL_REQUIRES_CARD`: whether a trial was started with a card. Unset: it was. */
  trialRequiresCard?: boolean
}

interface OwnerRow extends postgres.Row {
  name: string
  email: string | null
}

/**
 * Mails one notice of `kind` to the owner who pays for the group the job names (after a transfer of
 * ownership, the previous owner while their subscription runs out), when that notice is still in
 * force as the job runs: a trial that was converted, a payment that went through or a cancellation
 * that was undone sends nothing. A trial's notice is sent only by the job queued for the trial's
 * current end, so a trial whose end moved is told once. The owner's first proven address gets it.
 * A failed send throws, so the job is retried.
 *
 * The notice is judged at the job's run time, or later when it runs late, so a worker whose clock
 * is a little behind the database's still sends it.
 */
export function billingNoticeMailJob(
  kind: BillingNoticeKind,
  {
    sql,
    sender,
    brand,
    log,
    now = () => new Date(),
    graceDays = 0,
    trialRequiresCard = true,
  }: BillingNoticeMailDeps,
): JobHandler {
  const billing = new PostgresBillingRepository(sql)
  return async (event) => {
    if (!sender) return
    const groupId = event.aggregateId
    const runAt = Number(event.aggregateVersion)
    const subscription = await billing.get(groupId)
    const judgedAt = new Date(Math.max(now().getTime(), runAt))
    if (!inForce(kind, subscription, judgedAt, runAt)) return
    // The owner who pays: after a transfer of ownership (#250) the old owner's subscription stays
    // theirs until it ends, so its notices go to them and never to the new owner.
    const [owner] = await sql<OwnerRow[]>`
      WITH payer AS (
        SELECT groups.id, groups.name, CASE WHEN handed.provider_customer_id IS NULL
          THEN groups.owner_user_id ELSE handed.previous_owner_user_id END AS user_id
        FROM groups
        LEFT JOIN subscriptions ON subscriptions.group_id = groups.id
        LEFT JOIN billing_handed_over_customers AS handed
          ON handed.provider_customer_id = subscriptions.provider_customer_id
        WHERE groups.id = ${groupId} AND groups.deleted_at IS NULL
      )
      SELECT payer.name, (
        SELECT auth_keys.proven_email FROM auth_keys
        WHERE auth_keys.user_id = payer.user_id AND auth_keys.proven_email IS NOT NULL
        ORDER BY auth_keys.id
        LIMIT 1
      ) AS email
      FROM payer
    `
    if (!owner) return
    if (!owner.email) {
      log("warn: a billing notice was not sent: the group's owner has no proven address")
      return
    }
    const result = await sender.send(billingNoticeMail(brand, {
      to: owner.email,
      kind,
      groupName: owner.name,
      planName: findPlan(subscription.planId ?? "")?.name ?? "paid",
      at: accessEndsAt(subscription) ?? new Date(runAt),
      link: new URL(`/groups/${encodeURIComponent(groupId)}/billing`, brand.webAppUrl).href,
      planKeptUntil: planKeptUntil(subscription, judgedAt, graceDays),
      trialHasCard: trialRequiresCard,
    }))
    if (!result.ok) {
      log("error: a billing notice mail was not sent and will be retried")
      throw new Error("billing notice mail not sent")
    }
  }
}

/**
 * Until when a past-due subscription keeps its plan: the end of its grace, or the end of a
 * cancelled period when that comes first. `null` when the group is on the free plan at `at`.
 */
function planKeptUntil(
  subscription: StoredSubscription,
  at: Date,
  graceDays: number,
): Date | null {
  if (effectivePlanId(subscription, at, graceDays) === FREE_PLAN_ID) return null
  const ends = [graceEndsAt(subscription, graceDays), accessEndsAt(subscription)]
    .filter((date): date is Date => date !== null)
  return ends.length === 0 ? null : new Date(Math.min(...ends.map((date) => date.getTime())))
}

function inForce(
  kind: BillingNoticeKind,
  subscription: StoredSubscription | null,
  at: Date,
  runAt: number,
): subscription is StoredSubscription {
  if (billingNoticeKindOf(subscription, at) !== kind) return false
  if (kind !== BillingNoticeKind.TrialEnding) return true
  const trialEnd = subscription?.trialEnd ?? null
  return trialEnd !== null && trialNoticeAt(trialEnd).getTime() === runAt
}
