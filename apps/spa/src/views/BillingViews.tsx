import { useEffect, useRef } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import { BillingStatus, findPlan, FREE_PLAN_ID, type GroupBilling } from "@domain/billing"
import type { Translator } from "@spy4x/platform/universal/i18n"
import type { Formatters } from "@spy4x/time/format"
import { GroupBillingPanel, planName } from "@ui/billing-screen.tsx"
import { useAppText } from "@ui/i18n.ts"
import { GROUP_PATHS } from "@ui/progressive.tsx"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"
import { toasts } from "../state/toasts.ts"
import { preferencesState } from "../state/preferences.ts"

/** The query the checkout's success address carries, so the tab knows the owner just paid. */
export const CHECKOUT_DONE = "checkout=done"

/**
 * What the toast says once the provider confirmed the owner's checkout: a started trial is no
 * payment, so it names the trial and its end; a paid start names the plan. In `t`'s words, the
 * group's name isolated from the sentence's direction.
 */
export function checkoutDoneToast(
  t: Translator<string>,
  format: Formatters,
  billing: GroupBilling,
  groupName: string,
): { title: string; body: string } {
  const plan = planName(t, billing.planId)
  const group = `\u2068${groupName}\u2069`
  const trialEnd = billing.status === BillingStatus.Trialing
    ? billing.trialEnd ?? billing.currentPeriodEnd
    : null
  return trialEnd
    ? {
      title: t.t(`GroupBillingView.trialStarted`, {
        count: findPlan(billing.planId)?.trialDays ?? 14,
        plan,
      }),
      body: t.t(`GroupBillingView.trialUntil`, {
        group,
        plan,
        date: format.utc().date(trialEnd, `long`),
      }),
    }
    : {
      title: t.t(`GroupBillingView.paid`, { plan }),
      body: t.t(`GroupBillingView.paidText`, { group }),
    }
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
  const t = useAppText()
  useEffect(() => void billingStore.loadTrial(), [])
  const waiting = useRef(new URLSearchParams(search).get("checkout") === "done")
  useEffect(() => {
    if (search.includes(CHECKOUT_DONE)) navigate(GROUP_PATHS.billing(groupId), { replace: true })
  }, [search])
  const paid = billing !== null && billing.planId !== FREE_PLAN_ID
  useEffect(() => {
    if (!waiting.current || !paid) return
    waiting.current = false
    toasts.success({
      ...checkoutDoneToast(t, preferencesState.format.value, billing, groupName),
      dataE2E: "billing-upgraded",
    })
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
