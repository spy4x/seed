import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useSearch } from "wouter-preact"
import { IconMail } from "@spy4x/preact-icons"
import {
  type AdminSubscriberFilter,
  adminSubscriberFilterQuery,
  parseAdminSubscriberFilter,
} from "@domain/subscribers"
import { AdminNewsletterScreen, type AdminNewsletterTab } from "@ui/admin-newsletter-screen.tsx"
import type { AdminContext, AdminModule } from "../types.ts"
import { createNewsletterState, type NewsletterState } from "./state.ts"

const PATH = `/newsletter`

/** One newsletter state per signed-in session: a new session starts with nothing loaded. */
const states = new WeakMap<AdminContext, NewsletterState>()

function newsletterState(context: AdminContext): NewsletterState {
  let state = states.get(context)
  if (!state) {
    state = createNewsletterState(context.request, context.toasts)
    states.set(context, state)
  }
  return state
}

/** The page's address for a filter and a tab; each part at its default is left out. */
export function newsletterHref(filter: AdminSubscriberFilter, tab: AdminNewsletterTab): string {
  const params = new URLSearchParams(adminSubscriberFilterQuery(filter))
  if (tab !== `subscribers`) params.set(`tab`, tab)
  const query = params.toString()
  return query ? `${PATH}?${query}` : PATH
}

/** The page. Its filter and open tab live in the address, so back and forward step through them. */
function NewsletterView({ context }: { context: AdminContext }): JSX.Element {
  const state = newsletterState(context)
  const search = useSearch()
  const params = useMemo(() => new URLSearchParams(search), [search])
  const filter = useMemo(() => parseAdminSubscriberFilter(params), [params])
  const tab: AdminNewsletterTab = params.get(`tab`) === `sends` ? `sends` : `subscribers`
  useEffect(() => {
    state.closeDialog()
    state.loadStats()
    state.loadSends()
  }, [context])
  useEffect(() => {
    state.loadList(filter)
  }, [filter])
  const list = state.list.value
  const dialog = state.dialog.value
  const go = (next: AdminSubscriberFilter) => context.navigate(newsletterHref(next, tab))
  return (
    <AdminNewsletterScreen
      tab={tab}
      onTab={(next) => context.navigate(newsletterHref(filter, next), { replace: true })}
      stats={state.stats.value.data}
      statsError={state.stats.value.error}
      filter={filter}
      list={list.list}
      pending={list.pending}
      error={list.error}
      onSearch={go}
      onPage={(page) => go({ ...filter, page })}
      sends={state.sends.value.data}
      sendsError={state.sends.value.error}
      onRetry={() => {
        state.loadStats()
        state.loadSends()
        state.loadList(filter)
      }}
      dialog={dialog.dialog}
      dialogError={dialog.error}
      dialogPending={dialog.pending}
      onOpenDialog={state.openDialog}
      onCloseDialog={state.closeDialog}
      onConfirm={() => state.confirm()}
      done={state.done.value}
      exporting={state.exporting.value}
      onExport={() => state.exportCsv()}
    />
  )
}

/** The newsletter's subscribers, numbers and sent issues, with remove, resend and export (#428). */
export const newsletterModule: AdminModule = {
  id: `newsletter`,
  nav: { name: `Newsletter`, href: PATH, Icon: IconMail },
  routes: [{ path: PATH, View: NewsletterView }],
}
