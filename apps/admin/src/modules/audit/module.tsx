import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useSearch } from "wouter-preact"
import { IconShieldCheck } from "@spy4x/preact-icons"
import {
  type AdminAuditFilter,
  adminAuditFilterQuery,
  parseAdminAuditFilter,
} from "@domain/identity"
import { AdminAuditScreen, type AdminAuditView } from "@ui/admin-audit-screen.tsx"
import type { AdminContext, AdminModule } from "../types.ts"
import { auditPath, type AuditState, createAuditState } from "./state.ts"

/** The audit log's page. */
export const AUDIT_PATH = `/audit`

/** One audit state per signed-in session. */
const states = new WeakMap<AdminContext, AuditState>()

function auditState(context: AdminContext): AuditState {
  let state = states.get(context)
  if (!state) {
    state = createAuditState(context.request)
    states.set(context, state)
  }
  return state
}

/** The log. Its filter and view live in the address, so back and forward step through them. */
function AuditView({ context }: { context: AdminContext }): JSX.Element {
  const state = auditState(context)
  const search = useSearch()
  const params = useMemo(() => new URLSearchParams(search), [search])
  const filter = useMemo(() => parseAdminAuditFilter(params), [params])
  const view: AdminAuditView = params.get(`view`) === `timeline` ? `timeline` : `table`
  const scope = adminAuditFilterQuery(filter)
  useEffect(() => {
    state.loadOperators()
  }, [state])
  useEffect(() => {
    state.load(filter)
  }, [scope])
  const log = state.log.value
  const go = (next: AdminAuditFilter, nextView: AdminAuditView = view) => {
    const query = new URLSearchParams(adminAuditFilterQuery(next))
    if (nextView === `timeline`) query.set(`view`, `timeline`)
    const text = query.toString()
    context.navigate(text ? `${AUDIT_PATH}?${text}` : AUDIT_PATH)
  }
  return (
    <AdminAuditScreen
      filter={filter}
      operators={state.operators.value}
      view={view}
      entries={log.entries}
      hasMore={log.next !== null}
      pending={log.pending}
      loadingMore={log.loadingMore}
      error={log.error}
      exportHref={auditPath(`/api/admin/audit/export.csv`, filter)}
      onFilter={(next) => go(next)}
      onView={(next) => go(filter, next)}
      onMore={() => state.more()}
      navigate={context.navigate}
    />
  )
}

/** Every audit entry across the product, filtered, paged and exported as CSV (#429). */
export const auditModule: AdminModule = {
  id: `audit`,
  nav: { name: `AdminNav.auditLog`, href: AUDIT_PATH, Icon: IconShieldCheck },
  routes: [{ path: AUDIT_PATH, View: AuditView }],
}
