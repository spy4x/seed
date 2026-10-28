import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type {
  AdminBlogListResponse,
  BlogNewsletterResponse,
  BlogPost,
  BlogTopic,
} from "@domain/blog"
import type { AdminBlogFilter } from "@ui/admin-blog-list.tsx"
import {
  type BlogDialog,
  type BlogDraft,
  blogDraftErrors,
  blogDraftOf,
  type BlogFormErrors,
  type BlogPreview,
  type BlogPublishChoice,
  type BlogSaveStatus,
  emptyBlogDraft,
  followTitle,
  sameBlogDraft,
} from "@ui/admin-blog-editor.tsx"
import type { Formatters } from "@spy4x/time/format"
import { type AdminApiResult, type AdminFetch, post as postBody } from "../../state.ts"

const API = `/api/admin/blog`

export interface BlogListState {
  /** The filter the list shows, or is loading. */
  filter: AdminBlogFilter | null
  list: AdminBlogListResponse | null
  pending: boolean
  error: string | null
}

export interface BlogEditorState {
  /** The post's id; on the create page, the id the post gets when it is first saved. */
  id: string
  /** The post as saved, or `null` until the create page saves it. */
  post: BlogPost | null
  /** What the fields show. */
  value: BlogDraft
  loading: boolean
  notFound: boolean
  loadError: string | null
  saveStatus: BlogSaveStatus
  errors: BlogFormErrors
  /** Someone else changed the post since it was read. */
  conflict: boolean
  /** "Significant update" is ticked on a published post. */
  significantUpdate: boolean
}

export interface BlogDialogState {
  dialog: BlogDialog | null
  pending: boolean
  error: string | null
}

export interface BlogPreviewState {
  /** The Markdown the preview shows, or is rendering. */
  source: string | null
  preview: BlogPreview | null
  pending: boolean
  error: string | null
}

/** What the state needs besides the API: a new post's id, the time, and a new tab. */
export interface BlogStatePorts {
  newId: () => string
  now: () => Date
  /** Opens the public post in a new tab. */
  open: (url: string) => void
}

const browserPorts: BlogStatePorts = {
  newId: uuidV7,
  now: () => new Date(),
  open: (url) => void globalThis.open?.(url, `_blank`, `noopener`),
}

const NO_DIALOG: BlogDialogState = { dialog: null, pending: false, error: null }

const NO_PREVIEW: BlogPreviewState = { source: null, preview: null, pending: false, error: null }

/** A new post's editor: nothing typed, nothing saved. */
function freshEditor(id: string): BlogEditorState {
  return {
    id,
    post: null,
    value: emptyBlogDraft(),
    loading: false,
    notFound: false,
    loadError: null,
    saveStatus: `unsaved`,
    errors: {},
    conflict: false,
    significantUpdate: false,
  }
}

/** The editor once `post` is read or saved: the fields show it as saved. */
function savedEditor(post: BlogPost): BlogEditorState {
  return { ...freshEditor(post.id), post, value: blogDraftOf(post), saveStatus: `saved` }
}

/** The request body of a post's fields: the texts as typed; the API trims and checks them. */
function fieldsOf(draft: BlogDraft) {
  return {
    title: draft.title,
    slug: draft.slug,
    description: draft.description,
    seoTitle: draft.seoTitle,
    tldr: draft.tldr,
    topic: draft.topic,
    coverUrl: draft.coverUrl,
    coverAlt: draft.coverAlt,
    bodyMd: draft.bodyMd,
  }
}

/** What a refused save or action means for the editor: a conflict, a field, or the whole form. */
function refusal(result: AdminApiResult<unknown>): Partial<BlogEditorState> {
  if (result.ok) return {}
  const { reason, message } = result.error
  if (reason === `VERSION_CONFLICT`) return { conflict: true }
  if (reason === `SLUG_TAKEN`) return { errors: { slug: `Another post already uses this slug.` } }
  if (reason === `SLUG_LOCKED`) return { errors: { slug: message } }
  return { errors: { form: message } }
}

/**
 * The blog module's state (#396): the list, and the one post the editor has open with its
 * dialogs and preview. Every call goes through the app's `request`, which signs the app out on a
 * 401. Writes name the version the editor read; a 409 marks the editor as in conflict, and it
 * saves nothing more until the operator reloads.
 */
