import { type Signal, signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import {
  type AdminApiToken,
  type AdminApiTokenFilter,
  adminApiTokenFilterQuery,
  type AdminApiTokenListResponse,
  type AdminUserApiTokensResponse,
} from "@domain/api-tokens"
import type { AdminPushDevice, AdminPushDevicesResponse } from "@domain/identity"
import type { AdminNotificationsResponse } from "@domain/notifications"
import type { AdminTokensConfirm, AdminTokensConfirmState } from "@ui/admin-api-tokens-screen.tsx"
import { type AdminFetch, post } from "../../state.ts"

export interface TokensListState {
  /** The filter of the page the list shows, or is loading. */
  filter: AdminApiTokenFilter | null
  list: AdminApiTokenListResponse | null
  pending: boolean
  error: string | null
}

/** One of the person's tabs: whose it is, what the API answered and why it failed. */
export interface PersonPanelState<T> {
  userId: number | null
  data: T | null
  error: string | null
}

const NO_CONFIRM: AdminTokensConfirmState = { target: null, error: null, pending: false }

function emptyPanel<T>(): PersonPanelState<T> {
  return { userId: null, data: null, error: null }
}

/**
 * The api-tokens module's state: the token page, the person's three tabs and the confirm dialog
 * they share. Every call goes through the app's `request`, which signs the app out on a 401, so
 * this state never handles one.
 */
export function createApiTokensState(request: AdminFetch, toasts: ToastStore) {
  const list = signal<TokensListState>({ filter: null, list: null, pending: false, error: null })
  const tokens = signal<PersonPanelState<AdminApiToken[]>>(emptyPanel())
  const devices = signal<PersonPanelState<AdminPushDevice[]>>(emptyPanel())
  const notifications = signal<PersonPanelState<AdminNotificationsResponse>>(emptyPanel())
  const confirm = signal<AdminTokensConfirmState>(NO_CONFIRM)

  /** Reads one person's panel into `panel`, dropping an answer for a person the page has left. */
  async function loadPanel<A, T>(
    panel: Signal<PersonPanelState<T>>,
    userId: number,
    path: string,
    pick: (answer: A) => T,
  ): Promise<void> {
    if (panel.value.userId !== userId) panel.value = { userId, data: null, error: null }
    const result = await request<A>(path)
    if (panel.value.userId !== userId) return
    panel.value = result.ok
      ? { userId, data: pick(result.data), error: null }
      : { userId, data: null, error: result.error.message }
  }

  const state = {
    list,
    tokens,
    devices,
    notifications,
    confirm,

    async loadList(filter: AdminApiTokenFilter): Promise<void> {
      list.value = { ...list.value, filter, pending: true, error: null }
      const query = adminApiTokenFilterQuery(filter)
      const result = await request<AdminApiTokenListResponse>(
        `/api/admin/api-tokens${query ? `?${query}` : ""}`,
      )
      // An answer for a filter the page has left is dropped.
      if (list.value.filter !== filter) return
      list.value = result.ok
        ? { filter, list: result.data, pending: false, error: null }
        : { ...list.value, pending: false, error: result.error.message }
    },

    loadTokens(userId: number): Promise<void> {
      return loadPanel(
        tokens,
        userId,
        `/api/admin/users/${userId}/api-tokens`,
        (answer: AdminUserApiTokensResponse) => answer.tokens,
      )
    },

    loadDevices(userId: number): Promise<void> {
      return loadPanel(
        devices,
        userId,
        `/api/admin/users/${userId}/devices`,
        (answer: AdminPushDevicesResponse) => answer.devices,
      )
    },

    loadNotifications(userId: number): Promise<void> {
      return loadPanel(
        notifications,
        userId,
        `/api/admin/users/${userId}/notifications`,
        (answer: AdminNotificationsResponse) => answer,
      )
    },

    ask(target: AdminTokensConfirm): void {
      confirm.value = { target, error: null, pending: false }
    },

    closeConfirm(): void {
      if (confirm.value.pending) return
      confirm.value = NO_CONFIRM
    },

    /**
     * Sends the confirmed revoke or removal. It asks for no password: the API records the operator
     * in the audit trail. On success the dialog closes, a toast says what happened, and every list
     * on screen that showed the token or device is read again.
     */
    async confirmAction(): Promise<void> {
      const { target, pending } = confirm.value
      if (!target || pending) return
      confirm.value = { target, error: null, pending: true }
      const result = await request<{ ok: true }>(
        target.kind === "revoke"
          ? `/api/admin/api-tokens/${target.token.id}/revoke`
          : `/api/admin/users/${target.userId}/devices/${target.deviceId}/remove`,
        post(),
      )
      if (!result.ok) {
        confirm.value = { target, error: result.error.message, pending: false }
        return
      }
      confirm.value = NO_CONFIRM
      if (target.kind === "revoke") {
        toasts.success({
          body: `${target.token.name} is revoked.`,
          dataE2E: "admin-api-tokens-toast",
        })
        const reads: Promise<void>[] = []
        if (list.value.filter) reads.push(state.loadList(list.value.filter))
        if (tokens.value.userId === target.token.owner.id) {
          reads.push(state.loadTokens(target.token.owner.id))
        }
        await Promise.all(reads)
        return
      }
      toasts.success({
        body: `Device ${target.label} is removed.`,
        dataE2E: "admin-api-tokens-toast",
      })
      await state.loadDevices(target.userId)
    },
  }
  return state
}

export type ApiTokensState = ReturnType<typeof createApiTokensState>
