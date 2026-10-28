import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import { formatMoney } from "@spy4x/platform/universal/money"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  type AdminBillingActionResponse,
  type AdminBillingDetail,
  type AdminBillingFigures,
  type AdminBillingFiguresResponse,
  type AdminBillingFilter,
  adminBillingFilterQuery,
  type AdminBillingListResponse,
  type AdminBillingPaymentResponse,
} from "@domain/billing"
import type {
  AdminBillingAction,
  AdminBillingActionError,
  AdminBillingDialogKind,
  AdminBillingPaymentView,
  AdminBillingWaiting,
} from "@ui/admin-billing-detail.tsx"
import { billingDate } from "@ui/admin-billing-list.tsx"
import { createFormatters, type Formatters } from "@spy4x/time/format"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { adminText } from "../../i18n.ts"

/**
 * What an action's dialog says when no clear answer came back: the action may have happened in
 * Stripe, so it never says that nothing changed. A retry from the same dialog sends the same
 * idempotency key, so it acts once.
 */
const NO_ANSWER = `AdminBillingCustomer.noAnswer`

/** How long the page waits for Stripe's webhook after an action before it points to Stripe. */
export const ADMIN_BILLING_WAIT_MS = 2 * 60 * 1000

/** How often the page reads the customer again while it waits. */
export const ADMIN_BILLING_POLL_MS = 5 * 1000

/** The clock the waiting notice runs on; tests pass their own. */
export interface BillingClock {
  now: () => number
  /** Resolves after `ms`. */
  sleep: (ms: number) => Promise<void>
}

const SYSTEM_CLOCK: BillingClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export interface BillingListState {
  /** The filter of the page the list shows, or is loading. */
  filter: AdminBillingFilter | null
  list: AdminBillingListResponse | null
  pending: boolean
  error: string | null
}

export interface BillingFiguresState {
  /** `false` while billing is off; the list says so for the whole page. */
  figures: AdminBillingFigures | null
  error: string | null
}

export interface BillingCustomerState {
  groupId: string | null
  detail: AdminBillingDetail | null
  error: string | null
  payment: AdminBillingPaymentView
  waiting: AdminBillingWaiting | null
}

export interface BillingDialogState {
  dialog: AdminBillingDialogKind | null
  /** Made when the dialog opens and sent with every try, so a retry acts once. */
  idempotencyKey: string | null
  error: AdminBillingActionError | null
  pending: boolean
}

const NO_DIALOG: BillingDialogState = {
  dialog: null,
  idempotencyKey: null,
  error: null,
  pending: false,
}

const NO_CUSTOMER: BillingCustomerState = {
  groupId: null,
  detail: null,
  error: null,
  payment: { payment: undefined, error: null },
  waiting: null,
}

/**
 * Whether a failed action may still have happened: no answer at all, or an answer the API marks
 * as unclear, or a server failure that is not Stripe's plain refusal.
 */
export function resultUnknown(result: { status: number; error: { reason?: string } }): boolean {
  if (result.status === 0) return true
  if (result.error.reason === `result_unknown`) return true
  return result.status >= 500 && result.error.reason !== `provider_refused`
}

/** The request of each action: its path under `/api/admin/billing/:groupId/` and its body. */
function actionRequest(
  action: AdminBillingAction,
  idempotencyKey: string,
): { path: string; body: Record<string, unknown> } {
  const note = action.note === `` ? {} : { note: action.note }
  switch (action.kind) {
    case `refund`:
      return { path: `refund`, body: { idempotencyKey, paymentId: action.paymentId, ...note } }
    case `time`:
      return { path: `time`, body: { idempotencyKey, length: action.length, ...note } }
    case `cancel`:
      return { path: `cancel`, body: { idempotencyKey, when: action.when, ...note } }
    case `undo`:
      return { path: `undo-cancel`, body: { idempotencyKey, ...note } }
  }
}

