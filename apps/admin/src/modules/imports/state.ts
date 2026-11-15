import { signal } from "@preact/signals"
import {
  type AdminImportFilter,
  adminImportFilterQuery,
  type AdminImportListResponse,
} from "@domain/imports"
import type { AdminFetch } from "../../state.ts"

export interface ImportsListState {
  /** The filter of the page the list shows, or is loading. */
  filter: AdminImportFilter | null
  list: AdminImportListResponse | null
  pending: boolean
  error: string | null
}

/**
 * The Imports module's state: one page of every group's imports. An answer for a filter the page
 * has left is dropped, so a slow page never replaces the one the operator moved to.
 */
export function createImportsState(request: AdminFetch) {
  const list = signal<ImportsListState>({ filter: null, list: null, pending: false, error: null })
  return {
    list,
    async load(filter: AdminImportFilter): Promise<void> {
      list.value = { ...list.value, filter, pending: true, error: null }
      const query = adminImportFilterQuery(filter)
      const result = await request<AdminImportListResponse>(
        `/api/admin/imports${query ? `?${query}` : ``}`,
      )
      if (list.value.filter !== filter) return
      list.value = result.ok
        ? { filter, list: result.data, pending: false, error: null }
        : { ...list.value, pending: false, error: result.error.message }
    },
  }
}

export type ImportsState = ReturnType<typeof createImportsState>
