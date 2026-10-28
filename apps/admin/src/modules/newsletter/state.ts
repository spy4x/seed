import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import { downloadResponseAsFile } from "@spy4x/platform/browser/download"
import {
  type AdminNewsletterSend,
  type AdminNewsletterSendsResponse,
  type AdminNewsletterStats,
  type AdminSubscriberFilter,
  adminSubscriberFilterQuery,
  type AdminSubscriberListResponse,
} from "@domain/subscribers"
import type { AdminSubscriberAction, AdminSubscriberDialog } from "@ui/admin-newsletter-screen.tsx"
import { adminFailure, type AdminFetch, post } from "../../state.ts"
import { adminText } from "../../i18n.ts"
import { readApiError } from "@domain/errors"

const API = `/api/admin/newsletter`

/** What the toast says after each action went through. */
const ACTION_DONE: Record<AdminSubscriberAction, string> = {
  remove: `AdminNewsletter.doneRemove`,
  resend: `AdminNewsletter.doneResend`,
}

export interface NewsletterListState {
  /** The filter of the page the list shows, or is loading. */
  filter: AdminSubscriberFilter | null
  list: AdminSubscriberListResponse | null
  pending: boolean
  error: string | null
}

export interface NewsletterDialogState {
  dialog: AdminSubscriberDialog | null
  /** Why the API refused the action, or `null`. */
  error: string | null
  pending: boolean
}

/** One read that is either loaded, failed or still on its way. */
export interface Loaded<T> {
  data: T | null
  error: string | null
}

/** What the export needs from the platform: a raw `fetch`, the file save and today's date. */
export interface NewsletterExportPorts {
  fetch: (path: string, init: RequestInit) => Promise<Response>
  save: (response: Response, filename: string) => Promise<void>
  now: () => Date
}

const browserExport: NewsletterExportPorts = {
  fetch: (path, init) => fetch(path, init),
  save: (response, filename) => downloadResponseAsFile(response, filename),
  now: () => new Date(),
}

const NO_DIALOG: NewsletterDialogState = { dialog: null, error: null, pending: false }

/**
 * The newsletter module's state: the numbers, the list, the sent issues, the action dialog and the
 * export. Every JSON call goes through the app's `request`, which signs the app out on a 401. The
 * export reads a file, not JSON, so it calls `fetch` itself and reports a failure as a toast.
 */
export function createNewsletterState(
  request: AdminFetch,
  toasts: ToastStore,
  ports: NewsletterExportPorts = browserExport,
) {
  const stats = signal<Loaded<AdminNewsletterStats>>({ data: null, error: null })
  const list = signal<NewsletterListState>({
    filter: null,
    list: null,
    pending: false,
    error: null,
  })
  const sends = signal<Loaded<readonly AdminNewsletterSend[]>>({ data: null, error: null })
  const dialog = signal<NewsletterDialogState>(NO_DIALOG)
  /** Counts the actions that went through, so the screen can move focus after each. */
  const done = signal(0)
  /** The search typed on the list. Kept here for the session, never in the page's address. */
  const query = signal(``)
  const exporting = signal(false)

  const state = {
    stats,
    list,
    sends,
    dialog,
    done,
    exporting,
    query,

    async loadStats(): Promise<void> {
      stats.value = { ...stats.value, error: null }
      const result = await request<AdminNewsletterStats>(`${API}/stats`)
      stats.value = result.ok
        ? { data: result.data, error: null }
        : { ...stats.value, error: result.error.message }
    },

    /**
     * Reads one page of the list. The filter goes in the body of a `POST`, never in the URL, so
     * the search text stays out of access logs.
     */
    async loadList(filter: AdminSubscriberFilter): Promise<void> {
      list.value = { ...list.value, filter, pending: true, error: null }
      const body = Object.fromEntries(new URLSearchParams(adminSubscriberFilterQuery(filter)))
      const result = await request<AdminSubscriberListResponse>(
        `${API}/subscribers/search`,
        post(body),
      )
      // An answer for a filter the page has left is dropped.
      if (list.value.filter !== filter) return
      list.value = result.ok
        ? { filter, list: result.data, pending: false, error: null }
        : { ...list.value, pending: false, error: result.error.message }
    },

    async loadSends(): Promise<void> {
      sends.value = { ...sends.value, error: null }
      const result = await request<AdminNewsletterSendsResponse>(`${API}/sends`)
      sends.value = result.ok
        ? { data: result.data.sends, error: null }
        : { ...sends.value, error: result.error.message }
    },

    openDialog(next: AdminSubscriberDialog): void {
      dialog.value = { dialog: next, error: null, pending: false }
    },

    closeDialog(): void {
      if (dialog.value.pending) return
      dialog.value = NO_DIALOG
    },

    /**
     * Sends the open dialog's action. On success the dialog closes, a toast says what happened,
     * and the list and the numbers are read again, so the change shows.
     */
    async confirm(): Promise<void> {
      const { dialog: open, pending } = dialog.value
      if (!open || pending) return
      dialog.value = { dialog: open, error: null, pending: true }
      const result = await request<unknown>(
        `${API}/subscribers/${open.action}`,
        post({ email: open.email }),
      )
      if (!result.ok) {
        dialog.value = { dialog: open, error: result.error.message, pending: false }
        return
      }
      dialog.value = NO_DIALOG
      toasts.success({
        body: adminText().t(ACTION_DONE[open.action], { email: open.email }),
        dataE2E: `admin-action-toast`,
      })
      done.value += 1
      const filter = list.value.filter
      await Promise.all([filter ? state.loadList(filter) : undefined, state.loadStats()])
    },

    /** Downloads every address as a CSV. One export at a time. */
    async exportCsv(): Promise<void> {
      if (exporting.value) return
      exporting.value = true
      try {
        const response = await ports.fetch(`${API}/subscribers/export`, {
          method: `POST`,
          credentials: `include`,
          headers: { "content-type": `application/json` },
        })
        if (!response.ok) {
          const message = readApiError(await response.json().catch(() => null))?.message ??
            adminFailure()
          toasts.error({ body: message, dataE2E: `admin-export-error` })
          return
        }
        const day = ports.now().toISOString().slice(0, 10)
        await ports.save(response, `newsletter-subscribers-${day}.csv`)
      } catch {
        toasts.error({ body: adminFailure(), dataE2E: `admin-export-error` })
      } finally {
        exporting.value = false
      }
    },
  }
  return state
}

export type NewsletterState = ReturnType<typeof createNewsletterState>