export function createBlogState(
  request: AdminFetch,
  toasts: ToastStore,
  format: () => Pick<Formatters, `dateTime`>,
  ports: BlogStatePorts = browserPorts,
) {
  const list = signal<BlogListState>({ filter: null, list: null, pending: false, error: null })
  /** The search typed on the list. Kept here for the session, never in the page's address. */
  const query = signal(``)
  const editor = signal<BlogEditorState>(freshEditor(ports.newId()))
  const dialog = signal<BlogDialogState>(NO_DIALOG)
  const preview = signal<BlogPreviewState>(NO_PREVIEW)
  const topics = signal<readonly string[]>([])
  const newsletter = signal<BlogNewsletterResponse | null>(null)

  /** Whether `id` is still the post the editor has open, after an await. */
  const current = (id: string) => editor.value.id === id

  /** Puts a saved or changed post in the editor, keeping nothing typed since: there was none. */
  const show = (saved: BlogPost) => {
    editor.value = savedEditor(saved)
  }

  /**
   * Sends one action on the open post with the version it has, from the open dialog. On success
   * the dialog closes and the editor shows the answer's post; on a refusal the dialog says why.
   */
  async function act(path: string, body: Record<string, unknown>): Promise<BlogPost | null> {
    const open = editor.value
    if (!open.post || dialog.value.pending) return null
    dialog.value = { ...dialog.value, pending: true, error: null }
    const result = await request<{ post: BlogPost }>(
      `${API}/posts/${open.id}/${path}`,
      postBody({ version: open.post.version, ...body }),
    )
    if (!current(open.id)) return null
    if (!result.ok) {
      const refused = refusal(result)
      if (refused.conflict) {
        dialog.value = NO_DIALOG
        editor.value = { ...editor.value, conflict: true }
      } else {
        dialog.value = { ...dialog.value, pending: false, error: result.error.message }
      }
      return null
    }
    dialog.value = NO_DIALOG
    show(result.data.post)
    return result.data.post
  }

  const state = {
    list,
    query,
    editor,
    dialog,
    preview,
    topics,
    newsletter,

    /** Reads the posts of `filter`, with each status's count. */
    async loadList(filter: AdminBlogFilter): Promise<void> {
      list.value = { ...list.value, filter, pending: true, error: null }
      const params = new URLSearchParams()
      if (filter.status) params.set(`status`, filter.status)
      if (filter.query) params.set(`q`, filter.query)
      const search = params.toString()
      const result = await request<AdminBlogListResponse>(
        `${API}/posts${search ? `?${search}` : ``}`,
      )
      // An answer for a filter the page has left is dropped.
      if (list.value.filter !== filter) return
      list.value = result.ok
        ? { filter, list: result.data, pending: false, error: null }
        : { ...list.value, pending: false, error: result.error.message }
    },

    /** Opens the create page: an empty draft with a new id. */
    openNew(): void {
      editor.value = freshEditor(ports.newId())
      dialog.value = NO_DIALOG
      preview.value = NO_PREVIEW
    },

    /** Opens the post `id` and reads it. */
    async openPost(id: string): Promise<void> {
      editor.value = { ...freshEditor(id), loading: true, saveStatus: `saved` }
      dialog.value = NO_DIALOG
      preview.value = NO_PREVIEW
      await state.reload()
    },

    /** Reads the open post again, as after a conflict; what was typed is replaced. */
    async reload(): Promise<void> {
      const { id } = editor.value
      editor.value = { ...editor.value, loading: true, loadError: null }
      const result = await request<{ post: BlogPost }>(`${API}/posts/${id}`)
      if (!current(id)) return
      if (result.ok) show(result.data.post)
      else if (result.status === 404) editor.value = { ...freshEditor(id), notFound: true }
      else editor.value = { ...editor.value, loading: false, loadError: result.error.message }
    },

    /** Reads the topics in use and whether a post can be emailed, for the fields and dialog. */
    async loadExtras(): Promise<void> {
      const [topicsResult, newsletterResult] = await Promise.all([
        request<{ topics: BlogTopic[] }>(`${API}/topics`),
        request<BlogNewsletterResponse>(`${API}/newsletter`),
      ])
      if (topicsResult.ok) topics.value = topicsResult.data.topics.map((entry) => entry.topic)
      if (newsletterResult.ok) newsletter.value = newsletterResult.data
    },

    /** Takes what the fields show now; the slug follows the title while it may. */
    edit(next: BlogDraft): void {
      const open = editor.value
      const locked = open.post?.publishedAt != null
      const value = followTitle(open.value, next, locked)
      const saved = open.post ? blogDraftOf(open.post) : emptyBlogDraft()
      editor.value = {
        ...open,
        value,
        saveStatus: sameBlogDraft(value, saved) && open.post ? `saved` : `unsaved`,
      }
    },

    setSignificantUpdate(value: boolean): void {
      editor.value = { ...editor.value, significantUpdate: value }
    },

    /** Whether the fields hold something not saved, for the guard that asks before leaving. */
    unsaved(): boolean {
      const open = editor.value
      if (open.loading || open.notFound) return false
      return !sameBlogDraft(open.value, open.post ? blogDraftOf(open.post) : emptyBlogDraft())
    },

    /**
     * Saves the fields: creates the post on the create page, else saves it with the version read.
     * Checks the fields first in the page's words. Answers the saved post, or `null` when nothing
     * was saved.
     */
    async save(beforeShow?: (saved: BlogPost) => void): Promise<BlogPost | null> {
      const open = editor.value
      if (open.saveStatus === `saving` || open.conflict) return null
      const errors = blogDraftErrors(open.value)
      if (Object.keys(errors).length > 0) {
        editor.value = { ...open, errors }
        return null
      }
      editor.value = { ...open, errors: {}, saveStatus: `saving` }
      const result = open.post
        ? await request<{ post: BlogPost }>(
          `${API}/posts/${open.id}`,
          postBody({
            ...fieldsOf(open.value),
            version: open.post.version,
            ...(open.post.status === `published` && { significantUpdate: open.significantUpdate }),
          }),
        )
        : await request<{ post: BlogPost }>(
          `${API}/posts`,
          postBody({ id: open.id, ...fieldsOf(open.value) }),
        )
      if (!current(open.id)) return null
      if (!result.ok) {
        editor.value = {
          ...editor.value,
          saveStatus: result.status === 0 ? `failed` : `unsaved`,
          ...refusal(result),
        }
        return null
      }
      beforeShow?.(result.data.post)
      show(result.data.post)
      return result.data.post
    },

    /** Renders the body for the Preview tab, unless it shows that very text already. */
    async renderPreview(): Promise<void> {
      const source = editor.value.value.bodyMd
      if (preview.value.source === source && preview.value.preview && !preview.value.error) return
      preview.value = { ...preview.value, source, pending: true, error: null }
      const result = await request<BlogPreview>(`${API}/preview`, postBody({ bodyMd: source }))
      if (preview.value.source !== source) return
      preview.value = result.ok
        ? { source, preview: result.data, pending: false, error: null }
        : { ...preview.value, pending: false, error: result.error.message }
    },

    /**
     * Opens a dialog. Publishing checks the fields first, with a body this time: a post with
     * errors opens no dialog and shows them instead.
     */
    openDialog(next: BlogDialog): void {
      if (next === `publish`) {
        const errors = blogDraftErrors(editor.value.value, true)
        if (Object.keys(errors).length > 0) {
          editor.value = { ...editor.value, errors }
          return
        }
      }
      dialog.value = { dialog: next, pending: false, error: null }
    },

    closeDialog(): void {
      if (dialog.value.pending) return
      dialog.value = NO_DIALOG
    },

    /**
     * Publishes now or at `choice.at`, emailing `choice.list` when given. Saves first when the
     * fields hold changes, so what goes live is what the operator sees. Answers the post.
     */
    async publish(choice: BlogPublishChoice): Promise<BlogPost | null> {
      if (dialog.value.pending) return null
      if (state.unsaved() || !editor.value.post) {
        dialog.value = { ...dialog.value, pending: true, error: null }
        const saved = await state.save()
        dialog.value = { ...dialog.value, pending: false }
        if (!saved) {
          // The fields show why; the dialog closes so the operator can fix them.
          dialog.value = NO_DIALOG
          return null
        }
      }
      const published = await act(`publish`, {
        ...(choice.at && { at: choice.at }),
        newsletterList: choice.list,
      })
      if (!published) return null
      if (published.status === `scheduled` && published.publishAt) {
        toasts.success({
          body: `Scheduled for ${format().dateTime(published.publishAt)}.`,
          dataE2E: `admin-blog-toast`,
        })
      } else {
        // The send is the worker's job, queued with the publish: it starts in a moment.
        const site = state.siteUrl()
        toasts.success({
          body: choice.list !== null ? `Published. The newsletter email is sending.` : `Published.`,
          ...(site && {
            action: {
              label: `View post`,
              onAction: () => ports.open(`${site}/blog/${published.slug}`),
              dataE2E: `admin-blog-toast-view`,
            },
          }),
          dataE2E: `admin-blog-toast`,
        })
      }
      return published
    },

    async unschedule(): Promise<void> {
      if (await act(`unschedule`, {})) {
        toasts.success({ body: `Unscheduled. It is a draft again.`, dataE2E: `admin-blog-toast` })
      }
    },

    async unpublish(): Promise<void> {
      if (await act(`unpublish`, {})) {
        toasts.success({ body: `Unpublished. It is a draft again.`, dataE2E: `admin-blog-toast` })
      }
    },

    async changeUrl(slug: string): Promise<void> {
      if (await act(`change-url`, { slug })) {
        toasts.success({
          body: `The post's URL is now /blog/${slug}.`,
          dataE2E: `admin-blog-toast`,
        })
      }
    },

    /** Deletes the open post. Answers whether it went, so the page can go back to the list. */
    async remove(): Promise<boolean> {
      const open = editor.value
      if (!open.post || dialog.value.pending) return false
      dialog.value = { ...dialog.value, pending: true, error: null }
      const result = await request<unknown>(
        `${API}/posts/${open.id}/delete`,
        postBody({ version: open.post.version }),
      )
      if (!result.ok) {
        if (refusal(result).conflict) {
          dialog.value = NO_DIALOG
          editor.value = { ...editor.value, conflict: true }
        } else {
          dialog.value = { ...dialog.value, pending: false, error: result.error.message }
        }
        return false
      }
      dialog.value = NO_DIALOG
      toasts.success({ body: `Post deleted.`, dataE2E: `admin-blog-toast` })
      return true
    },

    /** The public website's address, once the newsletter answer told it. */
    siteUrl(): string | null {
      return newsletter.value?.siteUrl ?? null
    },

    now: ports.now,
  }
  return state
}

export type BlogState = ReturnType<typeof createBlogState>
