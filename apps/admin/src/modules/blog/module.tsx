import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import { IconPencilSquare } from "@spy4x/preact-icons"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import { parseBlogStatusFilter } from "@domain/blog"
import {
  ADMIN_BLOG_PATHS,
  type AdminBlogFilter,
  AdminBlogListScreen,
} from "@ui/admin-blog-list.tsx"
import { AdminBlogEditorScreen } from "@ui/admin-blog-editor.tsx"
import { useAdminText } from "@ui/i18n.ts"
import type { AdminContext, AdminModule } from "../types.ts"
import { type BlogState, createBlogState } from "./state.ts"

/** One blog state per signed-in session: a new session starts with nothing loaded. */
const states = new WeakMap<AdminContext, BlogState>()

function blogState(context: AdminContext): BlogState {
  let state = states.get(context)
  if (!state) {
    state = createBlogState(context.request, context.toasts, context.format)
    states.set(context, state)
  }
  return state
}

/**
 * The list's address for a filter: the status only, and only when one is chosen. The search text
 * stays out, since an address is kept in the browser's history and sent in `Referer`.
 */
export function blogListHref(filter: AdminBlogFilter): string {
  return filter.status ? `${ADMIN_BLOG_PATHS.list}?status=${filter.status}` : ADMIN_BLOG_PATHS.list
}

/** The list page. Its status lives in the address; the search text in the module's state. */
function BlogListView({ context }: { context: AdminContext }): JSX.Element {
  const state = blogState(context)
  const search = useSearch()
  const query = state.query.value
  const filter = useMemo<AdminBlogFilter>(
    () => ({ status: parseBlogStatusFilter(new URLSearchParams(search).get(`status`)), query }),
    [search, query],
  )
  useEffect(() => {
    state.loadList(filter)
  }, [filter])
  const list = state.list.value
  return (
    <AdminBlogListScreen
      filter={filter}
      list={list.list}
      pending={list.pending}
      error={list.error}
      onFilter={(next) => {
        state.query.value = next.query
        const href = blogListHref(next)
        if (href !== blogListHref(filter)) context.navigate(href)
      }}
      onRetry={() => state.loadList(filter)}
      navigate={context.navigate}
    />
  )
}

/**
 * The editor, on `/blog/new` and `/blog/:id`. Once the create page saves, the address becomes the
 * post's own, replacing the create page in the history.
 */
function BlogEditorView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const t = useAdminText()
  const state = blogState(context)
  const id = params.id === `new` ? undefined : params.id
  // The router's own navigate, for the guard's "Leave" and for moves that keep or drop nothing
  // unsaved: the create page's address change after a save, and the list after a delete. Anything
  // else goes through `context.navigate`, which asks first while edits are unsaved.
  const [, go] = useLocation()
  useEffect(() => {
    const open = state.editor.value
    // The create page just saved this post and moved to its address: it is open already.
    if (id !== undefined && open.id === id && open.post !== null) return
    if (id === undefined) state.openNew()
    else void state.openPost(id)
  }, [id, context])
  useEffect(() => {
    void state.loadExtras()
  }, [context])
  const editor = state.editor.value
  const dialog = state.dialog.value
  const preview = state.preview.value
  /** After the create page's first save, the page moves to the post's own address. */
  const settle = (saved: { id: string } | null) => {
    if (saved && id === undefined) {
      go(ADMIN_BLOG_PATHS.post(saved.id), { replace: true })
    }
  }
  return (
    <>
      <AdminBlogEditorScreen
        post={editor.post}
        loading={editor.loading}
        notFound={editor.notFound}
        loadError={editor.loadError}
        onRetry={() => void state.reload()}
        value={editor.value}
        onChange={state.edit}
        errors={editor.errors}
        saveStatus={editor.saveStatus}
        conflict={editor.conflict}
        onReload={() => void state.reload()}
        // The address moves before the editor shows the save, so the app's route announcer is done
        // before the editor gives focus back to the field being typed in.
        onSave={() => void state.save(settle)}
        significantUpdate={editor.significantUpdate}
        onSignificantUpdate={state.setSignificantUpdate}
        topics={state.topics.value}
        newsletter={state.newsletter.value}
        siteUrl={state.siteUrl()}
        preview={preview.preview}
        previewPending={preview.pending}
        previewError={preview.error}
        onPreview={() => void state.renderPreview()}
        dialog={dialog.dialog}
        dialogPending={dialog.pending}
        dialogError={dialog.error}
        onOpenDialog={state.openDialog}
        onCloseDialog={state.closeDialog}
        onPublish={async (choice) => settle(await state.publish(choice))}
        onUnschedule={() => void state.unschedule()}
        onUnpublish={() => void state.unpublish()}
        onChangeUrl={(slug) => void state.changeUrl(slug)}
        onDelete={async () => {
          if (await state.remove()) go(ADMIN_BLOG_PATHS.list)
        }}
        now={state.now()}
        navigate={context.navigate}
      />
      <UnsavedGuard
        when={state.unsaved()}
        owns={(url) => url.origin === globalThis.location?.origin}
        navigate={go}
        leaveGuard={context.leaveGuard}
        labels={{
          title: t.t(`AdminApp.leaveTitle`),
          message: t.t(`AdminBlogEditor.leaveMessage`),
          leave: t.t(`AdminApp.leave`),
          stay: t.t(`AdminApp.keepEditing`),
        }}
      />
    </>
  )
}

/** Posts on the public website: the list and the editor (#396), over the API of #395. */
export const blogModule: AdminModule = {
  id: `blog`,
  nav: { name: `AdminNav.blog`, href: ADMIN_BLOG_PATHS.list, Icon: IconPencilSquare },
  routes: [
    { path: ADMIN_BLOG_PATHS.list, View: BlogListView },
    // One route for `/blog/new` and `/blog/:id`, so the first save's move to the post's address
    // keeps the same editor mounted, and with it the field and caret being typed in.
    { path: `/blog/:id`, View: BlogEditorView },
  ],
}