/** What the toast says after an action went through. */
function actionDone(
  action: AdminBillingAction,
  answer: AdminBillingActionResponse,
  format: Pick<Formatters, "date">,
): string {
  const { customer } = answer.detail
  const t = adminText()
  const group = customer.groupName
  const periodEnd = customer.currentPeriodEnd
    ? billingDate(customer.currentPeriodEnd, format)
    : null
  switch (action.kind) {
    case `refund`:
      return answer.refunded
        ? t.t(`AdminBillingCustomer.doneRefundAmount`, {
          amount: formatMoney(answer.refunded.amount, answer.refunded.currency),
          group,
        })
        : t.t(`AdminBillingCustomer.doneRefund`, { group })
    case `time`:
      return answer.until
        ? t.t(`AdminBillingCustomer.doneTimeUntil`, {
          group,
          date: billingDate(answer.until, format),
        })
        : t.t(`AdminBillingCustomer.doneTime`, { group })
    case `cancel`:
      return action.when === `now`
        ? t.t(`AdminBillingCustomer.doneCancelNow`, { group })
        : periodEnd
        ? t.t(`AdminBillingCustomer.doneCancelOn`, { group, date: periodEnd })
        : t.t(`AdminBillingCustomer.doneCancelEnd`, { group })
    case `undo`:
      return periodEnd
        ? t.t(`AdminBillingCustomer.doneUndoOn`, { group, date: periodEnd })
        : t.t(`AdminBillingCustomer.doneUndo`, { group })
  }
}

/**
 * The billing module's state: the figures, the list, the open customer with its last payment, the
 * action dialog and the wait for Stripe's webhook. Every call goes through the app's `request`,
 * which signs the app out on a 401, so this state never handles one.
 */
