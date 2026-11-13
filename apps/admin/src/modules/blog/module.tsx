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
import {
  ADMIN_BLOG_SHARING_PATHS,
  AdminBlogChannelScreen,
  AdminBlogChannelsScreen,
} from "@ui/admin-blog-channels.tsx"
import { AdminBlogSharingScreen } from "@ui/admin-blog-sharing.tsx"
import { useAdminText } from "@ui/i18n.ts"
import type { AdminContext, AdminModule } from "../types.ts"
import { type BlogState, createBlogState } from "./state.ts"
import { createSharingState, type SharingState } from "./sharing-state.ts"

/** How long after the last keystroke the Problems panel checks the body again, in ms. */
const PROBLEMS_CHECK_DELAY = 1_000

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

/** One sharing state per signed-in session, as for the blog's own. */
const sharingStates = new WeakMap<AdminContext, SharingState>()

function sharingState(context: AdminContext): SharingState {
  let state = sharingStates.get(context)
  if (!state) {
    state = createSharingState(context.request, context.toasts)
    sharingStates.set(context, state)
  }
  return state
}

/**
 * The list's address for a filter: the status or the sharing filter, and only when one is chosen.
 * The search text stays out, since an address is kept in the browser's history and sent in
 * `Referer`.
 */
export function blogListHref(filter: AdminBlogFilter): string {
  if (filter.sharing) return ADMIN_BLOG_SHARING_PATHS.needsSharing
  return filter.status ? `${ADMIN_BLOG_PATHS.list}?status=${filter.status}` : ADMIN_BLOG_PATHS.list
}

/** The list page. Its status lives in the address; the search text in the module's state. */
function BlogListView({ context }: { context: AdminContext }): JSX.Element {
  const state = blogState(context)
  const search = useSearch()
  const query = state.query.value
  const filter = useMemo<AdminBlogFilter>(() => {
    const params = new URLSearchParams(search)
    return params.get(`sharing`) === `todo`
      ? { status: null, query, sharing: true }
      : { status: parseBlogStatusFilter(params.get(`status`)), query }
  }, [search, query])
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
    state.loadFigures()
  }, [context])
  const editor = state.editor.value
  // The Problems panel rechecks the body about a second after typing stops.
  const body = editor.loading ? null : editor.value.bodyMd
  useEffect(() => {
    if (body === null) return
    const timer = setTimeout(() => void state.renderPreview(), PROBLEMS_CHECK_DELAY)
    return () => clearTimeout(timer)
  }, [body])
  // A live post's summary of where it was shared, read from its checklist.
  const sharing = sharingState(context)
  const live = editor.post?.status === `published` ? editor.post.id : null
  useEffect(() => {
    if (live !== null) void sharing.loadSharing(live)
  }, [live, context])
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
        sharing={live === null ? null : sharing.counts(live)}
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
        originals={state.originals.value.filter((original) => original.id !== editor.id)}
        newsletter={state.newsletter.value}
        siteUrl={state.siteUrl()}
        preview={preview.preview}
        previewPending={preview.pending}
        previewError={preview.error}
        onPreview={() => void state.renderPreview()}
        problems={preview.problems}
        figureExample={state.figures.value?.example ?? null}
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
        history={state.history.value}
        onSelectRevision={(revisionId) => void state.selectRevision(revisionId)}
        onRestoreRevision={state.restoreRevision}
        onRetryHistory={() => void state.retryHistory()}
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

/** The sharing channels, at `/blog/channels`. */
function BlogChannelsView({ context }: { context: AdminContext }): JSX.Element {
  const state = sharingState(context)
  useEffect(() => {
    void state.loadChannels()
  }, [context])
  return (
    <AdminBlogChannelsScreen
      list={state.channels.value}
      error={state.channelsError.value}
      busy={state.busy.value}
      archived={state.archived.value}
      onShowArchived={(archived) => state.archived.value = archived}
      onRetry={() => void state.loadChannels()}
      onArchive={(channel, archived) => void state.archive(channel, archived)}
      onDelete={(channel) => void state.deleteChannel(channel)}
      navigate={context.navigate}
    />
  )
}

