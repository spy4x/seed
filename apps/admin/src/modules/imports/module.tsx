import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useSearch } from "wouter-preact"
import { IconArrowDownTray } from "@spy4x/preact-icons"
import {
  type AdminImportFilter,
  adminImportFilterQuery,
  parseAdminImportFilter,
} from "@domain/imports"
import { ADMIN_IMPORTS_PATH, AdminImportsScreen } from "@ui/admin-imports-screen.tsx"
import type { AdminContext, AdminModule } from "../types.ts"
import { createImportsState, type ImportsState } from "./state.ts"

/** One Imports state per signed-in session: a new session starts with an empty list. */
const states = new WeakMap<AdminContext, ImportsState>()

function importsState(context: AdminContext): ImportsState {
  let state = states.get(context)
  if (!state) {
    state = createImportsState(context.request)
    states.set(context, state)
  }
  return state
}

/** The Imports page. Its status chip and page live in the address. */
function ImportsView({ context }: { context: AdminContext }): JSX.Element {
  const state = importsState(context)
  const search = useSearch()
  const filter = useMemo(() => parseAdminImportFilter(new URLSearchParams(search)), [search])
  useEffect(() => {
    state.load(filter)
  }, [filter])
  const list = state.list.value
  const go = (next: AdminImportFilter) => {
    const query = adminImportFilterQuery(next)
    context.navigate(query ? `${ADMIN_IMPORTS_PATH}?${query}` : ADMIN_IMPORTS_PATH)
  }
  return (
    <AdminImportsScreen
      filter={filter}
      list={list.list}
      pending={list.pending}
      error={list.error}
      onFilter={go}
      onReload={() => state.load(filter)}
      navigate={context.navigate}
    />
  )
}

/** Every group's file imports: where each is, its counts and timing, and why one failed. */
export const importsModule: AdminModule = {
  id: `imports`,
  nav: { name: `AdminNav.imports`, href: ADMIN_IMPORTS_PATH, Icon: IconArrowDownTray },
  routes: [{ path: ADMIN_IMPORTS_PATH, View: ImportsView }],
}
