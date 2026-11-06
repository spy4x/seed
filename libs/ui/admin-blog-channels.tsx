import { Fragment, type JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { slugify } from "@spy4x/platform/universal/text"
import { IconEllipsisVertical, IconPlus, IconShare } from "@spy4x/preact-icons"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { useFormat } from "@spy4x/preact-ui/format"
import { Rich } from "@spy4x/preact-ui/i18n"
import { Input, Select } from "@spy4x/preact-ui/input"
import { languageName } from "@spy4x/preact-ui/language-picker"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
import { ToggleField } from "@spy4x/preact-ui/toggle-field"
import { Isolated } from "@spy4x/preact-ui/bdi"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { type Language, LANGUAGES } from "@domain/identity"
import {
  type AdminBlogChannelRow,
  type AdminBlogChannelsResponse,
  BLOG_AUTOMATIC_KINDS,
  BLOG_CHANNEL_ADDRESS_MAX_LENGTH,
  BLOG_CHANNEL_KINDS,
  BLOG_CHANNEL_NAME_MAX_LENGTH,
  BLOG_CHANNEL_UTM_SOURCE_MAX_LENGTH,
  type BlogChannel,
  type BlogChannelKind,
  channelPostCount,
} from "@domain/blog"
import { ListCard, ListEmpty, MENU_TRIGGER_CLASSES } from "./notes-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { useAdminText } from "./i18n.ts"

/** The sharing pages in the admin app. */
export const ADMIN_BLOG_SHARING_PATHS = {
  channels: `/blog/channels`,
  newChannel: `/blog/channels/new`,
  channel: (id: string) => `/blog/channels/${encodeURIComponent(id)}`,
  sharing: (postId: string) => `/blog/${encodeURIComponent(postId)}/sharing`,
  needsSharing: `/blog?sharing=todo`,
} as const

/** The env key the Dev.to job needs, named on a channel that waits for it. */
export const DEVTO_KEY_NAME = `DEVTO_API_KEY`

/** The error the Dev.to job leaves on its row while the key is not set. */
export const DEVTO_KEY_MISSING = `key-missing`

/** Brand names stay as they are; the two plain words come from the catalog. */
const KIND_NAMES: Record<BlogChannelKind, string> = {
  devto: `Dev.to`,
  telegram: `Telegram`,
  mastodon: `Mastodon`,
  bluesky: `Bluesky`,
  hashnode: `Hashnode`,
  linkedin: `LinkedIn`,
  x: `X`,
  reddit: `Reddit`,
  hackernews: `Hacker News`,
  newsletter: `AdminBlogChannels.kindNewsletter`,
  other: `AdminBlogChannels.kindOther`,
}

/** A kind's name in the page's language. */
export function blogChannelKindName(t: Translator<string>, kind: BlogChannelKind): string {
  return kind === `newsletter` || kind === `other` ? t.t(KIND_NAMES[kind]) : KIND_NAMES[kind]
}

/** The address field's hint for each kind (a catalog key). */
const ADDRESS_HINTS: Record<BlogChannelKind, string> = {
  devto: `AdminBlogChannels.addressProfile`,
  telegram: `AdminBlogChannels.addressTelegram`,
  mastodon: `AdminBlogChannels.addressMastodon`,
  bluesky: `AdminBlogChannels.addressBluesky`,
  hashnode: `AdminBlogChannels.addressProfile`,
  linkedin: `AdminBlogChannels.addressProfile`,
  x: `AdminBlogChannels.addressProfile`,
  reddit: `AdminBlogChannels.addressReddit`,
  hackernews: `AdminBlogChannels.addressHackernews`,
  newsletter: `AdminBlogChannels.addressNewsletter`,
  other: `AdminBlogChannels.addressOther`,
}

/** A value inside a sentence: code-like, isolated, never machine-translated. */
function literal(text: string): JSX.Element {
  return <code class="font-mono text-xs" translate={false}>{text}</code>
}

/** What an automatic channel's last post left: waiting for its key, or why it failed. */
export function ChannelProblem(
  { error, keyText }: { error: string | null; keyText: string },
): JSX.Element | null {
  const t = useAdminText()
  if (error === null) return null
  if (error === DEVTO_KEY_MISSING) {
    return (
      <span class="text-sm text-warning" data-e2e="blog-channel-key-missing">
        <Rich parts={t.parts(keyText, { key: DEVTO_KEY_NAME })} tags={{ key: literal }} />
      </span>
    )
  }
  return (
    <span class="text-sm text-danger wrap-anywhere" data-e2e="blog-channel-failed">
      {t.t(`AdminBlogChannels.lastFailed`, { reason: error })}
    </span>
  )
}

export interface AdminBlogChannelsScreenProps {
  /** Every channel with its counts, or `null` while it loads or when it failed. */
  list: AdminBlogChannelsResponse | null
  /** Set when the list could not be read, or a write was refused. */
  error: string | null
  /** A write is on its way; the menus wait for it. */
  busy: boolean
  /** Whether the archived channels are shown instead of the active ones. */
  archived: boolean
  onShowArchived: (archived: boolean) => void
  onRetry: () => void
  onArchive: (channel: AdminBlogChannelRow, archived: boolean) => void
  /** Deletes a channel without shares, after the operator confirms. */
  onDelete: (channel: AdminBlogChannelRow) => void
  navigate?: Navigate
}

/**
 * The sharing channels: every place posts are shared in, active or archived, each with its type,
 * languages, source tag, which posts it takes and how many of them are still to do. "Add channel"
 * is the page's one action; a name opens its form, and its menu archives, restores or deletes it.
 * After a change, focus goes to the next row's menu, else the page's action.
 */
export function AdminBlogChannelsScreen(props: AdminBlogChannelsScreenProps): JSX.Element {
  const { list, navigate, archived } = props
  const t = useAdminText()
  const format = useFormat()
  const [deleting, setDeleting] = useState<AdminBlogChannelRow | null>(null)
  /** The row to focus once the list read after a change arrives, and the list it replaces. */
  const [focusAt, setFocusAt] = useState<{ index: number; list: typeof list } | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const channels = list?.channels.filter((channel) => (channel.archivedAt !== null) === archived) ??
    null
  const counts = list && {
    active: list.channels.filter((channel) => channel.archivedAt === null).length,
    archived: list.channels.filter((channel) => channel.archivedAt !== null).length,
  }
  useEffect(() => {
    if (focusAt === null || props.busy || !channels || list === focusAt.list) return
    const menus = page.current?.querySelectorAll<HTMLElement>(`[data-e2e=blog-channel-menu]`)
    const target = menus?.[focusAt.index] ?? menus?.[focusAt.index - 1] ??
      page.current?.querySelector<HTMLElement>(`[data-e2e=blog-channel-new]`)
    target?.focus()
    setFocusAt(null)
  }, [focusAt, list, props.busy])

  // Delete opens on Cancel: the safe answer to a question that cannot be undone.
  const confirm = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (deleting) {
      confirm.current?.querySelector<HTMLElement>(`[data-e2e=confirm-dialog-cancel]`)?.focus()
    }
  }, [deleting])

  const act = (index: number, run: () => void) => {
    setFocusAt({ index, list })
    run()
  }

  return (
    <div ref={page} class="flex flex-col gap-8">
      <PageHeader
        back={{ href: `/blog`, label: t.t(`AdminBlogChannels.back`) }}
        navigate={navigate}
        title={t.t(`AdminBlogChannels.title`)}
        subtitle={t.t(`AdminBlogChannels.subtitle`)}
        titleDataE2E="blog-channels-title"
        action={
          <PageAction
            label={t.t(`AdminBlogChannels.add`)}
            Icon={IconPlus}
            href={ADMIN_BLOG_SHARING_PATHS.newChannel}
            navigate={navigate}
            dataE2E="blog-channel-new"
          />
        }
      />
      <Stack>
        {counts && (counts.archived > 0 || archived) && (
          <div
            class="-mx-4 flex max-w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0"
            data-e2e="blog-channels-filter"
          >
            <ToggleChips
              mode="single"
              label={t.t(`AdminBlogChannels.show`)}
              class="flex-nowrap"
              options={[
                {
                  value: `active`,
                  label: t.t(`AdminBlogChannels.chipActive`, { count: counts.active }),
                },
                {
                  value: `archived`,
                  label: t.t(`AdminBlogChannels.chipArchived`, { count: counts.archived }),
                },
              ]}
              value={archived ? `archived` : `active`}
              onChange={(value) => props.onShowArchived(value === `archived`)}
            />
          </div>
        )}
        {props.error && (
          <div class="flex flex-col items-center gap-3" data-e2e="blog-channels-error">
            <ErrorState message={list ? props.error : t.t(`AdminBlogChannels.listError`)} />
            {!list && (
              <Button variant="secondary" onClick={props.onRetry}>
                {t.t(`AdminBlogChannels.retry`)}
              </Button>
            )}
          </div>
        )}
        {channels === null
          ? !props.error && (
            <div role="status" aria-label={t.t(`AdminBlogChannels.loading`)}>
              <LoadingSkeleton rows={5} />
            </div>
          )
          : channels.length === 0
          ? (
            archived
              ? (
                <ListEmpty
                  title={t.t(`AdminBlogChannels.noArchived`)}
                  description={t.t(`AdminBlogChannels.noArchivedHint`)}
                />
              )
              : (
                <ListEmpty
                  icon={<IconShare class="size-8" aria-hidden="true" />}
                  title={t.t(`AdminBlogChannels.none`)}
                  description={t.t(`AdminBlogChannels.noneHint`)}
                  action={
                    <Button href={ADMIN_BLOG_SHARING_PATHS.newChannel} navigate={navigate}>
                      {t.t(`AdminBlogChannels.add`)}
                    </Button>
                  }
                />
              )
          )
          : (
            <ListCard dataE2E="blog-channel-list">
              {channels.map((channel, index) => (
                <li
                  key={channel.id}
                  class="flex min-h-14 items-start gap-3 px-4 py-3 sm:px-6"
                  data-e2e="blog-channel-row"
                >
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={ADMIN_BLOG_SHARING_PATHS.channel(channel.id)}
                        navigate={navigate}
                        class="pc-link line-clamp-2 font-medium wrap-anywhere"
                        translate={false}
                        data-e2e="blog-channel-edit"
                      >
                        {channel.name}
                      </Link>
                      {BLOG_AUTOMATIC_KINDS.has(channel.kind) && (
                        <Badge
                          text={t.t(`AdminBlogChannels.automatic`)}
                          color="blue"
                          type="outline"
                        />
                      )}
                    </div>
                    <span class="text-sm text-muted wrap-anywhere" data-e2e="blog-channel-facts">
                      {[
                        blogChannelKindName(t, channel.kind),
                        channel.languages.map(languageName).join(`, `),
                        channel.addUtm
                          ? t.t(`AdminBlogChannels.utm`, { tag: channel.utmSource })
                          : null,
                        channel.startsAt === null
                          ? t.t(`AdminBlogChannels.allPosts`)
                          : t.t(`AdminBlogChannels.fromDate`, {
                            date: format.date(channel.startsAt),
                          }),
                        channel.archivedAt === null
                          ? channel.toDo > 0
                            ? t.t(`AdminBlogChannels.toDo`, { count: channel.toDo })
                            : t.t(`AdminBlogChannels.noneToDo`)
                          : null,
                      ].filter((fact) => fact !== null).map((fact, index) => (
                        <Fragment key={index}>
                          {index > 0 && ` · `}
                          <span class="inline-block max-w-full">{fact}</span>
                        </Fragment>
                      ))}
                    </span>
                    <ChannelProblem
                      error={channel.lastError}
                      keyText="AdminBlogChannels.keyMissing"
                    />
                  </div>
                  <div class="relative -my-2 -me-2 shrink-0">
                    <Dropdown
                      trigger={<IconEllipsisVertical class="size-5" />}
                      triggerLabel={t.t(`AdminBlogChannels.actionsFor`, { name: channel.name })}
                      triggerClasses={MENU_TRIGGER_CLASSES}
                      triggerDataE2E="blog-channel-menu"
                    >
                      <DropdownItem
                        href={ADMIN_BLOG_SHARING_PATHS.channel(channel.id)}
                        navigate={navigate}
                      >
                        {t.t(`AdminBlogChannels.edit`)}
                      </DropdownItem>
                      <DropdownItem
                        disabled={props.busy}
                        dataE2E={archived ? `blog-channel-restore` : `blog-channel-archive`}
                        onClick={() => act(index, () => props.onArchive(channel, !archived))}
                      >
                        {t.t(archived ? `AdminBlogChannels.restore` : `AdminBlogChannels.archive`)}
                      </DropdownItem>
                      {channel.shares === 0 && (
                        <DropdownItem
                          danger
                          disabled={props.busy}
                          dataE2E="blog-channel-delete"
                          onClick={() => setDeleting(channel)}
                        >
                          {t.t(`AdminBlogChannels.delete`)}
                        </DropdownItem>
                      )}
                    </Dropdown>
                  </div>
                </li>
              ))}
            </ListCard>
          )}
      </Stack>
      {deleting && channels && (
        <div ref={confirm} class="contents">
          <ConfirmDialog
            title={
              <Isolated
                message={(name) => t.t(`AdminBlogChannels.deleteTitle`, { name })}
                value={deleting.name}
              />
            }
            message={t.t(`AdminBlogChannels.deleteText`)}
            confirmLabel={t.t(`AdminBlogChannels.deleteConfirm`)}
            cancelLabel={t.t(`AdminBlogChannels.cancel`)}
            tone="danger"
            dataE2E="blog-channel-delete-dialog"
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              const channel = deleting
              setDeleting(null)
              act(channels.findIndex((row) => row.id === channel.id), () => props.onDelete(channel))
            }}
          />
        </div>
      )}
    </div>
  )
}

