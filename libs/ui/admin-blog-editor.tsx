import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { slugify } from "@spy4x/platform/universal/text"
import { readingMinutes } from "@spy4x/platform/universal/text"
import { IconChevronDown, IconGlobe } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { useFormat } from "@spy4x/preact-ui/format"
import { Input, Textarea } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { ListField } from "@spy4x/preact-ui/list-field"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { Prose } from "@spy4x/preact-ui/prose"
import { Tabs } from "@spy4x/preact-ui/tabs"
import { TldrBox } from "@spy4x/preact-ui/tldr-box"
import {
  BLOG_BODY_MAX_LENGTH,
  BLOG_COVER_ALT_MAX_LENGTH,
  BLOG_COVER_URL_MAX_LENGTH,
  BLOG_DESCRIPTION_MAX_LENGTH,
  BLOG_SEO_TITLE_MAX_LENGTH,
  BLOG_SLUG_MAX_LENGTH,
  BLOG_SLUG_PATTERN,
  BLOG_TITLE_MAX_LENGTH,
  BLOG_TLDR_ITEM_MAX_LENGTH,
  BLOG_TLDR_MAX,
  BLOG_TOPIC_MAX_LENGTH,
  type BlogField,
  type BlogNewsletterResponse,
  type BlogPost,
  type BlogPostStatus,
  isHttpsUrl,
} from "@domain/blog"
import { ADMIN_BLOG_PATHS, BlogStatusBadge } from "./admin-blog-list.tsx"
import { Dialogs } from "./admin-blog-dialogs.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

// #region Pure helpers

/** What the editor's fields hold: every text as typed, untrimmed; the key points in order. */
export interface BlogDraft {
  title: string
  slug: string
  description: string
  seoTitle: string
  tldr: string[]
  topic: string
  coverUrl: string
  coverAlt: string
  bodyMd: string
}

/** The editor's messages: one per field, `at` for the publish time, `form` for the rest. */
export type BlogFormErrors = Partial<Record<BlogField | `at` | `form`, string>>

/** The fields in the order the page shows them, so focus goes to the first one in error. */
export const BLOG_FIELD_ORDER: readonly BlogField[] = [
  `title`,
  `bodyMd`,
  `slug`,
  `description`,
  `seoTitle`,
  `tldr`,
  `topic`,
  `coverUrl`,
  `coverAlt`,
]

/** The fields that sit in the settings column, which a phone folds away. */
const SETTINGS_FIELDS: ReadonlySet<BlogField> = new Set([
  `slug`,
  `description`,
  `seoTitle`,
  `tldr`,
  `topic`,
  `coverUrl`,
  `coverAlt`,
])

/** How many description characters search results show; the counter counts towards it. */
export const BLOG_DESCRIPTION_SHOWN = 155
/** How many title characters search results show; the SEO title's counter counts towards it. */
export const BLOG_SEO_TITLE_SHOWN = 60

/** An empty post, as the create page starts. */
export function emptyBlogDraft(): BlogDraft {
  return {
    title: ``,
    slug: ``,
    description: ``,
    seoTitle: ``,
    tldr: [],
    topic: ``,
    coverUrl: ``,
    coverAlt: ``,
    bodyMd: ``,
  }
}

/** A saved post's fields, as the editor shows them. */
export function blogDraftOf(post: BlogPost): BlogDraft {
  return {
    title: post.title,
    slug: post.slug,
    description: post.description,
    seoTitle: post.seoTitle ?? ``,
    tldr: [...post.tldr],
    topic: post.topic ?? ``,
    coverUrl: post.coverUrl ?? ``,
    coverAlt: post.coverAlt ?? ``,
    bodyMd: post.bodyMd,
  }
}

