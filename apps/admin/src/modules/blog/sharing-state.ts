import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  type AdminBlogChannelRow,
  type AdminBlogChannelsResponse,
  type AdminBlogShareRow,
  type AdminBlogSharingResponse,
  type BlogChannel,
  type BlogShareResultsRequest,
  blogSharingCounts,
  BlogSharingError,
  parseBlogChannelFields,
} from "@domain/blog"
import {
  blankChannelForm,
  type BlogChannelFormErrors,
  type BlogChannelFormValue,
  channelForm,
} from "@ui/admin-blog-channels.tsx"
import type { BlogShareChange } from "@ui/admin-blog-sharing.tsx"
import { type AdminApiResult, type AdminFetch, post, refusalText } from "../../state.ts"
import { adminText } from "../../i18n.ts"

const API = `/api/admin/blog`

/** The channel form: which channel it has open (`null` for a new one) and what its fields hold. */
export interface ChannelFormState {
  id: string | null
  value: BlogChannelFormValue
  errors: BlogChannelFormErrors
  saving: boolean
}

/** One post's checklist and the change on its way. */
export interface SharingPageState {
  postId: string | null
  data: AdminBlogSharingResponse | null
  error: string | null
  /** The channel whose change is on its way. */
  pending: string | null
  rowErrors: Record<string, string>
  resultsPending: boolean
  resultsError: string | null
  announcement: string
}

const NO_SHARING: SharingPageState = {
  postId: null,
  data: null,
  error: null,
  pending: null,
  rowErrors: {},
  resultsPending: false,
  resultsError: null,
  announcement: ``,
}

const DONE_KEYS: Record<BlogShareChange[`status`], string> = {
  posted: `AdminBlogSharing.donePosted`,
  suggested: `AdminBlogSharing.doneSuggested`,
  skipped: `AdminBlogSharing.doneSkipped`,
  todo: `AdminBlogSharing.doneMovedBack`,
  none: `AdminBlogSharing.doneMovedBack`,
}

/** The fields of a form refused for a field, by the field the API names. */
function fieldOf(result: AdminApiResult<unknown>): keyof BlogChannelFormErrors {
  if (result.ok) return `form`
  const [field] = Object.keys(result.error.fields ?? {})
  return field === `name` || field === `address` || field === `utmSource` ||
      field === `languages`
    ? field
    : `form`
}

/** What a row was before a change, as the change that puts it back: `none` for no row. */
function undoOf(row: AdminBlogShareRow): BlogShareChange {
  const share = row.share
  if (!share) return { channelIds: [row.channel.id], status: `none` }
  return {
    channelIds: [row.channel.id],
    status: share.status,
    url: share.url,
    skipReason: share.skipReason,
    sharedAt: share.sharedAt,
    automatic: share.automatic,
    error: share.error,
  }
}

/**
 * The blog's sharing state: the channels screen, the channel form and one post's checklist.
 * Every call goes through the app's `request`, which signs the app out on a 401. The form checks
 * its fields in the page's words first, with the rules the API applies. A change on the checklist
 * reads the checklist again and offers Undo, which puts each row back as it was.
 */