/** One channel's form, at `/blog/channels/new` and `/blog/channels/:id`. A save goes back to the list. */
function BlogChannelView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const t = useAdminText()
  const state = sharingState(context)
  const id = params.id === `new` ? null : params.id
  const [, go] = useLocation()
  const list = state.channels.value
  const known = id === null || list !== null
  useEffect(() => {
    void state.loadChannels()
  }, [context])
  useEffect(() => {
    if (known) state.openChannel(id)
  }, [id, known])
  const form = state.form.value
  const channel = id === null ? null : state.find(id)
  return (
    <>
      <AdminBlogChannelScreen
        channel={channel}
        loading={!known || form.id !== id}
        notFound={id !== null && list !== null && channel === null}
        value={form.value}
        onChange={state.editChannel}
        errors={form.errors}
        saving={form.saving}
        onSave={async () => {
          if (await state.saveChannel()) go(ADMIN_BLOG_SHARING_PATHS.channels)
        }}
        livePosts={list?.livePosts ?? []}
        now={state.now()}
        navigate={context.navigate}
      />
      <UnsavedGuard
        when={state.unsavedChannel()}
        owns={(url) => url.origin === globalThis.location?.origin}
        navigate={go}
        leaveGuard={context.leaveGuard}
        labels={{
          title: t.t(`AdminApp.leaveTitle`),
          message: t.t(`AdminBlogChannels.leaveMessage`),
          leave: t.t(`AdminApp.leave`),
          stay: t.t(`AdminApp.keepEditing`),
        }}
      />
    </>
  )
}

/** How often an open checklist with a row still posting reads itself again. */
const SHARING_POLL_MS = 5000

/** A post's sharing checklist, at `/blog/:id/sharing`; it reads again while a row is posting. */
function BlogSharingView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const state = sharingState(context)
  const postId = params.id
  useEffect(() => {
    void state.loadSharing(postId)
  }, [postId, context])
  const page = state.sharing.value
  const current = page.postId === postId
  const posting = current && state.posting()
  useEffect(() => {
    if (!posting) return
    const timer = setInterval(() => void state.loadSharing(postId), SHARING_POLL_MS)
    return () => clearInterval(timer)
  }, [posting, postId, context])
  return (
    <AdminBlogSharingScreen
      postId={postId}
      sharing={current ? page.data : null}
      loadError={current ? page.error : null}
      onRetry={() => void state.loadSharing(postId)}
      pending={page.pending}
      rowErrors={page.rowErrors}
      onChange={(change) => void state.setShares(change)}
      resultsPending={page.resultsPending}
      resultsError={page.resultsError}
      onResults={(channelId, counts) => void state.enterResults(channelId, counts)}
      onRetryPost={(channelId) => void state.retryPost(channelId)}
      announcement={page.announcement}
      navigate={context.navigate}
    />
  )
}

/** Posts on the public website: the list, the editor, the sharing channels and checklists. */
export const blogModule: AdminModule = {
  id: `blog`,
  nav: { name: `AdminNav.blog`, href: ADMIN_BLOG_PATHS.list, Icon: IconPencilSquare },
  routes: [
    { path: ADMIN_BLOG_PATHS.list, View: BlogListView },
    // Before `/blog/:id`, which would take `channels` for a post's id.
    { path: ADMIN_BLOG_SHARING_PATHS.channels, View: BlogChannelsView },
    { path: `/blog/channels/:id`, View: BlogChannelView },
    { path: `/blog/:id/sharing`, View: BlogSharingView },
    // One route for `/blog/new` and `/blog/:id`, so the first save's move to the post's address
    // keeps the same editor mounted, and with it the field and caret being typed in.
    { path: `/blog/:id`, View: BlogEditorView },
  ],
}