/** Which posts a channel takes: every one, or those from its start on. */
export type BlogChannelWhich = `all` | `from`

/** What the channel form's fields hold. */
export interface BlogChannelFormValue {
  name: string
  kind: BlogChannelKind
  address: string
  utmSource: string
  /** Whether the operator typed the source tag; until then it follows the name. */
  utmEdited: boolean
  addUtm: boolean
  languages: Language[]
  which: BlogChannelWhich
}

/** The form's errors, by field, and for the form as a whole. */
export type BlogChannelFormErrors = Partial<
  Record<`name` | `address` | `utmSource` | `languages` | `form`, string>
>

/** A blank form: a newsletter takes posts from today on, every other kind all posts. */
export function blankChannelForm(kind: BlogChannelKind = `reddit`): BlogChannelFormValue {
  return {
    name: ``,
    kind,
    address: ``,
    utmSource: ``,
    utmEdited: false,
    addUtm: kind !== `hackernews`,
    languages: [`en`],
    which: kind === `newsletter` ? `from` : `all`,
  }
}

/** The form's fields for a saved channel. */
export function channelForm(channel: BlogChannel): BlogChannelFormValue {
  return {
    name: channel.name,
    kind: channel.kind,
    address: channel.address,
    utmSource: channel.utmSource,
    utmEdited: true,
    addUtm: channel.addUtm,
    languages: [...channel.languages],
    which: channel.startsAt === null ? `all` : `from`,
  }
}