/** Whether two drafts hold the same text in every field. */
export function sameBlogDraft(a: BlogDraft, b: BlogDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The slug a title suggests: `slugify`'s, kept to the letters a post's address allows (`a-z`,
 * digits and single hyphens). A title in another script suggests `""`, and the operator types one.
 */
export function blogSlugFromTitle(title: string): string {
  return slugify(title)
    .replace(/[^a-z0-9-]+/g, ``)
    .replace(/-{2,}/g, `-`)
    .slice(0, BLOG_SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, ``)
}

/**
 * The draft after an edit, with the slug following the title: while the post has never been
 * published and its slug is still the one its old title suggested, a new title moves the slug
 * too. A slug the operator typed themselves stays.
 */
export function followTitle(previous: BlogDraft, next: BlogDraft, locked: boolean): BlogDraft {
  if (locked || next.title === previous.title || next.slug !== previous.slug) return next
  if (previous.slug !== blogSlugFromTitle(previous.title)) return next
  return { ...next, slug: blogSlugFromTitle(next.title) }
}

/** How many words the Markdown has, counted as `readingMinutes` counts them. */
export function blogWordCount(markdown: string): number {
  return markdown.match(/\S+/g)?.length ?? 0
}

/**
 * The messages the editor shows before it sends anything, in the page's words. The API checks
 * every field again. `publishing` adds what only a live post needs: a body.
 */
export function blogDraftErrors(draft: BlogDraft, publishing = false): BlogFormErrors {
  const errors: BlogFormErrors = {}
  const slug = draft.slug.trim()
  if (draft.title.trim() === ``) errors.title = `Add a title.`
  if (slug === ``) errors.slug = `Add a slug.`
  else if (!BLOG_SLUG_PATTERN.test(slug)) {
    errors.slug = `Use lowercase letters, digits and hyphens only.`
  }
  if (draft.description.trim() === ``) errors.description = `Add a description.`
  else if (Array.from(draft.description.trim()).length > BLOG_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Keep it under ${BLOG_DESCRIPTION_MAX_LENGTH} characters.`
  }
  const cover = draft.coverUrl.trim()
  if (cover !== `` && !isHttpsUrl(cover)) errors.coverUrl = `Start the link with https://.`
  if (cover !== `` && draft.coverAlt.trim() === ``) errors.coverAlt = `Describe the cover image.`
  if (publishing && draft.bodyMd.trim() === ``) errors.bodyMd = `The post is empty.`
  return errors
}

/** The first field in error, in the page's order, or `null`. */
export function firstBlogError(errors: BlogFormErrors): BlogField | null {
  return BLOG_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null
}

/** The `id` of each field's control, so a message and focus can find it. */
export function blogFieldId(field: BlogField): string {
  return `blog-${field}`
}

// #endregion

/** Which dialog is open. `publish-now` and `reschedule` are the publish dialog on a scheduled post. */
export type BlogDialog =
  | `publish`
  | `publish-now`
  | `reschedule`
  | `unschedule`
  | `unpublish`
  | `change-url`
  | `delete`

/** What the publish dialog sends: now (`at` is `null`) or at a time, and the list to email. */
export interface BlogPublishChoice {
  at: string | null
  list: string | null
}

/** Where saving stands, for the line under the header. */
export type BlogSaveStatus = `saved` | `saving` | `failed` | `unsaved`

/** A body rendered by the API's renderer, the one the public page uses. */
export interface BlogPreview {
  html: string
  words: number
  readingMinutes: number
}

export interface AdminBlogEditorScreenProps {
  /** The post as saved, or `null` on the create page. */
  post: BlogPost | null
  /** The post is still being read. */
  loading: boolean
  /** No post has this id. */
  notFound: boolean
  /** The post could not be read; the screen offers to try again. */
  loadError: string | null
  onRetry: () => void
  /** What the fields show. */
  value: BlogDraft
  onChange: (value: BlogDraft) => void
  errors: BlogFormErrors
  saveStatus: BlogSaveStatus
  /** Someone else changed the post since it was read; saving is refused until it is reloaded. */
  conflict: boolean
  onReload: () => void
  /** Saves the draft (or creates the post). */
  onSave: () => void
  /** "Significant update" on a published post: the save moves its Updated date. */
  significantUpdate: boolean
  onSignificantUpdate: (value: boolean) => void
  /** The topics other posts use, offered as suggestions. */
  topics: readonly string[]
  /** Whether a post can be emailed, the lists, and the website's address; `null` while it loads. */
  newsletter: BlogNewsletterResponse | null
  /** The public website's address, for "View on website", or `null` when it is not set. */
  siteUrl: string | null
  /** The body as the API rendered it for the Preview tab, or `null` before the first render. */
  preview: BlogPreview | null
  previewPending: boolean
  previewError: string | null
  /** Renders the body for the Preview tab. Called when the tab opens. */
  onPreview: () => void
  dialog: BlogDialog | null
  dialogPending: boolean
  /** Why the API refused the dialog's action, or `null`. */
  dialogError: string | null
  onOpenDialog: (dialog: BlogDialog) => void
  onCloseDialog: () => void
  onPublish: (choice: BlogPublishChoice) => void
  onUnschedule: () => void
  onUnpublish: () => void
  onChangeUrl: (slug: string) => void
  onDelete: () => void
  /** The time a schedule must lie after. */
  now: Date
  navigate?: Navigate
}

const BACK = { href: ADMIN_BLOG_PATHS.list, label: `Back to blog` }

/**
 * One post's editor (#396): the title and the Markdown body with a Write and a Preview tab in the
 * writing column, and the post's settings in a 20rem column beside it from `lg` up (folded under
 * "Post settings" on a phone). The header names the status and whether the text is saved, and
 * holds the actions the status allows: a draft is saved and published; a scheduled or published
 * post is saved, and its other actions are in "More actions". Every action that cannot be undone
 * is confirmed.
 */
export function AdminBlogEditorScreen(props: AdminBlogEditorScreenProps): JSX.Element {
  const { navigate } = props
  if (props.notFound) {
    return (
      <Stack>
        <PageHeader back={BACK} navigate={navigate} title="Post" />
        <EmptyState
          title="This post does not exist"
          description="It may have been deleted. The blog lists every post there is."
          action={<Button href={ADMIN_BLOG_PATHS.list} navigate={navigate}>All posts</Button>}
        />
      </Stack>
    )
  }
  if (props.loadError) {
    return (
      <Stack>
        <PageHeader back={BACK} navigate={navigate} title="Post" />
        <div class="flex flex-col items-center gap-3" data-e2e="admin-blog-load-error">
          <ErrorState message="This post could not be loaded. Try again in a moment." />
          <Button variant="secondary" onClick={props.onRetry}>Try again</Button>
        </div>
      </Stack>
    )
  }
  if (props.loading) {
    return (
      <Stack>
        <PageHeader back={BACK} navigate={navigate} title="Post" />
        <div role="status" aria-label="Loading the post">
          <LoadingSkeleton rows={6} />
        </div>
      </Stack>
    )
  }
  return <Editor {...props} />
}

/** The words beside the status: whether what is on the page is saved. */
const SAVE_WORDS: Record<BlogSaveStatus, string> = {
  saved: `Saved`,
  saving: `Saving…`,
  failed: `Not saved. Check your connection, then save again.`,
  unsaved: `Not saved yet`,
}

function Editor(props: AdminBlogEditorScreenProps): JSX.Element {
  const { post, value, onChange, errors, navigate } = props
  const status: BlogPostStatus = post?.status ?? `draft`
  const locked = post?.publishedAt != null
  const [tab, setTab] = useState(`write`)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const saving = props.saveStatus === `saving`
  const root = useRef<HTMLDivElement>(null)

  // A message on a settings field opens the folded settings, then focus goes to the first field in
  // error, in the page's order, so the reader lands on what to fix.
  useEffect(() => {
    const first = firstBlogError(errors)
    if (first === null) return
    if (SETTINGS_FIELDS.has(first)) setSettingsOpen(true)
    if (first === `bodyMd`) setTab(`write`)
    queueMicrotask(() =>
      root.current?.querySelector<HTMLElement>(`#${blogFieldId(first)}`)?.focus()
    )
  }, [errors])

  // A save disables the form, which drops focus out of the field being typed in. Once it is done,
  // the field and its caret come back, so the next words typed after Ctrl S land where they were
  // meant to. A save refused with a field error leaves focus to the error instead.
  const resume = useRef<{ id: string; start: number | null; end: number | null } | null>(null)
  const save = () => {
    const field = root.current?.ownerDocument.activeElement
    resume.current = field && root.current?.contains(field) && field.id &&
        (field.tagName === `INPUT` || field.tagName === `TEXTAREA`)
      ? {
        id: field.id,
        start: (field as HTMLInputElement).selectionStart,
        end: (field as HTMLInputElement).selectionEnd,
      }
      : null
    props.onSave()
  }
  useEffect(() => {
    const back = resume.current
    if (saving || back === null) return
    resume.current = null
    if (firstBlogError(errors) !== null) return
    // A task later, after the app's route announcer: the first save of a new post moves the page
    // to the post's own address in the same round of effects, and the announcer would otherwise
    // take focus to the page's heading after this.
    const timer = setTimeout(() => {
      const field = root.current?.querySelector<HTMLInputElement>(`[id="${back.id}"]`)
      if (!field) return
      field.focus()
      if (back.start !== null) field.setSelectionRange(back.start, back.end ?? back.start)
    })
    return () => clearTimeout(timer)
  }, [saving])

  // Publishing, unscheduling or unpublishing removes the button that opened the dialog, so focus
  // would fall to the page's body. Once a dialog has closed and the post's status has moved, focus
  // goes to the page's title instead. A dialog closed without a change gives focus back itself.
  const statusAtDialog = useRef<BlogPostStatus | null>(null)
  const dialogWasOpen = useRef(false)
  useEffect(() => {
    const opened = props.dialog !== null && !dialogWasOpen.current
    dialogWasOpen.current = props.dialog !== null
    if (opened) statusAtDialog.current = status
    if (props.dialog !== null) return
    const before = statusAtDialog.current
    if (before === null || before === status) return
    statusAtDialog.current = null
    const title = root.current?.ownerDocument.querySelector<HTMLElement>(
      `[data-e2e=admin-blog-editor-title]`,
    )
    if (!title) return
    title.tabIndex = -1
    title.focus()
  }, [status, props.dialog])

  const edit = (patch: Partial<BlogDraft>) => onChange({ ...value, ...patch })
  const openPreview = (next: string) => {
    setTab(next)
    if (next === `preview`) props.onPreview()
  }

  const saveLabel = status === `draft` ? `Save draft` : `Save changes`
  const saveButton = (extra: string) => (
    <Button
      type="submit"
      variant={status === `draft` ? `secondary` : `primary`}
      class={extra}
      busy={saving}
      busyLabel="Saving…"
      hotkey="mod+s"
      disabled={props.conflict}
      data-e2e="admin-blog-save"
    >
      {saveLabel}
    </Button>
  )
  // On a phone the header keeps icon actions only; the save button sits under the text instead.
  const headerSave = <div class="hidden sm:block">{saveButton(``)}</div>
  const actions = status === `draft`
    ? (
      <div class="flex items-center gap-2">
        {headerSave}
        <PageAction
          label="Publish…"
          Icon={IconGlobe}
          disabled={props.conflict || saving}
          onClick={() => props.onOpenDialog(`publish`)}
          dataE2E="admin-blog-publish"
        />
      </div>
    )
    : headerSave

  const menu = post && (
    <>
      {status === `scheduled` && (
        <>
          <DropdownItem
            onClick={() => props.onOpenDialog(`publish-now`)}
            dataE2E="admin-blog-publish-now"
          >
            Publish now
          </DropdownItem>
          <DropdownItem
            onClick={() => props.onOpenDialog(`reschedule`)}
            dataE2E="admin-blog-reschedule"
          >
            Change time…
          </DropdownItem>
          <DropdownItem
            onClick={() => props.onOpenDialog(`unschedule`)}
            dataE2E="admin-blog-unschedule"
          >
            Unschedule
          </DropdownItem>
        </>
      )}
      {status === `published` && (
        <>
          {props.siteUrl && (
            <DropdownItem
              href={`${props.siteUrl}/blog/${post.slug}`}
              dataE2E="admin-blog-view"
            >
              View on website
            </DropdownItem>
          )}
          <DropdownItem
            onClick={() => props.onOpenDialog(`change-url`)}
            dataE2E="admin-blog-change-url"
          >
            Change URL…
          </DropdownItem>
          <DropdownItem
            onClick={() => props.onOpenDialog(`unpublish`)}
            dataE2E="admin-blog-unpublish"
          >
            Unpublish…
          </DropdownItem>
        </>
      )}
      <DropdownItem
        danger
        onClick={() => props.onOpenDialog(`delete`)}
        dataE2E="admin-blog-delete"
      >
        Delete post…
      </DropdownItem>
    </>
  )

  const words = blogWordCount(value.bodyMd)
  return (
    <>
      <ScreenForm pending={saving} onSubmit={save}>
        <Stack>
          <PageHeader
            back={BACK}
            navigate={navigate}
            title={post ? `Edit post` : `New post`}
            titleDataE2E="admin-blog-editor-title"
            subtitle={
              <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <BlogStatusBadge status={status} />
                <span
                  role="status"
                  class={props.saveStatus === `failed` ? `text-danger` : undefined}
                  data-e2e="admin-blog-saved"
                >
                  {post || props.saveStatus !== `unsaved` ? SAVE_WORDS[props.saveStatus] : ``}
                </span>
              </span>
            }
            action={actions}
            menu={menu}
            menuDataE2E="admin-blog-menu"
          />
          {props.conflict && (
            <Notice tone="warning" title="This post changed" data-e2e="admin-blog-conflict">
              <span class="flex flex-wrap items-center gap-3">
                Someone else changed this post. Reload to see their version.
                <Button type="button" variant="secondary" size="sm" onClick={props.onReload}>
                  Reload
                </Button>
              </span>
            </Notice>
          )}
          {errors.form && <ErrorState message={errors.form} />}
          <div ref={root} class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Stack>
              <Field
                id={blogFieldId(`title`)}
                label="Title"
                hint="Shown as the page heading and in search results."
                error={errors.title}
              >
                <Input
                  class="text-lg font-semibold"
                  data-e2e="admin-blog-title-field"
                  maxLength={BLOG_TITLE_MAX_LENGTH}
                  autocomplete="off"
                  value={value.title}
                  onInput={(e) => edit({ title: e.currentTarget.value })}
                />
              </Field>
              <Stack gap="sm">
                <span class="text-sm font-medium text-foreground" id="blog-body-label">Post</span>
                <Tabs
                  label="Post"
                  active={tab}
                  onChange={openPreview}
                  tabs={[
                    {
                      id: `write`,
                      label: `Write`,
                      content: (
                        <Field
                          id={blogFieldId(`bodyMd`)}
                          label={<span class="sr-only">Post, in Markdown</span>}
                          hint="Written in Markdown."
                          error={errors.bodyMd}
                        >
                          <Textarea
                            data-e2e="admin-blog-body"
                            class="min-h-80 font-mono text-sm field-sizing-content"
                            rows={16}
                            maxLength={BLOG_BODY_MAX_LENGTH}
                            value={value.bodyMd}
                            onInput={(e) => edit({ bodyMd: e.currentTarget.value })}
                          />
                        </Field>
                      ),
                    },
                    {
                      id: `preview`,
                      label: `Preview`,
                      content: <PreviewPanel {...props} />,
                    },
                  ]}
                />
                <p class="text-sm text-muted" data-e2e="admin-blog-words">
                  {NUMBER.format(words)} {words === 1 ? `word` : `words`} ·{` `}
                  {readingMinutes(value.bodyMd)} min read
                </p>
              </Stack>
            </Stack>
            <Settings
              {...props}
              locked={locked}
              open={settingsOpen}
              onToggle={() => setSettingsOpen(!settingsOpen)}
            />
          </div>
          {/* A phone's save button, after the settings, so the last field leads to it. */}
          <div class="sm:hidden">{saveButton(`min-h-11 w-full`)}</div>
        </Stack>
      </ScreenForm>
      <Dialogs {...props} />
    </>
  )
}

export const NUMBER = new Intl.NumberFormat(`en`)

/** The Preview tab: the body as the public page renders it, in the same `Prose` styles. */
function PreviewPanel(props: AdminBlogEditorScreenProps): JSX.Element {
  const { preview, value } = props
  if (props.previewError) {
    return (
      <div class="flex flex-col items-center gap-3 py-6" data-e2e="admin-blog-preview-error">
        <ErrorState message="The preview could not be made. Try again in a moment." />
        <Button type="button" variant="secondary" onClick={props.onPreview}>Try again</Button>
      </div>
    )
  }
  if (preview === null || props.previewPending) {
    return (
      <div role="status" aria-label="Rendering the preview" class="py-4">
        <LoadingSkeleton rows={6} />
      </div>
    )
  }
  const points = value.tldr.map((point) => point.trim()).filter((point) => point !== ``)
  return (
    <article
      class="flex flex-col gap-6 rounded-primary border border-subtle bg-surface px-4 py-6 sm:px-8"
      data-e2e="admin-blog-preview"
    >
      {value.topic.trim() && (
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">{value.topic.trim()}</p>
      )}
      {/* h2 under the page's h1 "Edit post", so the key points' h3 does not skip a level. */}
      <h2 class="text-3xl font-bold tracking-tight text-foreground wrap-anywhere">
        {value.title.trim() || `Untitled`}
      </h2>
      <TldrBox items={points} headingLevel={3} />
      {preview.html.trim()
        ? <Prose html={preview.html} />
        : <p class="text-muted">The post is empty.</p>}
    </article>
  )
}

/** A field's counter: `112 of 155`, in the warning colour past what search results show. */
function Counter({ length, shown, id }: { length: number; shown: number; id: string }) {
  return (
    <span id={id} class={`whitespace-nowrap ${length > shown ? `text-warning` : ``}`}>
      {NUMBER.format(length)} of {shown}
    </span>
  )
}

/**
 * The settings column: the address, what search results and previews show, the key points, the
 * topic and the cover, then where publishing stands. Below `lg` it folds under "Post settings".
 */
function Settings(
  props: AdminBlogEditorScreenProps & { locked: boolean; open: boolean; onToggle: () => void },
): JSX.Element {
  const { value, onChange, errors, locked, post } = props
  const edit = (patch: Partial<BlogDraft>) => onChange({ ...value, ...patch })
  const description = Array.from(value.description).length
  const seo = Array.from(value.seoTitle).length
  const cover = value.coverUrl.trim()
  return (
    <aside aria-label="Post settings" class="flex flex-col gap-4 lg:sticky lg:top-6">
      <button
        type="button"
        class="flex min-h-11 items-center justify-between rounded-primary border border-subtle bg-surface px-4 text-left font-medium text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:hidden"
        aria-expanded={props.open}
        aria-controls="blog-settings"
        data-e2e="admin-blog-settings-toggle"
        onClick={props.onToggle}
      >
        Post settings
        <IconChevronDown
          class={`size-5 transition-transform ${props.open ? `rotate-180` : ``}`}
          aria-hidden="true"
        />
      </button>
      <div
        id="blog-settings"
        class={`${props.open ? `flex` : `hidden`} flex-col gap-4 lg:flex`}
        data-e2e="admin-blog-settings"
      >
        {post && <PublishingFacts {...props} />}
        <Field
          id={blogFieldId(`slug`)}
          label="Slug"
          hint={locked
            ? `Locked since publishing. Change URL… breaks old links.`
            : `The post's address: /blog/${
              value.slug || `{slug}`
            }. Lowercase letters, digits and hyphens.`}
          error={errors.slug}
        >
          <Input
            class="font-mono text-sm"
            data-e2e="admin-blog-slug"
            maxLength={BLOG_SLUG_MAX_LENGTH}
            autocomplete="off"
            spellcheck={false}
            readOnly={locked}
            value={value.slug}
            onInput={(e) => edit({ slug: e.currentTarget.value })}
          />
        </Field>
        <Field
          id={blogFieldId(`description`)}
          label="Description"
          hint={
            <span class="flex justify-between gap-2">
              <span>One or two sentences for search results and link previews.</span>
              <Counter length={description} shown={BLOG_DESCRIPTION_SHOWN} id="blog-desc-count" />
            </span>
          }
          error={errors.description}
        >
          <Textarea
            rows={3}
            data-e2e="admin-blog-description"
            maxLength={BLOG_DESCRIPTION_MAX_LENGTH}
            value={value.description}
            onInput={(e) => edit({ description: e.currentTarget.value })}
          />
        </Field>
        <Field
          id={blogFieldId(`seoTitle`)}
          label="SEO title (optional)"
          hint={
            <span class="flex justify-between gap-2">
              <span>Shown in search results instead of the title. About 60 characters.</span>
              <Counter length={seo} shown={BLOG_SEO_TITLE_SHOWN} id="blog-seo-count" />
            </span>
          }
          error={errors.seoTitle}
        >
          <Input
            data-e2e="admin-blog-seo-title"
            maxLength={BLOG_SEO_TITLE_MAX_LENGTH}
            autocomplete="off"
            value={value.seoTitle}
            onInput={(e) => edit({ seoTitle: e.currentTarget.value })}
          />
        </Field>
        <ListField
          id={blogFieldId(`tldr`)}
          label="Key points"
          hint="Up to 5 short lines, shown at the top of the post."
          value={value.tldr}
          onChange={(tldr) => edit({ tldr })}
          max={BLOG_TLDR_MAX}
          maxLength={BLOG_TLDR_ITEM_MAX_LENGTH}
          error={errors.tldr}
          labels={{
            item: (n) => `Key point ${n}`,
            remove: (n) => `Remove key point ${n}`,
            add: `Add point`,
          }}
        />
        <Field
          id={blogFieldId(`topic`)}
          label="Topic"
          hint="Groups posts on the blog page. Pick one or type a new one."
          error={errors.topic}
        >
          <Input
            data-e2e="admin-blog-topic"
            list="blog-topics"
            maxLength={BLOG_TOPIC_MAX_LENGTH}
            autocomplete="off"
            value={value.topic}
            onInput={(e) => edit({ topic: e.currentTarget.value })}
          />
        </Field>
        <datalist id="blog-topics">
          {props.topics.map((topic) => <option key={topic} value={topic} />)}
        </datalist>
        <Field
          id={blogFieldId(`coverUrl`)}
          label="Cover image URL"
          hint="A full https:// link to a wide image, 1200×630. Leave empty for no cover."
          error={errors.coverUrl}
        >
          <Input
            type="url"
            inputMode="url"
            data-e2e="admin-blog-cover-url"
            maxLength={BLOG_COVER_URL_MAX_LENGTH}
            autocomplete="off"
            value={value.coverUrl}
            onInput={(e) => edit({ coverUrl: e.currentTarget.value })}
          />
        </Field>
        {cover !== `` && (
          <>
            <Field
              id={blogFieldId(`coverAlt`)}
              label="Cover description"
              hint="What the image shows, for people who cannot see it."
              error={errors.coverAlt}
            >
              <Input
                data-e2e="admin-blog-cover-alt"
                maxLength={BLOG_COVER_ALT_MAX_LENGTH}
                autocomplete="off"
                value={value.coverAlt}
                onInput={(e) => edit({ coverAlt: e.currentTarget.value })}
              />
            </Field>
            {isHttpsUrl(cover) && (
              <img
                src={cover}
                alt=""
                class="aspect-[1200/630] w-full rounded-primary border border-subtle bg-hover object-cover"
                loading="lazy"
                referrerpolicy="no-referrer"
              />
            )}
            <p class="text-xs text-muted">
              An image on another site shows that site your readers' IP addresses.
            </p>
          </>
        )}
      </div>
    </aside>
  )
}

/**
 * Where publishing stands: when a scheduled post goes live, when a published one did, its last
 * significant update and the checkbox that sets the next, and the newsletter send.
 */
function PublishingFacts(props: AdminBlogEditorScreenProps): JSX.Element | null {
  const { post } = props
  const format = useFormat()
  if (!post || post.status === `draft` && post.newsletterSentAt === null) return null
  return (
    <section
      aria-label="Publishing"
      class="flex flex-col gap-2 rounded-primary border border-subtle bg-surface p-4 text-sm"
      data-e2e="admin-blog-publishing"
    >
      {post.status === `scheduled` && post.publishAt && (
        <p>Goes live {format.dateTime(post.publishAt)}.</p>
      )}
      {post.status === `published` && post.publishedAt && (
        <p>
          Published {format.date(post.publishedAt)}
          {post.contentUpdatedAt && <>{` · `}Updated {format.date(post.contentUpdatedAt)}</>}.
        </p>
      )}
      {post.newsletterSentAt !== null
        ? (
          <p data-e2e="admin-blog-emailed">
            Emailed to {NUMBER.format(post.newsletterRecipients ?? 0)} on{` `}
            {format.date(post.newsletterSentAt)}
          </p>
        )
        : post.newsletterList !== null && (
          <p class="text-muted" data-e2e="admin-blog-will-email">
            Emailed to the {post.newsletterList} list when it goes live.
          </p>
        )}
      {post.status === `published` && (
        <Checkbox
          checked={props.significantUpdate}
          data-e2e="admin-blog-significant"
          onChange={(e) => props.onSignificantUpdate(e.currentTarget.checked)}
        >
          Significant update: the next save shows today as the post's Updated date
        </Checkbox>
      )}
    </section>
  )
}