export function createBillingState(
  request: AdminFetch,
  toasts: ToastStore,
  clock: BillingClock = SYSTEM_CLOCK,
  format: () => Pick<Formatters, "date"> = () => createFormatters(),
) {
  const figures = signal<BillingFiguresState>({ figures: null, error: null })
  const list = signal<BillingListState>({ filter: null, list: null, pending: false, error: null })
  const customer = signal<BillingCustomerState>(NO_CUSTOMER)
  const dialog = signal<BillingDialogState>(NO_DIALOG)
  /** Bumped by every new wait, so an older poll stops. */
  let waitRun = 0

  const customerPath = (groupId: string) => `/api/admin/billing/${encodeURIComponent(groupId)}`

  async function readCustomer(groupId: string): Promise<AdminApiResult<AdminBillingDetail>> {
    return await request<AdminBillingDetail>(customerPath(groupId))
  }

  /**
   * Reads the customer every few seconds until its stored subscription changes, which means the
   * webhook landed, or until two minutes pass, when the notice points to Stripe instead.
   */
  async function waitForStripe(groupId: string, updatedAt: string): Promise<void> {
    const run = ++waitRun
    const started = clock.now()
    customer.value = { ...customer.value, waiting: { timedOut: false } }
    while (true) {
      await clock.sleep(ADMIN_BILLING_POLL_MS)
      if (run !== waitRun || customer.value.groupId !== groupId) return
      const result = await readCustomer(groupId)
      if (run !== waitRun || customer.value.groupId !== groupId) return
      if (result.ok && result.data.customer.updatedAt !== updatedAt) {
        customer.value = { ...customer.value, detail: result.data, waiting: null }
        return
      }
      if (clock.now() - started >= ADMIN_BILLING_WAIT_MS) {
        customer.value = { ...customer.value, waiting: { timedOut: true } }
        return
      }
    }
  }

  /** Asks Stripe, through the API, for the customer's last payment. Never for the list. */
  async function loadPayment(groupId: string): Promise<void> {
    if (customer.value.groupId !== groupId) return
    customer.value = { ...customer.value, payment: { payment: undefined, error: null } }
    const result = await request<AdminBillingPaymentResponse>(`${customerPath(groupId)}/payment`)
    if (customer.value.groupId !== groupId) return
    customer.value = {
      ...customer.value,
      payment: result.ok
        ? { payment: result.data.payment, error: null }
        : { payment: undefined, error: result.error.message },
    }
  }

  return {
    figures,
    list,
    customer,
    dialog,

    async loadFigures(): Promise<void> {
      figures.value = { ...figures.value, error: null }
      const result = await request<AdminBillingFiguresResponse>(`/api/admin/billing/figures`)
      figures.value = !result.ok
        ? { figures: null, error: result.error.message }
        : { figures: result.data.enabled ? result.data.figures : null, error: null }
    },

    async loadList(filter: AdminBillingFilter): Promise<void> {
      list.value = { ...list.value, filter, pending: true, error: null }
      const query = adminBillingFilterQuery(filter)
      const result = await request<AdminBillingListResponse>(
        `/api/admin/billing/customers${query ? `?${query}` : ``}`,
      )
      // An answer for a filter the page has left is dropped.
      if (list.value.filter !== filter) return
      list.value = result.ok
        ? { filter, list: result.data, pending: false, error: null }
        : { ...list.value, list: null, pending: false, error: result.error.message }
    },

    async loadCustomer(groupId: string): Promise<void> {
      if (customer.value.groupId !== groupId) {
        waitRun++
        customer.value = { ...NO_CUSTOMER, groupId }
      } else {
        customer.value = { ...customer.value, error: null }
      }
      const result = await readCustomer(groupId)
      if (customer.value.groupId !== groupId) return
      customer.value = result.ok
        ? { ...customer.value, detail: result.data, error: null }
        : { ...customer.value, detail: null, error: result.error.message }
    },

    loadPayment,

    /** Opens a dialog with a fresh idempotency key, which every try from it sends. */
    openDialog(next: AdminBillingDialogKind): void {
      dialog.value = { dialog: next, idempotencyKey: uuidV7(), error: null, pending: false }
    },

    closeDialog(): void {
      if (dialog.value.pending) return
      dialog.value = NO_DIALOG
    },

    /**
     * Sends the confirmed action with the dialog's idempotency key. On success the dialog closes,
     * a toast says what happened, and, unless it was a refund, the page waits for Stripe's
     * webhook to change the stored subscription. On failure the dialog stays open with the reason;
     * when no clear answer came back it says the result is unknown, never that nothing changed.
     */
    async act(action: AdminBillingAction): Promise<void> {
      const open = dialog.value
      const { groupId, detail } = customer.value
      if (!open.dialog || !open.idempotencyKey || open.pending || !groupId || !detail) return
      dialog.value = { ...open, error: null, pending: true }
      const { path, body } = actionRequest(action, open.idempotencyKey)
      const result = await request<AdminBillingActionResponse>(
        `${customerPath(groupId)}/${path}`,
        { method: `POST`, body: JSON.stringify(body) },
      )
      if (!result.ok) {
        const unknown = resultUnknown(result)
        dialog.value = {
          ...open,
          pending: false,
          error: {
            unknown,
            message: result.status === 0 ? adminText().t(NO_ANSWER) : result.error.message,
          },
        }
        return
      }
      dialog.value = NO_DIALOG
      toasts.success({
        body: actionDone(action, result.data, format()),
        dataE2E: `admin-billing-toast`,
      })
      if (customer.value.groupId !== groupId) return
      customer.value = { ...customer.value, detail: result.data.detail }
      if (action.kind === `refund`) {
        await loadPayment(groupId)
        return
      }
      // The webhook may have landed before the answer; then there is nothing to wait for.
      const before = detail.customer.updatedAt
      if (result.data.detail.customer.updatedAt === before) await waitForStripe(groupId, before)
    },

    /** Stops a wait for Stripe, as when the page closes. */
    stopWaiting(): void {
      waitRun++
    },
  }
}

export type BillingState = ReturnType<typeof createBillingState>
