import { useEffect, useRef } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import {
  billingDate,
  BillingStatus,
  findPlan,
  FREE_PLAN_ID,
  type GroupBilling,
} from "@domain/billing"
import { GroupBillingPanel } from "@ui/billing-screen.tsx"
import { GROUP_PATHS } from "@ui/progressive.tsx"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"
import { toasts } from "../state/toasts.ts"

/** The query the checkout's success address carries, so the tab knows the owner just paid. */
export const CHECKOUT_DONE = "checkout=done"

/**
 * What the toast says once the provider confirmed the owner's checkout: a started trial is no
 * payment, so it names the trial and its end; a paid start names the plan.
 */
export function checkoutDoneToast(
  billing: GroupBilling,
  groupName: string,
): { title: string; body: string } {
  const found = findPlan(billing.planId)
  const plan = found?.name ?? billing.planId
  const trialEnd = billing.status === BillingStatus.Trialing
    ? billing.trialEnd ?? billing.currentPeriodEnd
    : null
  return trialEnd
    ? {
      title: `Your ${found?.trialDays ?? 14}-day ${plan} trial has started`,
      body: `"${groupName}" is on ${plan} until ${billingDate(trialEnd)}.`,
    }
    : { title: `You're on ${plan}`, body: `Stripe confirmed the payment for "${groupName}".` }
}

/**
 * Reads the group's billing when the tab opens and again whenever the group's change sequence
 * moves: a plan change is recorded on the group, so the provider's webhook reaches this tab as an
 * ordinary group hint.
 */
function useGroupBilling(groupId: string) {
  const group = groupsStore.groups.value.find((candidate) => candidate.id === groupId) ?? null
  const sequence = group?.changeSequence
  useEffect(() => {
    void billingStore.load(groupId)
  }, [groupId, sequence])
  const current = billingStore.current.value
  const failure = billingStore.error.value
  return {
    billing: current?.groupId === groupId ? current.billing : null,
    error: failure?.groupId === groupId ? failure.message : null,
    errorId: failure?.groupId === groupId ? failure.id : undefined,
  }
}

/**
 * The group page's Plan and billing tab, wired to the billing store. Back from the provider's
 * checkout (`?checkout=done`), the address loses its query at once, so a reload does not say it
 * again, and a toast says "You're on Pro" as soon as the provider's webhook has changed the plan.
 */
export function GroupBillingView(
  { groupId, groupName, memberCount, ownerName }: {
    groupId: string
    groupName: string
    memberCount: number | null
    ownerName: string | null
  },
) {
  const [, navigate] = useLocation()
  const search = useSearch()
  const { billing, error, errorId } = useGroupBilling(groupId)
  useEffect(() => void billingStore.loadTrial(), [])
  const waiting = useRef(new URLSearchParams(search).get("checkout") === "done")
  useEffect(() => {
    if (search.includes(CHECKOUT_DONE)) navigate(GROUP_PATHS.billing(groupId), { replace: true })
  }, [search])
  const paid = billing !== null && billing.planId !== FREE_PLAN_ID
  useEffect(() => {
    if (!waiting.current || !paid) return
    waiting.current = false
    toasts.success({ ...checkoutDoneToast(billing, groupName), dataE2E: "billing-upgraded" })
  }, [paid])
  return (
    <GroupBillingPanel
      groupId={groupId}
      groupName={groupName}
      billing={billing}
      memberCount={memberCount}
      ownerName={ownerName}
      trial={billingStore.trial.value}
      confirming={waiting.current && !paid}
      error={error}
      errorId={errorId}
      pending={billingStore.pending.value}
      onCheckout={(planId) => void billingStore.checkout(groupId, planId)}
      onPortal={() => void billingStore.portal(groupId)}
    />
  )
}
