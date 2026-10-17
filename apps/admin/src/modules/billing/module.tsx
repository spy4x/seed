import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useSearch } from "wouter-preact"
import { IconCreditCard } from "@spy4x/preact-icons"
import {
  type AdminBillingFilter,
  adminBillingFilterQuery,
  parseAdminBillingFilter,
} from "@domain/billing"
import { ADMIN_BILLING_PATHS, AdminBillingListScreen } from "@ui/admin-billing-list.tsx"
import { AdminBillingCustomerScreen } from "@ui/admin-billing-detail.tsx"
import { operatorOf } from "../../state.ts"
import type { AdminContext, AdminModule } from "../types.ts"
import { type BillingState, createBillingState } from "./state.ts"

/** One billing state per signed-in session: a new session starts with nothing loaded. */
const states = new WeakMap<AdminContext, BillingState>()

function billingState(context: AdminContext): BillingState {
  let state = states.get(context)
  if (!state) {
    state = createBillingState(context.request, context.toasts, undefined, context.format)
    states.set(context, state)
  }
  return state
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The figures and the list. The search, chip and page live in the address. */
function BillingView({ context }: { context: AdminContext }): JSX.Element {
  const state = billingState(context)
  const search = useSearch()
  const filter = useMemo(() => parseAdminBillingFilter(new URLSearchParams(search)), [search])
  useEffect(() => {
    state.loadFigures()
  }, [])
  useEffect(() => {
    state.loadList(filter)
  }, [filter])
  const list = state.list.value
  const figures = state.figures.value
  const go = (next: AdminBillingFilter) => {
    const query = adminBillingFilterQuery(next)
    context.navigate(query ? `${ADMIN_BILLING_PATHS.list}?${query}` : ADMIN_BILLING_PATHS.list)
  }
  return (
    <AdminBillingListScreen
      filter={filter}
      figures={figures.figures}
      figuresError={figures.error}
      list={list.list}
      pending={list.pending}
      error={list.error}
      now={new Date()}
      onSearch={go}
      onPage={(page) => go({ ...filter, page })}
      onRetry={() => {
        if (figures.error) state.loadFigures()
        if (list.error) state.loadList(filter)
      }}
      navigate={context.navigate}
    />
  )
}

/** One customer: the stored subscription, the last payment from Stripe and the actions. */
function CustomerView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const state = billingState(context)
  const id = params.groupId ?? ``
  const groupId = UUID.test(id) ? id.toLowerCase() : null
  useEffect(() => {
    state.closeDialog()
    if (groupId === null) return
    state.loadCustomer(groupId)
    state.loadPayment(groupId)
    return () => state.stopWaiting()
  }, [groupId])
  const customer = state.customer.value
  const dialog = state.dialog.value
  const current = customer.groupId === groupId
  return (
    <AdminBillingCustomerScreen
      detail={current ? customer.detail : null}
      error={groupId === null ? `No customer with this group id.` : current ? customer.error : null}
      payment={current ? customer.payment : { payment: undefined, error: null }}
      operator={operatorOf(context.operator)}
      now={new Date()}
      onRetry={() => groupId && state.loadCustomer(groupId)}
      onRetryPayment={() => groupId && state.loadPayment(groupId)}
      dialog={dialog.dialog}
      onOpenDialog={state.openDialog}
      onCloseDialog={state.closeDialog}
      actionError={dialog.error}
      pending={dialog.pending}
      onAction={(action) => state.act(action)}
      waiting={current ? customer.waiting : null}
      navigate={context.navigate}
    />
  )
}

/** Who pays and what, and the support actions on one customer (#196). */
export const billingModule: AdminModule = {
  id: `billing`,
  nav: { name: `Billing`, href: ADMIN_BILLING_PATHS.list, Icon: IconCreditCard },
  routes: [
    { path: ADMIN_BILLING_PATHS.list, View: BillingView },
    { path: `/billing/:groupId`, View: CustomerView },
  ],
}
