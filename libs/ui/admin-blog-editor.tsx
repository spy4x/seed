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
import { Input, Select, Textarea } from "@spy4x/preact-ui/input"
import { languageName } from "@spy4x/preact-ui/language-picker"
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
  blogPostPath,
  type BlogPostStatus,
  isHttpsUrl,
} from "@domain/blog"
import { DEFAULT_LANGUAGE, type Language, LANGUAGES } from "@domain/identity"
import { ADMIN_BLOG_PATHS, BlogStatusBadge } from "./admin-blog-list.tsx"
import { Dialogs } from "./admin-blog-dialogs.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

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
  language: Language
  /** The id of the post this one translates, or `` for a post of its own. */
  translationOf: string
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
  `language`,
  `translationOf`,
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
  `language`,
  `translationOf`,
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
    language: DEFAULT_LANGUAGE,
    translationOf: ``,
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
    language: post.language,
    translationOf: post.translationOf ?? ``,
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

/** The catalog keys of the editor's own messages start with this; any other message is the API's. */
const OWN_MESSAGE = `AdminBlogEditor.`

/**
 * The messages the editor shows before it sends anything, as catalog keys: the state that holds
 * them has no translator, and the screen translates them ({@link blogErrorText}). The API checks
 * every field again. `publishing` adds what only a live post needs: a body.
 */
export function blogDraftErrors(draft: BlogDraft, publishing = false): BlogFormErrors {
  const errors: BlogFormErrors = {}
  const slug = draft.slug.trim()
  if (draft.title.trim() === ``) errors.title = `AdminBlogEditor.addTitle`
  if (slug === ``) errors.slug = `AdminBlogEditor.addSlug`
  else if (!BLOG_SLUG_PATTERN.test(slug)) errors.slug = `AdminBlogEditor.slugRule`
  if (draft.description.trim() === ``) errors.description = `AdminBlogEditor.addDescription`
  else if (Array.from(draft.description.trim()).length > BLOG_DESCRIPTION_MAX_LENGTH) {
    errors.description = `AdminBlogEditor.descriptionTooLong`
  }
  const cover = draft.coverUrl.trim()
  if (cover !== `` && !isHttpsUrl(cover)) errors.coverUrl = `AdminBlogEditor.httpsCover`
  if (cover !== `` && draft.coverAlt.trim() === ``) {
    errors.coverAlt = `AdminBlogEditor.describeCover`
  }
  if (publishing && draft.bodyMd.trim() === ``) errors.bodyMd = `AdminBlogEditor.emptyPost`
  return errors
}

/**
 * A field's message in the operator's language: the editor's own messages are catalog keys, and
 * the API's arrive already in words, so they pass through as they are.
 */
export function blogErrorText(
  t: Translator<string>,
  message: string | undefined,
): string | undefined {
  if (message === undefined || !message.startsWith(OWN_MESSAGE)) return message
  return t.t(message, { count: BLOG_DESCRIPTION_MAX_LENGTH })
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

/** A post another one may translate, as the "Translation of" field names it. */
export interface BlogOriginal {
  id: string
  title: string
  language: Language
}

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
  /**
   * The posts this one may translate: posts of their own, not translations, besides this one. The
   * field offers those in another language than the draft's.
   */
  originals: readonly BlogOriginal[]
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
  const t = useAdminText()
  const back = { href: ADMIN_BLOG_PATHS.list, label: t.t(`AdminBlogEditor.back`) }
  const title = t.t(`AdminBlogEditor.post`)
  if (props.notFound) {
    return (
      <Stack>
        <PageHeader back={back} navigate={navigate} title={title} />
        <EmptyState
          title={t.t(`AdminBlogEditor.notFound`)}
          description={t.t(`AdminBlogEditor.notFoundHint`)}
          action={
            <Button href={ADMIN_BLOG_PATHS.list} navigate={navigate}>
              {t.t(`AdminBlogEditor.allPosts`)}
            </Button>
          }
        />
      </Stack>
    )
  }
  if (props.loadError) {
    return (
      <Stack>
        <PageHeader back={back} navigate={navigate} title={title} />
        <div class="flex flex-col items-center gap-3" data-e2e="admin-blog-load-error">
          <ErrorState message={t.t(`AdminBlogEditor.loadError`)} />
          <Button variant="secondary" onClick={props.onRetry}>
            {t.t(`AdminBlogEditor.retry`)}
          </Button>
        </div>
      </Stack>
    )
  }
  if (props.loading) {
    return (
      <Stack>
        <PageHeader back={back} navigate={navigate} title={title} />
        <div role="status" aria-label={t.t(`AdminBlogEditor.loading`)}>
          <LoadingSkeleton rows={6} />
        </div>
      </Stack>
    )
  }
  return <Editor {...props} />
}

