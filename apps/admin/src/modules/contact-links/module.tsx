import type { JSX } from "preact"
import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { IconChatBubble } from "@spy4x/preact-icons"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import {
  ADMIN_CONTACT_LINKS_PATHS,
  AdminContactLinkEditorScreen,
  AdminContactLinksScreen,
} from "@ui/admin-contact-links.tsx"
import type { AdminContext, AdminModule } from "../types.ts"
import { type ContactLinksState, createContactLinksState } from "./state.ts"

/** One state per signed-in session: a new session starts with nothing read. */
const states = new WeakMap<AdminContext, ContactLinksState>()

function contactLinksState(context: AdminContext): ContactLinksState {
  let state = states.get(context)
  if (!state) {
    state = createContactLinksState(context.request, context.toasts)
    states.set(context, state)
  }
  return state
}

function ContactLinksView({ context }: { context: AdminContext }): JSX.Element {
  const state = contactLinksState(context)
  useEffect(() => {
    void state.load()
  }, [context])
  return (
    <AdminContactLinksScreen
      links={state.links.value}
      error={state.error.value}
      busy={state.busy.value}
      onRetry={() => void state.load()}
      onMove={(id, by) => void state.move(id, by)}
      onRemove={(link) => void state.remove(link)}
      navigate={context.navigate}
    />
  )
}

/** The editor, on `/contact-links/new` and `/contact-links/:id`. A save goes back to the list. */
function ContactLinkEditorView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const state = contactLinksState(context)
  const id = params.id === `new` ? null : params.id
  // The router's own navigate: after a save or removal nothing unsaved is left to ask about.
  const [, go] = useLocation()
  useEffect(() => {
    state.open(id)
    if (id !== null && !state.find(id)) void state.load().then(() => state.open(id))
  }, [id, context])
  const editor = state.editor.value
  const link = id === null ? null : state.find(id)
  return (
    <>
      <AdminContactLinkEditorScreen
        link={link}
        loading={id !== null && state.links.value === null}
        notFound={id !== null && state.links.value !== null && link === null}
        value={editor.value}
        onChange={state.edit}
        errors={editor.errors}
        saving={editor.saving}
        onSave={async () => {
          if (await state.save()) go(ADMIN_CONTACT_LINKS_PATHS.list)
        }}
        onRemove={async () => {
          if (link && await state.remove(link)) go(ADMIN_CONTACT_LINKS_PATHS.list)
        }}
        navigate={context.navigate}
      />
      <UnsavedGuard
        when={state.unsaved()}
        owns={(url) => url.origin === globalThis.location?.origin}
        navigate={go}
        leaveGuard={context.leaveGuard}
        labels={{
          title: `Leave without saving?`,
          message: `Your changes to this link are lost.`,
          leave: `Leave`,
          stay: `Keep editing`,
        }}
      />
    </>
  )
}

/** The website's contact links: the list and the editor (#465). */
export const contactLinksModule: AdminModule = {
  id: `contact-links`,
  nav: { name: `Contact links`, href: ADMIN_CONTACT_LINKS_PATHS.list, Icon: IconChatBubble },
  routes: [
    { path: ADMIN_CONTACT_LINKS_PATHS.list, View: ContactLinksView },
    { path: `/contact-links/:id`, View: ContactLinkEditorView },
  ],
}
