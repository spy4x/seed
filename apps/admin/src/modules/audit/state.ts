import { signal } from "@preact/signals"
import {
  type AdminAuditEntry,
  type AdminAuditFilter,
  adminAuditFilterQuery,
  type AdminAuditOperator,
  type AdminAuditPage,
} from "@domain/identity"
import type { AdminFetch } from "../../state.ts"

/** The log as the page shows it: the filter, every entry read for it, and the next cursor. */
export interface AuditLogState {
  /** The filter the entries belong to, or `null` before the first read. */
  filter: AdminAuditFilter | null
  entries: AdminAuditEntry[] | null
  /** The cursor of the next older page, or `null` at the oldest entry. */
  next: string | null
  pending: boolean
  loadingMore: boolean
  error: string | null
}

const EMPTY: AuditLogState = {
  filter: null,
  entries: null,
  next: null,
  pending: false,
  loadingMore: false,
  error: null,
}

/** The path of the log's API with `filter` and, for an older page, its cursor. */
export function auditPath(base: string, filter: AdminAuditFilter, cursor?: string): string {
  const params = new URLSearchParams(adminAuditFilterQuery(filter))
  if (cursor) params.set(`cursor`, cursor)
  const query = params.toString()
  return query ? `${base}?${query}` : base
}

/**
 * The audit module's state: the entries of the current filter, read a page at a time, and the
 * operators the filter offers. Every call goes through the app's `request`, which signs the app out
 * on a 401, so this state never handles one.
 */
export function createAuditState(request: AdminFetch) {
  const log = signal<AuditLogState>(EMPTY)
  const operators = signal<AdminAuditOperator[]>([])
  let operatorsRead = false

  return {
    log,
    operators,

    /** Reads the newest page of `filter`, replacing what the page showed. */
    async load(filter: AdminAuditFilter): Promise<void> {
      log.value = { ...EMPTY, filter, entries: null, pending: true }
      const result = await request<AdminAuditPage>(auditPath(`/api/admin/audit`, filter))
      // An answer for a filter the page has left is dropped.
      if (log.value.filter !== filter) return
      log.value = result.ok
        ? { ...EMPTY, filter, entries: result.data.entries, next: result.data.next }
        : { ...EMPTY, filter, error: result.error.message }
    },

    /** Appends the next older page. One at a time: a second press while one loads does nothing. */
    async more(): Promise<void> {
      const { filter, next, entries, loadingMore } = log.value
      if (!filter || !next || !entries || loadingMore) return
      log.value = { ...log.value, loadingMore: true, error: null }
      const result = await request<AdminAuditPage>(auditPath(`/api/admin/audit`, filter, next))
      if (log.value.filter !== filter) return
      log.value = result.ok
        ? {
          ...log.value,
          entries: [...entries, ...result.data.entries],
          next: result.data.next,
          loadingMore: false,
        }
        : { ...log.value, loadingMore: false, error: result.error.message }
    },

    /** Reads the operator filter's choices once per session; a failure leaves the list empty. */
    async loadOperators(): Promise<void> {
      if (operatorsRead) return
      operatorsRead = true
      const result = await request<{ operators: AdminAuditOperator[] }>(
        `/api/admin/audit/operators`,
      )
      if (result.ok) operators.value = result.data.operators
      else operatorsRead = false
    },
  }
}

export type AuditState = ReturnType<typeof createAuditState>