/** The words beside the status, as catalog keys: whether what is on the page is saved. */
const SAVE_WORDS: Record<BlogSaveStatus, string> = {
  saved: `AdminBlogEditor.saved`,
  saving: `AdminBlogEditor.saving`,
  failed: `AdminBlogEditor.saveFailed`,
  unsaved: `AdminBlogEditor.unsaved`,
}

function Editor(props: AdminBlogEditorScreenProps): JSX.Element {
  const { post, value, onChange, navigate } = props
  const t = useAdminText()
  // The fields' messages in the operator's language; the effect below reads which fields have one.
  const errors = props.errors
  const message = (field: BlogField) => blogErrorText(t, errors[field])
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

  const saveLabel = t.t(
    status === `draft` ? `AdminBlogEditor.saveDraft` : `AdminBlogEditor.saveChanges`,
  )
  const saveButton = (extra: string) => (
    <Button
      type="submit"
      variant={status === `draft` ? `secondary` : `primary`}
      class={extra}
      busy={saving}
      busyLabel={t.t(`AdminBlogEditor.saving`)}
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
          label={t.t(`AdminBlogEditor.publish`)}
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
            {t.t(`AdminBlogEditor.publishNow`)}
          </DropdownItem>
          <DropdownItem
            onClick={() => props.onOpenDialog(`reschedule`)}
            dataE2E="admin-blog-reschedule"
          >
            {t.t(`AdminBlogEditor.changeTime`)}
          </DropdownItem>
          <DropdownItem
            onClick={() => props.onOpenDialog(`unschedule`)}
            dataE2E="admin-blog-unschedule"
          >
            {t.t(`AdminBlogEditor.unschedule`)}
          </DropdownItem>
        </>
      )}
      {status === `published` && (
        <>
          {props.siteUrl && (
            <DropdownItem
              href={`${props.siteUrl}${blogPostPath(post)}`}
              dataE2E="admin-blog-view"
            >
              {t.t(`AdminBlogEditor.viewOnSite`)}
            </DropdownItem>
          )}
          <DropdownItem
            onClick={() => props.onOpenDialog(`change-url`)}
            dataE2E="admin-blog-change-url"
          >
            {t.t(`AdminBlogEditor.changeUrl`)}
          </DropdownItem>
          <DropdownItem
            onClick={() => props.onOpenDialog(`unpublish`)}
            dataE2E="admin-blog-unpublish"
          >
            {t.t(`AdminBlogEditor.unpublish`)}
          </DropdownItem>
        </>
      )}
      <DropdownItem
        danger
        onClick={() => props.onOpenDialog(`delete`)}
        dataE2E="admin-blog-delete"
      >
        {t.t(`AdminBlogEditor.deletePost`)}
      </DropdownItem>
    </>
  )

  const words = blogWordCount(value.bodyMd)
  return (
    <>
      <ScreenForm pending={saving} onSubmit={save}>
        <Stack>
          <PageHeader
            back={{ href: ADMIN_BLOG_PATHS.list, label: t.t(`AdminBlogEditor.back`) }}
            navigate={navigate}
            title={t.t(post ? `AdminBlogEditor.editPost` : `AdminBlogEditor.newPost`)}
            titleDataE2E="admin-blog-editor-title"
            subtitle={
              <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <BlogStatusBadge status={status} />
                <span
                  role="status"
                  class={props.saveStatus === `failed` ? `text-danger` : undefined}
                  data-e2e="admin-blog-saved"
                >
                  {post || props.saveStatus !== `unsaved` ? t.t(SAVE_WORDS[props.saveStatus]) : ``}
                </span>
              </span>
            }
            action={actions}
            menu={menu}
            menuDataE2E="admin-blog-menu"
          />
          {props.conflict && (
            <Notice
              tone="warning"
              title={t.t(`AdminBlogEditor.conflictTitle`)}
              data-e2e="admin-blog-conflict"
            >
              <span class="flex flex-wrap items-center gap-3">
                {t.t(`AdminBlogEditor.conflictText`)}
                <Button type="button" variant="secondary" size="sm" onClick={props.onReload}>
                  {t.t(`AdminBlogEditor.reload`)}
                </Button>
              </span>
            </Notice>
          )}
          {errors.form && <ErrorState message={errors.form} />}
          <div ref={root} class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Stack>
              <Field
                id={blogFieldId(`title`)}
                label={t.t(`AdminBlogEditor.title`)}
                hint={t.t(`AdminBlogEditor.titleHint`)}
                error={message(`title`)}
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
                <span class="text-sm font-medium text-foreground" id="blog-body-label">
                  {t.t(`AdminBlogEditor.post`)}
                </span>
                <Tabs
                  label={t.t(`AdminBlogEditor.post`)}
                  active={tab}
                  onChange={openPreview}
                  tabs={[
                    {
                      id: `write`,
                      label: t.t(`AdminBlogEditor.write`),
                      content: (
                        <Field
                          id={blogFieldId(`bodyMd`)}
                          label={<span class="sr-only">{t.t(`AdminBlogEditor.bodyLabel`)}</span>}
                          hint={t.t(`AdminBlogEditor.bodyHint`)}
                          error={message(`bodyMd`)}
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
                      label: t.t(`AdminBlogEditor.preview`),
                      content: <PreviewPanel {...props} />,
                    },
                  ]}
                />
                <p class="text-sm text-muted" data-e2e="admin-blog-words">
                  {t.t(`AdminBlogEditor.wordsRead`, {
                    count: words,
                    minutes: readingMinutes(value.bodyMd),
                  })}
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

/** The Preview tab: the body as the public page renders it, in the same `Prose` styles. */
function PreviewPanel(props: AdminBlogEditorScreenProps): JSX.Element {
  const { preview, value } = props
  const t = useAdminText()
  if (props.previewError) {
    return (
      <div class="flex flex-col items-center gap-3 py-6" data-e2e="admin-blog-preview-error">
        <ErrorState message={t.t(`AdminBlogEditor.previewError`)} />
        <Button type="button" variant="secondary" onClick={props.onPreview}>
          {t.t(`AdminBlogEditor.retry`)}
        </Button>
      </div>
    )
  }
  if (preview === null || props.previewPending) {
    return (
      <div role="status" aria-label={t.t(`AdminBlogEditor.rendering`)} class="py-4">
        <LoadingSkeleton rows={6} />
      </div>
    )
  }
  const points = value.tldr.map((point) => point.trim()).filter((point) => point !== ``)
  return (
    <article
      class="flex flex-col gap-6 rounded-primary border border-subtle bg-surface px-4 py-6 sm:px-8"
      translate={false}
      data-e2e="admin-blog-preview"
    >
      {value.topic.trim() && (
        <p class="text-xs font-semibold uppercase tracking-wide text-muted">{value.topic.trim()}</p>
      )}
      {/* h2 under the page's h1 "Edit post", so the key points' h3 does not skip a level. */}
      <h2 class="text-3xl font-bold tracking-tight text-foreground wrap-anywhere">
        {value.title.trim() || t.t(`AdminBlogEditor.untitled`)}
      </h2>
      <TldrBox items={points} headingLevel={3} />
      {preview.html.trim()
        ? <Prose html={preview.html} />
        : <p class="text-muted">{t.t(`AdminBlogEditor.emptyPost`)}</p>}
    </article>
  )
}

/** A field's counter: `112 of 155`, in the warning colour past what search results show. */
function Counter({ length, shown, id }: { length: number; shown: number; id: string }) {
  const t = useAdminText()
  return (
    <span id={id} class={`whitespace-nowrap ${length > shown ? `text-warning` : ``}`}>
      {t.t(`AdminBlogEditor.counter`, { length, shown })}
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
  const { value, onChange, locked, post } = props
  const t = useAdminText()
  const message = (field: BlogField) => blogErrorText(t, props.errors[field])
  const edit = (patch: Partial<BlogDraft>) => onChange({ ...value, ...patch })
  const description = Array.from(value.description).length
  const seo = Array.from(value.seoTitle).length
  const cover = value.coverUrl.trim()
  return (
    <aside
      aria-label={t.t(`AdminBlogEditor.settings`)}
      class="flex flex-col gap-4 lg:sticky lg:top-6"
    >
      <button
        type="button"
        class="flex min-h-11 items-center justify-between rounded-primary border border-subtle bg-surface px-4 text-left font-medium text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:hidden"
        aria-expanded={props.open}
        aria-controls="blog-settings"
        data-e2e="admin-blog-settings-toggle"
        onClick={props.onToggle}
      >
        {t.t(`AdminBlogEditor.settings`)}
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
          label={t.t(`AdminBlogEditor.slug`)}
          hint={locked ? t.t(`AdminBlogEditor.slugLocked`) : (
            <Rich
              parts={t.parts(`AdminBlogEditor.slugHint`, {
                path: blogPostPath({ language: value.language, slug: value.slug || `{slug}` }),
              })}
              tags={{ path: (text: string) => <bdi translate={false}>{text}</bdi> }}
            />
          )}
          error={message(`slug`)}
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
          label={t.t(`AdminBlogEditor.description`)}
          hint={
            <span class="flex justify-between gap-2">
              <span>{t.t(`AdminBlogEditor.descriptionHint`)}</span>
              <Counter length={description} shown={BLOG_DESCRIPTION_SHOWN} id="blog-desc-count" />
            </span>
          }
          error={message(`description`)}
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
          label={t.t(`AdminBlogEditor.seoTitle`)}
          hint={
            <span class="flex justify-between gap-2">
              <span>{t.t(`AdminBlogEditor.seoTitleHint`)}</span>
              <Counter length={seo} shown={BLOG_SEO_TITLE_SHOWN} id="blog-seo-count" />
            </span>
          }
          error={message(`seoTitle`)}
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
          label={t.t(`AdminBlogEditor.keyPoints`)}
          hint={t.t(`AdminBlogEditor.keyPointsHint`)}
          value={value.tldr}
          onChange={(tldr) => edit({ tldr })}
          max={BLOG_TLDR_MAX}
          maxLength={BLOG_TLDR_ITEM_MAX_LENGTH}
          error={message(`tldr`)}
          labels={{
            item: (n) => t.t(`AdminBlogEditor.keyPoint`, { n }),
            remove: (n) => t.t(`AdminBlogEditor.removeKeyPoint`, { n }),
            add: t.t(`AdminBlogEditor.addPoint`),
          }}
        />
        <Field
          id={blogFieldId(`topic`)}
          label={t.t(`AdminBlogEditor.topic`)}
          hint={t.t(`AdminBlogEditor.topicHint`)}
          error={message(`topic`)}
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
          id={blogFieldId(`language`)}
          label={t.t(`AdminBlogEditor.language`)}
          hint={t.t(`AdminBlogEditor.languageHint`)}
          error={message(`language`)}
        >
          <Select
            data-e2e="admin-blog-language"
            value={value.language}
            options={LANGUAGES.map((language) => ({
              value: language,
              label: languageName(language),
            }))}
            onChange={(e) => edit({ language: e.currentTarget.value as Language })}
          />
        </Field>
        <Field
          id={blogFieldId(`translationOf`)}
          label={t.t(`AdminBlogEditor.translationOf`)}
          hint={t.t(`AdminBlogEditor.translationOfHint`)}
          error={message(`translationOf`)}
        >
          <Select
            data-e2e="admin-blog-translation-of"
            value={value.translationOf}
            options={[
              { value: ``, label: t.t(`AdminBlogEditor.translationNone`) },
              ...props.originals
                .filter((original) =>
                  original.language !== value.language || original.id === value.translationOf
                )
                .map((original) => ({
                  value: original.id,
                  label: `${original.title} (${languageName(original.language)})`,
                })),
            ]}
            onChange={(e) => edit({ translationOf: e.currentTarget.value })}
          />
        </Field>
        <Field
          id={blogFieldId(`coverUrl`)}
          label={t.t(`AdminBlogEditor.coverUrl`)}
          hint={t.t(`AdminBlogEditor.coverUrlHint`)}
          error={message(`coverUrl`)}
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
              label={t.t(`AdminBlogEditor.coverAlt`)}
              hint={t.t(`AdminBlogEditor.coverAltHint`)}
              error={message(`coverAlt`)}
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
              {t.t(`AdminBlogEditor.coverPrivacy`)}
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
  const t = useAdminText()
  if (!post || post.status === `draft` && post.newsletterSentAt === null) return null
  return (
    <section
      aria-label={t.t(`AdminBlogEditor.publishing`)}
      class="flex flex-col gap-2 rounded-primary border border-subtle bg-surface p-4 text-sm"
      data-e2e="admin-blog-publishing"
    >
      {post.status === `scheduled` && post.publishAt && (
        <p>{t.t(`AdminBlogEditor.goesLive`, { date: format.dateTime(post.publishAt) })}</p>
      )}
      {post.status === `published` && post.publishedAt && (
        <p>
          {post.contentUpdatedAt
            ? t.t(`AdminBlogEditor.publishedUpdated`, {
              date: format.date(post.publishedAt),
              updated: format.date(post.contentUpdatedAt),
            })
            : t.t(`AdminBlogEditor.publishedOn`, { date: format.date(post.publishedAt) })}
        </p>
      )}
      {post.newsletterSentAt !== null
        ? (
          <p data-e2e="admin-blog-emailed">
            {t.t(`AdminBlogEditor.emailedTo`, {
              count: post.newsletterRecipients ?? 0,
              date: format.date(post.newsletterSentAt),
            })}
          </p>
        )
        : post.newsletterList !== null && (
          <p class="text-muted" data-e2e="admin-blog-will-email">
            <Rich
              parts={t.parts(`AdminBlogEditor.willEmail`, { list: post.newsletterList })}
              tags={{ list: (text: string) => <bdi translate={false}>{text}</bdi> }}
            />
          </p>
        )}
      {post.status === `published` && (
        <Checkbox
          checked={props.significantUpdate}
          data-e2e="admin-blog-significant"
          onChange={(e) => props.onSignificantUpdate(e.currentTarget.checked)}
        >
          {t.t(`AdminBlogEditor.significant`)}
        </Checkbox>
      )}
    </section>
  )
}