export function createSharingState(
  request: AdminFetch,
  toasts: ToastStore,
  ports: { newId: () => string; now: () => string } = {
    newId: uuidV7,
    now: () => new Date().toISOString(),
  },
) {
  const channels = signal<AdminBlogChannelsResponse | null>(null)
  const channelsError = signal<string | null>(null)
  const busy = signal(false)
  const archived = signal(false)
  const form = signal<ChannelFormState>({
    id: null,
    value: blankChannelForm(),
    errors: {},
    saving: false,
  })
  const sharing = signal<SharingPageState>(NO_SHARING)

  const find = (id: string): AdminBlogChannelRow | null =>
    channels.value?.channels.find((channel) => channel.id === id) ?? null

  const savedForm = (id: string | null) => {
    const channel = id === null ? null : find(id)
    return channel ? channelForm(channel) : blankChannelForm()
  }

  /** One channel write, then the list again; a refusal shows above the list. */
  const write = async (path: string, body: unknown): Promise<boolean> => {
    if (busy.value) return false
    busy.value = true
    const result = await request(path, post(body))
    await state.loadChannels()
    if (!result.ok) channelsError.value = result.error.message
    busy.value = false
    return result.ok
  }

  const state = {
    channels,
    channelsError,
    busy,
    archived,
    form,
    sharing,

    async loadChannels(): Promise<void> {
      const result = await request<AdminBlogChannelsResponse>(`${API}/channels`)
      if (result.ok) {
        channels.value = result.data
        channelsError.value = null
      } else channelsError.value = result.error.message
    },

    /** The time "from today on" starts at for a channel saved now. */
    now: ports.now,

    find,

    /** Opens the form on `id`, or on a new channel when it is `null`. */
    openChannel(id: string | null): void {
      form.value = { id, value: savedForm(id), errors: {}, saving: false }
    },

    /** Takes the fields as typed; an edited field's error goes until the next save. */
    editChannel(value: BlogChannelFormValue): void {
      const open = form.value
      const errors = { ...open.errors }
      for (const field of [`name`, `address`, `utmSource`] as const) {
        if (value[field] !== open.value[field]) delete errors[field]
      }
      if (value.kind !== open.value.kind) delete errors.address
      if (value.languages.join() !== open.value.languages.join()) delete errors.languages
      form.value = { ...open, value, errors }
    },

    /** Whether the form holds something not saved, for the guard that asks before leaving. */
    unsavedChannel(): boolean {
      const { id, value, saving } = form.value
      if (saving) return false
      const saved = savedForm(id)
      return value.name !== saved.name || value.kind !== saved.kind ||
        value.address !== saved.address || value.utmSource !== saved.utmSource ||
        value.addUtm !== saved.addUtm || value.which !== saved.which ||
        value.autoPost !== saved.autoPost ||
        value.languages.join() !== saved.languages.join()
    },

    /** Adds or saves the channel. Answers whether it went through. */
    async saveChannel(): Promise<boolean> {
      const open = form.value
      if (open.saving) return false
      const channel = open.id === null ? null : find(open.id)
      const { value } = open
      const body = {
        name: value.name,
        kind: value.kind,
        address: value.address,
        utmSource: value.utmSource,
        addUtm: value.addUtm,
        autoPost: value.autoPost,
        languages: value.languages,
        startsAt: value.which === `all` ? null : channel?.startsAt ?? ports.now(),
      }
      try {
        parseBlogChannelFields(body)
      } catch (refusal) {
        if (!(refusal instanceof BlogSharingError)) throw refusal
        const field = refusal.field
        const key = field === `name` || field === `address` || field === `utmSource` ||
            field === `languages`
          ? field
          : `form`
        const message = refusalText({ message: refusal.message, fields: refusal.fields })
        form.value = { ...open, errors: { [key]: message } }
        return false
      }
      form.value = { ...open, errors: {}, saving: true }
      const id = channel?.id ?? ports.newId()
      const result = channel
        ? await request(`${API}/channels/${id}`, post({ ...body, version: channel.version }))
        : await request(`${API}/channels`, post({ id, ...body }))
      if (!result.ok) {
        form.value = {
          ...form.value,
          saving: false,
          errors: { [fieldOf(result)]: result.error.message },
        }
        return false
      }
      await state.loadChannels()
      state.openChannel(id)
      toasts.success({
        body: adminText().t(
          channel ? `AdminBlogChannels.doneSaved` : `AdminBlogChannels.doneAdded`,
        ),
        dataE2E: `blog-channel-toast`,
      })
      return true
    },

    /** Archives or restores the channel; an archive offers Undo. */
    async archive(channel: BlogChannel, archive: boolean): Promise<boolean> {
      const path = `${API}/channels/${channel.id}/${archive ? `archive` : `restore`}`
      const ok = await write(path, { version: channel.version })
      if (!ok) return false
      const t = adminText()
      toasts.success({
        body: t.t(archive ? `AdminBlogChannels.doneArchived` : `AdminBlogChannels.doneRestored`),
        dataE2E: `blog-channel-toast`,
        ...(archive && {
          action: {
            label: t.t(`AdminBlogChannels.undo`),
            onAction: () => {
              const now = find(channel.id)
              if (now) void state.archive(now, false)
            },
            dataE2E: `blog-channel-undo`,
          },
        }),
      })
      return true
    },

    /** Deletes a channel no post has a row on. */
    async deleteChannel(channel: BlogChannel): Promise<boolean> {
      const ok = await write(`${API}/channels/${channel.id}/delete`, { version: channel.version })
      if (ok) {
        toasts.success({
          body: adminText().t(`AdminBlogChannels.doneDeleted`),
          dataE2E: `blog-channel-toast`,
        })
      }
      return ok
    },

    /** Reads the checklist of post `postId`; a new post starts with nothing shown. */
    async loadSharing(postId: string): Promise<void> {
      if (sharing.value.postId !== postId) sharing.value = { ...NO_SHARING, postId }
      const result = await request<AdminBlogSharingResponse>(`${API}/posts/${postId}/sharing`)
      if (sharing.value.postId !== postId) return
      sharing.value = result.ok
        ? { ...sharing.value, data: result.data, error: null }
        : { ...sharing.value, error: result.error.message }
    },

    /** The counts of the checklist read for `postId`, for the editor's summary. */
    counts(postId: string) {
      const { data } = sharing.value
      return data && data.post.id === postId ? blogSharingCounts(data.rows) : null
    },

    /**
     * Changes rows on the open checklist and reads it again. A toast says what happened, with Undo
     * putting each row back; a polite announcement says how many are left after a post.
     */
    async setShares(change: BlogShareChange, options: { undo?: boolean } = {}): Promise<boolean> {
      const open = sharing.value
      const postId = open.postId
      if (postId === null || open.pending !== null) return false
      const [first] = change.channelIds
      const before = (open.data?.rows ?? []).filter((row) =>
        change.channelIds.includes(row.channel.id)
      )
      const rowErrors = { ...open.rowErrors }
      for (const id of change.channelIds) delete rowErrors[id]
      sharing.value = { ...open, pending: first, rowErrors }
      const result = await request(`${API}/posts/${postId}/shares`, post(change))
      if (sharing.value.postId !== postId) return false
      if (!result.ok) {
        sharing.value = {
          ...sharing.value,
          pending: null,
          rowErrors: { ...sharing.value.rowErrors, [first]: result.error.message },
        }
        return false
      }
      await state.loadSharing(postId)
      const t = adminText()
      const left = blogSharingCounts(sharing.value.data?.rows ?? []).toDo
      const name = before.length === 1 ? before[0].channel.name : null
      sharing.value = {
        ...sharing.value,
        pending: null,
        announcement: change.status === `posted` && name !== null
          ? `${t.t(`AdminBlogSharing.announcePosted`, { channel: name })} ${
            t.t(`AdminBlogSharing.left`, { count: left })
          }`
          : t.t(DONE_KEYS[change.status]),
      }
      if (!options.undo) {
        toasts.success({
          body: t.t(DONE_KEYS[change.status]),
          dataE2E: `blog-share-toast`,
          action: {
            label: t.t(`AdminBlogSharing.undo`),
            onAction: async () => {
              for (const row of before) {
                if (!await state.setShares(undoOf(row), { undo: true })) return
              }
            },
            dataE2E: `blog-share-undo`,
          },
        })
      }
      return true
    },

    /**
     * Queues another automatic try of one channel's copy and reads the checklist again, so the row
     * shows "Posting…". A refusal shows on that row.
     */
    async retryPost(channelId: string): Promise<boolean> {
      const open = sharing.value
      const postId = open.postId
      if (postId === null || open.pending !== null) return false
      const rowErrors = { ...open.rowErrors }
      delete rowErrors[channelId]
      sharing.value = { ...open, pending: channelId, rowErrors }
      const result = await request(`${API}/posts/${postId}/shares/${channelId}/retry`, post({}))
      if (sharing.value.postId !== postId) return false
      if (result.ok) await state.loadSharing(postId)
      sharing.value = {
        ...sharing.value,
        pending: null,
        ...(!result.ok && {
          rowErrors: { ...sharing.value.rowErrors, [channelId]: result.error.message },
        }),
      }
      return result.ok
    },

    /** Whether a row of the open checklist waits for its automatic post, so the page reads again. */
    posting(): boolean {
      return sharing.value.data?.rows.some((row) => row.posting) ?? false
    },

    /** Saves the numbers typed for one channel's copy. */
    async enterResults(channelId: string, counts: BlogShareResultsRequest): Promise<boolean> {
      const postId = sharing.value.postId
      if (postId === null || sharing.value.resultsPending) return false
      sharing.value = { ...sharing.value, resultsPending: true, resultsError: null }
      const result = await request(
        `${API}/posts/${postId}/shares/${channelId}/results`,
        post(counts),
      )
      if (!result.ok) {
        sharing.value = {
          ...sharing.value,
          resultsPending: false,
          resultsError: result.error.message,
        }
        return false
      }
      await state.loadSharing(postId)
      sharing.value = { ...sharing.value, resultsPending: false, resultsError: null }
      toasts.success({
        body: adminText().t(`AdminBlogSharing.doneResults`),
        dataE2E: `blog-share-toast`,
      })
      return true
    },
  }
  return state
}

export type SharingState = ReturnType<typeof createSharingState>