/** The field ids, so a refused field can take focus. */
export function blogChannelFieldId(field: string): string {
  return `blog-channel-${field}`
}

export interface AdminBlogChannelScreenProps {
  /** The channel as saved, or `null` on the create page. */
  channel: BlogChannel | null
  loading: boolean
  notFound: boolean
  value: BlogChannelFormValue
  onChange: (value: BlogChannelFormValue) => void
  errors: BlogChannelFormErrors
  saving: boolean
  onSave: () => void
  /** Every live post's language and time, for the hint under "Which posts". */
  livePosts: AdminBlogChannelsResponse[`livePosts`]
  /** The time "Posts from today on" starts at on a new channel. */
  now: string
  navigate?: Navigate
}

/**
 * One sharing channel on a page of its own, at `/blog/channels/new` and `/blog/channels/:id`: its
 * name, type, address, source tag, languages and which posts it takes. The address's hint follows
 * the type, the source tag follows the name until typed, and the hint under "Which posts" says how
 * many live posts the choice lists it on. A refused field gets focus.
 */
export function AdminBlogChannelScreen(props: AdminBlogChannelScreenProps): JSX.Element {
  const { channel, value, errors, navigate } = props
  const t = useAdminText()
  const back = {
    href: ADMIN_BLOG_SHARING_PATHS.channels,
    label: t.t(`AdminBlogChannels.backToChannels`),
  }
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const first = [`name`, `address`, `utmSource`, `languages`].find((field) =>
      errors[field as keyof BlogChannelFormErrors]
    )
    if (!first) return
    const target = root.current?.querySelector<HTMLElement>(
      first === `languages`
        ? `[data-e2e=blog-channel-languages] button`
        : `#${blogChannelFieldId(first)}`,
    )
    target?.focus()
  }, [errors])

  if (props.notFound || (props.loading && !channel)) {
    return (
      <Stack gap="xl">
        <PageHeader back={back} navigate={navigate} title={t.t(`AdminBlogChannels.editTitle`)} />
        {props.notFound
          ? (
            <div data-e2e="blog-channel-not-found">
              <ListEmpty
                title={t.t(`AdminBlogChannels.notFound`)}
                description={t.t(`AdminBlogChannels.notFoundHint`)}
                action={
                  <Button href={back.href} navigate={navigate} variant="outline">
                    {back.label}
                  </Button>
                }
              />
            </div>
          )
          : (
            <div role="status" aria-label={t.t(`AdminBlogChannels.loadingChannel`)}>
              <LoadingSkeleton rows={4} class="max-w-md" />
            </div>
          )}
      </Stack>
    )
  }

  const startsAt = value.which === `all` ? null : channel?.startsAt ?? props.now
  const count = channelPostCount(props.livePosts, value.languages, startsAt)
  const hackerNews = value.kind === `hackernews`
  return (
    <div ref={root}>
      <Stack gap="xl">
        <PageHeader
          back={back}
          navigate={navigate}
          title={channel ? channel.name : t.t(`AdminBlogChannels.newTitle`)}
          titleDataE2E="blog-channel-title"
        />
        <ScreenForm pending={props.saving} onSubmit={props.onSave}>
          <Stack class="max-w-md">
            <Field
              id={blogChannelFieldId(`name`)}
              label={t.t(`AdminBlogChannels.name`)}
              hint={t.t(`AdminBlogChannels.nameHint`)}
              error={errors.name}
              required
            >
              <Input
                name="name"
                data-e2e="blog-channel-name"
                autocomplete="off"
                maxLength={BLOG_CHANNEL_NAME_MAX_LENGTH}
                value={value.name}
                onInput={(event) => {
                  const name = event.currentTarget.value
                  props.onChange({
                    ...value,
                    name,
                    utmSource: value.utmEdited
                      ? value.utmSource
                      : slugify(name).slice(0, BLOG_CHANNEL_UTM_SOURCE_MAX_LENGTH),
                  })
                }}
                required
              />
            </Field>
            <Field
              id={blogChannelFieldId(`kind`)}
              label={t.t(`AdminBlogChannels.kind`)}
              hint={t.t(`AdminBlogChannels.kindHint`)}
            >
              <Select
                name="kind"
                data-e2e="blog-channel-kind"
                value={value.kind}
                options={BLOG_CHANNEL_KINDS.map((kind) => ({
                  value: kind,
                  label: blogChannelKindName(t, kind),
                }))}
                onChange={(event) => {
                  const kind = event.currentTarget.value as BlogChannelKind
                  // A new channel takes the new kind's defaults until it is saved once.
                  const fresh = channel === null
                  props.onChange({
                    ...value,
                    kind,
                    address: kind === `hackernews` ? `news.ycombinator.com` : value.address,
                    addUtm: fresh ? kind !== `hackernews` : value.addUtm,
                    which: fresh ? (kind === `newsletter` ? `from` : `all`) : value.which,
                  })
                }}
              />
            </Field>
            <Field
              id={blogChannelFieldId(`address`)}
              label={t.t(`AdminBlogChannels.address`)}
              hint={t.t(ADDRESS_HINTS[value.kind])}
              error={errors.address}
              required={!hackerNews}
            >
              <Input
                name="address"
                data-e2e="blog-channel-address"
                autocomplete="off"
                inputMode={value.kind === `reddit` || value.kind === `mastodon` ||
                    value.kind === `bluesky`
                  ? `text`
                  : `url`}
                class="font-mono"
                maxLength={BLOG_CHANNEL_ADDRESS_MAX_LENGTH}
                readOnly={hackerNews}
                value={hackerNews ? `news.ycombinator.com` : value.address}
                onInput={(event) =>
                  props.onChange({ ...value, address: event.currentTarget.value })}
                required={!hackerNews}
              />
            </Field>
            <Field
              id={blogChannelFieldId(`utmSource`)}
              label={t.t(`AdminBlogChannels.source`)}
              hint={t.t(`AdminBlogChannels.sourceHint`)}
              error={errors.utmSource}
              required
            >
              <Input
                name="utmSource"
                data-e2e="blog-channel-source"
                autocomplete="off"
                class="font-mono"
                maxLength={BLOG_CHANNEL_UTM_SOURCE_MAX_LENGTH}
                value={value.utmSource}
                onInput={(event) =>
                  props.onChange({
                    ...value,
                    utmSource: event.currentTarget.value,
                    utmEdited: true,
                  })}
                required
              />
            </Field>
            <ToggleField
              id={blogChannelFieldId(`addUtm`)}
              label={t.t(`AdminBlogChannels.addUtm`)}
              value={value.addUtm}
              onToggle={(addUtm) => props.onChange({ ...value, addUtm })}
              description={value.addUtm
                ? (
                  <Rich
                    parts={t.parts(`AdminBlogChannels.sourcePreview`, {
                      tag: value.utmSource || `…`,
                    })}
                    tags={{ tag: literal }}
                  />
                )
                : t.t(`AdminBlogChannels.addUtmOff`)}
            />
            <Field
              id={blogChannelFieldId(`languages`)}
              label={t.t(`AdminBlogChannels.languages`)}
              hint={t.t(`AdminBlogChannels.languagesHint`)}
              error={errors.languages}
              labelFor={false}
            >
              <div data-e2e="blog-channel-languages">
                <ToggleChips
                  label={t.t(`AdminBlogChannels.languages`)}
                  options={LANGUAGES.map((language) => ({
                    value: language,
                    label: languageName(language),
                  }))}
                  value={value.languages}
                  onChange={(languages) =>
                    props.onChange({ ...value, languages: languages as Language[] })}
                />
              </div>
            </Field>
            <div class="flex flex-col gap-2">
              <RadioGroup
                legend={t.t(`AdminBlogChannels.which`)}
                name="which"
                data-e2e="blog-channel-which"
                options={[
                  { value: `all`, label: t.t(`AdminBlogChannels.whichAll`) },
                  { value: `from`, label: t.t(`AdminBlogChannels.whichToday`) },
                ]}
                value={value.which}
                onChange={(which) => props.onChange({ ...value, which: which as BlogChannelWhich })}
              />
              <p class="text-sm text-muted" aria-live="polite" data-e2e="blog-channel-count">
                {t.t(`AdminBlogChannels.whichHint`, { count })}
              </p>
            </div>
            <ErrorState message={errors.form ?? null} />
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                href={back.href}
                navigate={navigate}
                variant="ghost"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
              >
                {t.t(`AdminBlogChannels.cancel`)}
              </Button>
              <Button
                type="submit"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="blog-channel-save"
                busy={props.saving}
                busyLabel={t.t(`AdminBlogChannels.saving`)}
              >
                {t.t(`AdminBlogChannels.save`)}
              </Button>
            </div>
          </Stack>
        </ScreenForm>
      </Stack>
    </div>
  )
}
