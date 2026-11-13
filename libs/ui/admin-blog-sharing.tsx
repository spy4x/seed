import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconChevronDown, IconSpinner } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { CopyBlock } from "@spy4x/preact-ui/copy-block"
import type { ComponentProps } from "preact"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { useFormat } from "@spy4x/preact-ui/format"
import { Rich } from "@spy4x/preact-ui/i18n"
import { Input } from "@spy4x/preact-ui/input"
import { useHotkeys } from "@spy4x/preact-ui/hotkeys"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Modal } from "@spy4x/preact-ui/modal"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import {
  type AdminBlogShareRow,
  type AdminBlogSharingResponse,
  type AdminBlogVisits,
  BLOG_RESULT_FIELDS,
  BLOG_SHARE_SKIP_REASON_MAX_LENGTH,
  BLOG_SHARE_URL_MAX_LENGTH,
  blogChannelHref,
  type BlogShareResultField,
  type BlogShareResultsRequest,
  type BlogShareState,
  type BlogShareStatus,
  blogSharingCounts,
  channelPostsAutomatically,
} from "@domain/blog"
import { ADMIN_BLOG_PATHS } from "./admin-blog-list.tsx"
import {
  ADMIN_BLOG_SHARING_PATHS,
  AutoPostProblem,
  LinkedinSignIn,
} from "./admin-blog-channels.tsx"
import { ListEmpty } from "./notes-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { useAdminText } from "./i18n.ts"
import { languageNameIn } from "./preferences.tsx"

/** The clipboard port `CopyBlock` takes. */
type CopyPort = ComponentProps<typeof CopyBlock>[`copy`]

/** One change to one or more rows, as `POST /blog/posts/:id/shares` takes it. */
export interface BlogShareChange {
  channelIds: string[]
  status: BlogShareStatus | `none`
  url?: string | null
  skipReason?: string | null
  /** Sent only by Undo, so the row comes back with its date, its automatic flag and its error. */
  sharedAt?: string | null
  automatic?: boolean
  error?: string | null
}

/** The dialog open on the page, if any. */
type SharingDialog =
  | { kind: `skip`; row: AdminBlogShareRow }
  | { kind: `results`; row: AdminBlogShareRow }
  | { kind: `link`; row: AdminBlogShareRow }

export interface AdminBlogSharingScreenProps {
  postId: string
  /** The checklist, or `null` while it loads or when it failed. */
  sharing: AdminBlogSharingResponse | null
  /** Set when the checklist could not be read. */
  loadError: string | null
  onRetry: () => void
  /** The channel whose change is on its way, or `null`. The rows wait while one is. */
  pending: string | null
  /** A refused change's message, by channel id, shown under that row's link field. */
  rowErrors: Readonly<Record<string, string>>
  onChange: (change: BlogShareChange) => void
  /** Asks for a channel's failed automatic post again. */
  onRetryPost: (channelId: string) => void
  /** The time the LinkedIn sign-in is measured against; the clock's by default. */
  now?: number
  /** The results dialog's save is on its way, and its refusal. */
  resultsPending: boolean
  resultsError: string | null
  onResults: (channelId: string, counts: BlogShareResultsRequest) => void
  /** The polite announcement after a change, such as "Posted on Hacker News. 2 left." */
  announcement: string
  /** The clipboard, for tests; the browser's by default. */
  copy?: CopyPort
  navigate?: Navigate
}

/** The group each state goes in, in the page's order. */
const GROUPS: { key: string; states: BlogShareState[]; folded: boolean }[] = [
  { key: `AdminBlogSharing.groupToDo`, states: [`todo`], folded: false },
  { key: `AdminBlogSharing.groupSuggested`, states: [`suggested`], folded: false },
  { key: `AdminBlogSharing.groupPosted`, states: [`posted`, `covered`], folded: true },
  { key: `AdminBlogSharing.groupSkipped`, states: [`skipped`], folded: true },
]

const STATUS_WORDS: Record<BlogShareState, string> = {
  todo: `AdminBlogSharing.statusToDo`,
  suggested: `AdminBlogSharing.statusSuggested`,
  posted: `AdminBlogSharing.statusPosted`,
  skipped: `AdminBlogSharing.statusSkipped`,
  covered: `AdminBlogSharing.covered`,
}

const RESULT_WORDS: Record<BlogShareResultField, string> = {
  views: `AdminBlogSharing.views`,
  reactions: `AdminBlogSharing.reactions`,
  comments: `AdminBlogSharing.comments`,
  score: `AdminBlogSharing.score`,
}

const ROW = `[data-e2e=blog-share-row]`

/** A value inside a sentence: code-like, isolated, never machine-translated. */
function literal(text: string): JSX.Element {
  return <code class="font-mono text-xs" translate={false}>{text}</code>
}

/** Where focus goes once the change on its way lands: the next to-do row, or a given row. */
type FocusAfter = { kind: `next` } | { kind: `row`; channelId: string }

/**
 * A post's sharing checklist, at `/blog/:id/sharing`: every channel the post fits, grouped by its
 * next step (to do, suggested, posted, skipped) with the finished groups folded. A to-do row has
 * the text to paste, the submit form for Reddit and Hacker News, and the link field: pasting the
 * copy's link and pressing Enter marks it posted. The status menu changes a row at once; the app
 * shows a toast with Undo. After a change focus moves to the next to-do row, or to the heading
 * once none is left; after Undo it moves to the row put back. Page-wide keys, off in a text field
 * and in a dialog: `j` and `k` move between rows; `t`, `o`, `p`, `s` and `e` copy the row's text,
 * open its channel, focus its link field, skip it and enter its results.
 */
export function AdminBlogSharingScreen(props: AdminBlogSharingScreenProps): JSX.Element {
  const { sharing, navigate } = props
  const t = useAdminText()
  const [dialog, setDialog] = useState<SharingDialog | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const focusAfter = useRef<FocusAfter | null>(null)
  // Set by a `g`, so the key after it belongs to the shell's "Go to" sequence, not to a row.
  const afterG = useRef(false)
  const back = { href: ADMIN_BLOG_PATHS.post(props.postId), label: t.t(`AdminBlogSharing.back`) }
  const title = sharing?.post.title ?? t.t(`AdminBlogSharing.title`)

  useEffect(() => {
    if (props.pending !== null) {
      // A change the screen did not start is Undo: focus follows the row it puts back.
      focusAfter.current ??= { kind: `row`, channelId: props.pending }
      return
    }
    const after = focusAfter.current
    if (after === null || dialog !== null || !page.current) return
    focusAfter.current = null
    const root = page.current
    let target = after.kind === `row`
      ? root.querySelector<HTMLElement>(`${ROW}[data-channel="${after.channelId}"]`)
      : root.querySelector<HTMLElement>(`${ROW}[data-state=todo]`)
    const folded = target?.closest(`details`)
    if (folded && !folded.open) folded.open = true
    if (!target) {
      target = root.querySelector<HTMLElement>(`h1`)
      if (target && !target.hasAttribute(`tabindex`)) target.tabIndex = -1
    }
    target?.focus()
  }, [props.pending, sharing, dialog])

  const change = (change: BlogShareChange) => {
    focusAfter.current = { kind: `next` }
    props.onChange(change)
  }

  /** The row focus is in, or the first one, and the shown rows in order. */
  const rowsShown = () => {
    const all = [...page.current?.querySelectorAll<HTMLElement>(ROW) ?? []]
      .filter((row) => row.closest(`details`)?.open !== false)
    const current = (page.current?.ownerDocument.activeElement as HTMLElement | null | undefined)
      ?.closest<HTMLElement>(ROW)
    return { all, at: current ? all.indexOf(current) : -1 }
  }
  /** Runs `act` on the focused row and its data; does nothing when focus is on no row. */
  const onRow = (act: (element: HTMLElement, row: AdminBlogShareRow) => void) => () => {
    const { all, at } = rowsShown()
    const row = sharing?.rows.find((candidate) => candidate.channel.id === all[at]?.dataset.channel)
    if (row) act(all[at], row)
  }
  const live = sharing?.post.status === `published`
  const key = (keys: string, handler: () => void) => ({
    keys,
    handler: () => {
      const skip = afterG.current
      afterG.current = false
      if (!skip && sharing && dialog === null) handler()
    },
  })
  useHotkeys([
    { keys: `g`, preventDefault: false, handler: () => afterG.current = true },
    ...[`j`, `k`].map((keys) =>
      key(keys, () => {
        const { all, at } = rowsShown()
        all[keys === `j` ? at + 1 : at < 0 ? 0 : at - 1]?.focus()
      })
    ),
    key(
      `t`,
      onRow((element) =>
        element.querySelector<HTMLElement>(`[data-e2e=blog-share-text] button`)?.click()
      ),
    ),
    key(
      `o`,
      onRow((element) => element.querySelector<HTMLElement>(`[data-e2e=blog-share-open]`)?.click()),
    ),
    key(
      `p`,
      onRow((element) => element.querySelector<HTMLElement>(`[data-e2e=blog-share-link]`)?.focus()),
    ),
    key(`s`, onRow((_, row) => live && setDialog({ kind: `skip`, row }))),
    key(
      `e`,
      onRow((_, row) => row.share?.status === `posted` && setDialog({ kind: `results`, row })),
    ),
  ])

  if (!sharing) {
    return (
      <div ref={page} class="flex flex-col gap-8">
        <PageHeader back={back} navigate={navigate} title={title} />
        {props.loadError
          ? (
            <div class="flex flex-col items-center gap-3" data-e2e="blog-sharing-error">
              <ErrorState message={t.t(`AdminBlogSharing.loadError`)} />
              <Button variant="secondary" onClick={props.onRetry}>
                {t.t(`AdminBlogSharing.retry`)}
              </Button>
            </div>
          )
          : (
            <div role="status" aria-label={t.t(`AdminBlogSharing.loading`)}>
              <LoadingSkeleton rows={5} />
            </div>
          )}
      </div>
    )
  }

  const { post, rows } = sharing
  const counts = blogSharingCounts(rows)
  const toDo = rows.filter((row) => row.state === `todo`)
  const language = languageNameIn(post.language, t.language) ?? post.language
  const subtitle = [
    language,
    ...(live && counts.total > 0
      ? [
        t.t(`AdminBlogSharing.shared`, { done: counts.done, total: counts.total }),
        counts.toDo > 0
          ? t.t(`AdminBlogSharing.toDo`, { count: counts.toDo })
          : t.t(`AdminBlogSharing.allDone`),
        ...(counts.suggested > 0
          ? [t.t(`AdminBlogSharing.suggested`, { count: counts.suggested })]
          : []),
      ]
      : []),
  ].join(` · `)

  return (
    <div ref={page} class="flex flex-col gap-8">
      <PageHeader
        back={back}
        navigate={navigate}
        title={title}
        subtitle={subtitle}
        subtitleDataE2E="blog-sharing-subtitle"
        titleDataE2E="blog-sharing-title"
        menuDataE2E="blog-sharing-menu"
        menu={
          <>
            {live && toDo.length > 0 && (
              <DropdownItem
                dataE2E="blog-sharing-skip-rest"
                disabled={props.pending !== null}
                onClick={() =>
                  change({
                    channelIds: toDo.map((row) => row.channel.id),
                    status: `skipped`,
                    skipReason: null,
                  })}
              >
                {t.t(`AdminBlogSharing.skipRest`)}
              </DropdownItem>
            )}
            <DropdownItem href={ADMIN_BLOG_SHARING_PATHS.channels} navigate={navigate}>
              {t.t(`AdminBlogSharing.manage`)}
            </DropdownItem>
          </>
        }
      />
      <p class="sr-only" aria-live="polite" data-e2e="blog-sharing-announce">
        {props.announcement}
      </p>
      {!live
        ? <ListEmpty title={t.t(`AdminBlogSharing.notLive`)} />
        : !sharing.hasChannels
        ? (
          <ListEmpty
            title={t.t(`AdminBlogSharing.noChannels`)}
            action={
              <Button href={ADMIN_BLOG_SHARING_PATHS.newChannel} navigate={navigate}>
                {t.t(`AdminBlogSharing.addChannel`)}
              </Button>
            }
          />
        )
        : rows.length === 0
        ? (
          <ListEmpty
            title={t.t(`AdminBlogSharing.noneFit`, { language })}
            action={
              <Button href={ADMIN_BLOG_SHARING_PATHS.newChannel} navigate={navigate}>
                {t.t(`AdminBlogSharing.addChannel`)}
              </Button>
            }
          />
        )
        : GROUPS.map((group) => {
          const members = rows.filter((row) => group.states.includes(row.state))
          if (members.length === 0) return null
          const heading = t.t(group.key, { count: members.length })
          const list = (
            <ul class="flex flex-col divide-y divide-subtle rounded-primary border border-subtle bg-surface">
              {members.map((row) => (
                <ShareRow
                  key={row.channel.id}
                  row={row}
                  visits={sharing.visits}
                  pending={props.pending}
                  error={props.rowErrors[row.channel.id] ?? null}
                  copy={props.copy}
                  onChange={change}
                  onDialog={setDialog}
                  auto={{
                    translation: sharing.post.translationOf !== null,
                    linkedinExpiresAt: sharing.linkedinExpiresAt,
                    now: props.now ?? Date.now(),
                    onRetry: props.onRetryPost,
                  }}
                />
              ))}
            </ul>
          )
          // Posted opens once nothing is left to do, so the finished page shows its results.
          return group.folded
            ? (
              <details
                key={group.key}
                open={group.key === `AdminBlogSharing.groupPosted` && counts.toDo === 0}
                class="flex flex-col gap-3"
                data-e2e="blog-sharing-group"
              >
                <summary class="cursor-pointer py-2 font-medium">{heading}</summary>
                <div class="pt-3">{list}</div>
              </details>
            )
            : (
              <section
                key={group.key}
                class="flex flex-col gap-3"
                aria-label={heading}
                data-e2e="blog-sharing-group"
              >
                <h2 class="font-medium">{heading}</h2>
                {list}
              </section>
            )
        })}
      {dialog?.kind === `skip` && (
        <SkipDialog
          row={dialog.row}
          onCancel={() => setDialog(null)}
          onSkip={(skipReason) => {
            setDialog(null)
            change({ channelIds: [dialog.row.channel.id], status: `skipped`, skipReason })
          }}
        />
      )}
      {dialog?.kind === `link` && (
        <LinkDialog
          row={dialog.row}
          onCancel={() => setDialog(null)}
          onSave={(url) => {
            setDialog(null)
            change({ channelIds: [dialog.row.channel.id], status: `posted`, url })
          }}
        />
      )}
      {dialog?.kind === `results` && (
        <ResultsDialog
          row={dialog.row}
          pending={props.resultsPending}
          error={props.resultsError}
          onCancel={() => setDialog(null)}
          onSave={(counts) => props.onResults(dialog.row.channel.id, counts)}
          onSaved={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/** One channel's row: its name, address and status menu, then what its state asks for. */
function ShareRow(
  { row, visits, pending, error, copy, onChange, onDialog, auto }: {
    row: AdminBlogShareRow
    visits: AdminBlogVisits
    pending: string | null
    error: string | null
    copy?: CopyPort
    onChange: (change: BlogShareChange) => void
    onDialog: (dialog: SharingDialog) => void
    auto: AutoPostContext
  },
): JSX.Element {
  const t = useAdminText()
  const { channel, share, state } = row
  const ids = [channel.id]
  const busy = pending !== null
  const name = channel.name
  const statusWord = t.t(STATUS_WORDS[state])
  const open = blogChannelHref(channel)
  const automatic = channelPostsAutomatically(channel, auto.translation)
  const muted = state === `covered` || channel.archivedAt !== null
  return (
    <li
      tabIndex={-1}
      class={`flex flex-col gap-3 px-4 py-4 outline-offset-2 sm:px-6 ${muted ? `text-muted` : ``}`}
      data-e2e="blog-share-row"
      data-state={state}
      data-channel={channel.id}
    >
      <div class="flex items-start gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <h3 class="line-clamp-2 font-medium wrap-anywhere" translate={false}>{name}</h3>
          <span
            class="truncate font-mono text-xs text-muted"
            title={channel.address}
            translate={false}
          >
            {channel.address}
          </span>
        </div>
        <div class="relative -my-1 shrink-0">
          <Dropdown
            trigger={
              <span class="inline-flex items-center gap-1">
                {statusWord}
                <IconChevronDown class="size-4" aria-hidden="true" />
              </span>
            }
            triggerLabel={t.t(`AdminBlogSharing.statusFor`, { channel: name, status: statusWord })}
            triggerClasses="pc-button pc-button-secondary min-h-11 px-3 text-sm sm:min-h-9"
            triggerDataE2E="blog-share-status"
            horizontal="end"
          >
            {state === `covered`
              ? (
                <DropdownItem
                  disabled={busy}
                  dataE2E="blog-share-too"
                  onClick={() => onChange({ channelIds: ids, status: `todo` })}
                >
                  {t.t(`AdminBlogSharing.shareToo`)}
                </DropdownItem>
              )
              : (
                <>
                  <DropdownItem
                    checked={state === `todo`}
                    disabled={busy}
                    dataE2E="blog-share-todo"
                    onClick={() =>
                      state !== `todo` && onChange({ channelIds: ids, status: `todo` })}
                  >
                    {t.t(`AdminBlogSharing.statusToDo`)}
                  </DropdownItem>
                  <DropdownItem
                    checked={state === `suggested`}
                    disabled={busy}
                    dataE2E="blog-share-suggested"
                    onClick={() =>
                      state !== `suggested` && onChange({ channelIds: ids, status: `suggested` })}
                  >
                    {t.t(`AdminBlogSharing.statusSuggested`)}
                  </DropdownItem>
                  <DropdownItem
                    checked={state === `posted`}
                    disabled={busy}
                    dataE2E="blog-share-posted"
                    onClick={() => state !== `posted` && onDialog({ kind: `link`, row })}
                  >
                    {t.t(`AdminBlogSharing.statusPosted`)}
                  </DropdownItem>
                  <DropdownItem
                    checked={state === `skipped`}
                    disabled={busy}
                    dataE2E="blog-share-skip"
                    onClick={() => state !== `skipped` && onDialog({ kind: `skip`, row })}
                  >
                    {t.t(`AdminBlogSharing.skip`)}
                  </DropdownItem>
                  {share?.status === `posted` && (
                    <>
                      <DropdownItem
                        disabled={busy}
                        dataE2E="blog-share-edit-link"
                        onClick={() => onDialog({ kind: `link`, row })}
                      >
                        {t.t(`AdminBlogSharing.editLink`)}
                      </DropdownItem>
                      <DropdownItem
                        disabled={busy}
                        dataE2E="blog-share-results"
                        onClick={() => onDialog({ kind: `results`, row })}
                      >
                        {t.t(`AdminBlogSharing.enterResults`)}
                      </DropdownItem>
                    </>
                  )}
                </>
              )}
          </Dropdown>
        </div>
      </div>

      <RowFacts row={row} />

      {(state === `todo` || state === `suggested`) && automatic && (
        <AutomaticNote row={row} busy={busy} auto={auto} />
      )}

      {state === `todo` && (
        <>
          {row.text !== null
            ? (
              <div data-e2e="blog-share-text">
                <CopyBlock
                  text={row.text}
                  textLabel={t.t(`AdminBlogSharing.textFor`, { channel: name })}
                  copyLabel={t.t(`AdminBlogSharing.copyText`)}
                  copiedLabel={t.t(`AdminBlogSharing.copied`)}
                  failedLabel={t.t(`AdminBlogSharing.copyFailed`)}
                  copy={copy}
                />
              </div>
            )
            : !automatic && !row.submitUrl && (
              <p class="text-sm text-muted">{t.t(`AdminBlogSharing.noText`)}</p>
            )}
          <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {row.submitUrl && (
              <Button
                href={row.submitUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                title={t.t(`AdminBlogSharing.submitHint`)}
                data-e2e="blog-share-submit"
              >
                {t.t(
                  channel.kind === `reddit`
                    ? `AdminBlogSharing.submitReddit`
                    : `AdminBlogSharing.submitHackernews`,
                )}
              </Button>
            )}
            {open && (
              <Button
                href={open}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="blog-share-open"
              >
                {t.t(`AdminBlogSharing.openChannel`)}
              </Button>
            )}
          </div>
        </>
      )}

      {(state === `todo` || state === `suggested`) && (
        <LinkForm
          row={row}
          label={t.t(state === `todo` ? `AdminBlogSharing.link` : `AdminBlogSharing.itRan`)}
          pending={pending === channel.id}
          disabled={busy}
          error={error}
          onPost={(url) => onChange({ channelIds: ids, status: `posted`, url })}
        />
      )}

      {state === `posted` && share?.status === `posted` && <Results row={row} visits={visits} />}
    </li>
  )
}

/** The line under a handled row's name: when it was posted or suggested, or why it was skipped. */
function RowFacts({ row }: { row: AdminBlogShareRow }): JSX.Element | null {
  const t = useAdminText()
  const format = useFormat()
  const { share, state } = row
  if (state === `covered`) {
    return <p class="text-sm">{t.t(`AdminBlogSharing.covered`)}</p>
  }
  if (!share) return null
  const date = share.sharedAt ? format.date(share.sharedAt) : null
  if (state === `posted`) {
    return (
      <p class="flex flex-wrap gap-x-2 text-sm text-muted">
        {date && (
          <span>
            {t.t(
              share.automatic
                ? `AdminBlogSharing.postedAutomatically`
                : `AdminBlogSharing.postedOn`,
              { date },
            )}
          </span>
        )}
        {share.url && (
          <>
            <span aria-hidden="true">·</span>
            <a
              class="pc-link"
              href={share.url}
              target="_blank"
              rel="noopener noreferrer"
              data-e2e="blog-share-copy-link"
            >
              {t.t(`AdminBlogSharing.openCopy`)}
            </a>
          </>
        )}
      </p>
    )
  }
  if (state === `suggested`) {
    return (
      <p class="text-sm text-muted" title={t.t(`AdminBlogSharing.suggestedHint`)}>
        {date
          ? t.t(`AdminBlogSharing.suggestedOn`, { date })
          : t.t(`AdminBlogSharing.suggestedHint`)}
      </p>
    )
  }
  if (state === `skipped`) {
    return (
      <p class="text-sm text-muted wrap-anywhere">
        {share.skipReason
          ? t.t(`AdminBlogSharing.skippedWith`, { reason: share.skipReason })
          : t.t(`AdminBlogSharing.statusSkipped`)}
      </p>
    )
  }
  return null
}

/** What a row needs to show its automatic post. */
interface AutoPostContext {
  /** The post is a translation, which Dev.to never takes. */
  translation: boolean
  linkedinExpiresAt: string | null
  now: number
  onRetry: (channelId: string) => void
}

/**
 * What an automatic channel does for a post still to do: posting now, posts by itself, waits for
 * its key or a new LinkedIn sign-in, or failed. Any of the last three offers "Try again".
 */
function AutomaticNote(
  { row, busy, auto }: { row: AdminBlogShareRow; busy: boolean; auto: AutoPostContext },
): JSX.Element {
  const t = useAdminText()
  const { channel, share } = row
  const error = share?.error ?? null
  const linkedin = channel.kind === `linkedin` && (
    <LinkedinSignIn expiresAt={auto.linkedinExpiresAt} now={auto.now} />
  )
  if (row.posting) {
    return (
      <div
        role="status"
        class="flex items-center gap-2 text-sm text-muted"
        data-e2e="blog-share-posting"
      >
        <IconSpinner class="size-5 shrink-0 motion-reduce:animate-none" aria-hidden="true" />
        {t.t(`AdminBlogSharing.posting`)}
      </div>
    )
  }
  if (error === null) {
    return (
      <div class="flex flex-col gap-1">
        <p class="text-sm text-muted">{t.t(`AdminBlogSharing.autoHint`)}</p>
        {linkedin}
      </div>
    )
  }
  return (
    <div class="flex flex-col items-start gap-2">
      <AutoPostProblem
        kind={channel.kind}
        error={error}
        keyText="AdminBlogSharing.autoNoKey"
        failedText="AdminBlogSharing.autoFailed"
        dataE2E="blog-share"
      />
      {linkedin}
      <Button
        variant="secondary"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        disabled={busy}
        data-e2e="blog-share-retry"
        onClick={() => auto.onRetry(channel.id)}
      >
        {t.t(`AdminBlogSharing.retry`)}
      </Button>
    </div>
  )
}

/** The link field: paste the copy's address and press Enter, and the row is posted. */
function LinkForm(
  { row, label, pending, disabled, error, onPost }: {
    row: AdminBlogShareRow
    label: string
    pending: boolean
    disabled: boolean
    error: string | null
    onPost: (url: string) => void
  },
): JSX.Element {
  const t = useAdminText()
  const [missing, setMissing] = useState(false)
  const id = `blog-share-link-${row.channel.id}`
  return (
    <ScreenForm
      pending={pending}
      onSubmit={(data) => {
        const url = String(data.get(`url`) ?? ``).trim()
        setMissing(url === ``)
        if (url !== ``) onPost(url)
      }}
    >
      <Field
        id={id}
        label={label}
        hint={t.t(`AdminBlogSharing.linkHint`, { channel: row.channel.name })}
        error={missing ? t.t(`AdminBlogSharing.linkRequired`) : error}
      >
        {(wiring) => (
          <div class="flex flex-col gap-2 sm:flex-row">
            <Input
              id={wiring.id}
              aria-describedby={wiring[`aria-describedby`]}
              aria-invalid={missing || error !== null ? true : undefined}
              name="url"
              type="url"
              inputMode="url"
              autocomplete="off"
              maxLength={BLOG_SHARE_URL_MAX_LENGTH}
              class="min-w-0 font-mono sm:flex-1"
              disabled={disabled}
              data-e2e="blog-share-link"
              onInput={() => setMissing(false)}
            />
            <Button
              type="submit"
              variant="secondary"
              class="min-h-11 w-full shrink-0 sm:min-h-0 sm:w-auto"
              busy={pending}
              disabled={disabled && !pending}
              data-e2e="blog-share-mark-posted"
            >
              {t.t(`AdminBlogSharing.markPosted`)}
            </Button>
          </div>
        )}
      </Field>
    </ScreenForm>
  )
}

/**
 * A posted row's latest numbers, the visits Umami counted, and when they were read; or, when the
 * results job's last read failed, that the numbers shown are older, with the reason.
 */
function Results({ row, visits }: { row: AdminBlogShareRow; visits: AdminBlogVisits }) {
  const t = useAdminText()
  const format = useFormat()
  const { result, channel } = row
  const readError = row.share?.readError ?? null
  const fields = BLOG_RESULT_FIELDS[channel.kind]
  const number = (value: number | null) => value === null ? `–` : format.number(value)
  return (
    <div class="flex flex-col gap-1 text-sm" data-e2e="blog-share-numbers">
      <dl class="flex flex-wrap gap-x-4 gap-y-1">
        {fields.map((field) => (
          <div key={field} class="flex gap-1">
            <dt class="text-muted">{t.t(RESULT_WORDS[field])}</dt>
            <dd class="tabular-nums">{number(result?.[field] ?? null)}</dd>
          </div>
        ))}
        {channel.addUtm && (
          <div
            class="flex gap-1"
            title={visits.setup
              ? t.t(`AdminBlogSharing.visitsHint`, { tag: channel.utmSource })
              : undefined}
          >
            <dt class="text-muted">{t.t(`AdminBlogSharing.visits`)}</dt>
            <dd class="tabular-nums" data-e2e="blog-share-visits">{number(row.visits)}</dd>
          </div>
        )}
      </dl>
      {readError === null
        ? (
          <p class="text-xs text-muted">
            {result
              ? t.t(
                result.source === `hand`
                  ? `AdminBlogSharing.numbersFromHand`
                  : `AdminBlogSharing.numbersFrom`,
                { time: format.date(result.readAt) },
              )
              : t.t(`AdminBlogSharing.noNumbers`)}
          </p>
        )
        : (
          <p class="text-xs text-warning wrap-anywhere" data-e2e="blog-share-read-failed">
            {result
              ? t.t(`AdminBlogSharing.readFailed`, {
                channel: channel.name,
                time: format.date(result.readAt),
              })
              : t.t(`AdminBlogSharing.readFailedNone`, { channel: channel.name })}{" "}
            <span class="text-muted">{readError}</span>
          </p>
        )}
      {channel.addUtm && !visits.setup && (
        <p class="text-xs text-muted" data-e2e="blog-share-umami-off">
          <Rich
            parts={t.parts(`AdminBlogSharing.umamiOff`, { keys: visits.missing.join(`, `) })}
            tags={{ keys: literal }}
          />
        </p>
      )}
    </div>
  )
}

/** Asks for an optional reason before a channel is skipped for the post. */
function SkipDialog(
  { row, onCancel, onSkip }: {
    row: AdminBlogShareRow
    onCancel: () => void
    onSkip: (reason: string | null) => void
  },
): JSX.Element {
  const t = useAdminText()
  const [reason, setReason] = useState(``)
  const presets = [
    `AdminBlogSharing.presetNotFit`,
    `AdminBlogSharing.presetLanguage`,
    `AdminBlogSharing.presetLater`,
  ].map((key) => t.t(key))
  return (
    <Modal
      open
      onClose={onCancel}
      title={t.t(`AdminBlogSharing.skipTitle`, { channel: row.channel.name })}
      cancelLabel={t.t(`AdminBlogSharing.cancel`)}
      dataE2E="blog-share-skip-dialog"
    >
      <ScreenForm onSubmit={() => onSkip(reason.trim() || null)}>
        <Stack>
          <Field
            id="blog-share-skip-reason"
            label={t.t(`AdminBlogSharing.reason`)}
            hint={t.t(`AdminBlogSharing.reasonHint`)}
          >
            <Input
              name="reason"
              autocomplete="off"
              maxLength={BLOG_SHARE_SKIP_REASON_MAX_LENGTH}
              autofocus
              value={reason}
              data-e2e="blog-share-skip-reason"
              onInput={(event) => setReason(event.currentTarget.value)}
            />
          </Field>
          <div class="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                class="min-h-11 sm:min-h-9"
                onClick={() => setReason(preset)}
              >
                {preset}
              </Button>
            ))}
          </div>
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t.t(`AdminBlogSharing.cancel`)}
            </Button>
            <Button type="submit" data-e2e="blog-share-skip-confirm">
              {t.t(`AdminBlogSharing.skipConfirm`)}
            </Button>
          </DialogActions>
        </Stack>
      </ScreenForm>
    </Modal>
  )
}

/** Marks a row posted with its copy's link, or changes the link of a posted row. */
function LinkDialog(
  { row, onCancel, onSave }: {
    row: AdminBlogShareRow
    onCancel: () => void
    onSave: (url: string | null) => void
  },
): JSX.Element {
  const t = useAdminText()
  const [url, setUrl] = useState(row.share?.url ?? ``)
  return (
    <Modal
      open
      onClose={onCancel}
      title={row.channel.name}
      cancelLabel={t.t(`AdminBlogSharing.cancel`)}
      dataE2E="blog-share-link-dialog"
    >
      <ScreenForm onSubmit={() => onSave(url.trim() || null)}>
        <Stack>
          <Field
            id="blog-share-link-edit"
            label={t.t(`AdminBlogSharing.link`)}
            hint={t.t(`AdminBlogSharing.linkHint`, { channel: row.channel.name })}
          >
            <Input
              name="url"
              type="url"
              inputMode="url"
              autocomplete="off"
              class="font-mono"
              maxLength={BLOG_SHARE_URL_MAX_LENGTH}
              autofocus
              value={url}
              data-e2e="blog-share-link-edit"
              onInput={(event) => setUrl(event.currentTarget.value)}
            />
          </Field>
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t.t(`AdminBlogSharing.cancel`)}
            </Button>
            <Button type="submit" data-e2e="blog-share-link-save">
              {t.t(`AdminBlogSharing.markPosted`)}
            </Button>
          </DialogActions>
        </Stack>
      </ScreenForm>
    </Modal>
  )
}

/** Asks for the numbers a channel shows today, only the ones its type has. */
function ResultsDialog(
  { row, pending, error, onCancel, onSave, onSaved }: {
    row: AdminBlogShareRow
    pending: boolean
    error: string | null
    onCancel: () => void
    onSave: (counts: BlogShareResultsRequest) => void
    onSaved: () => void
  },
): JSX.Element {
  const t = useAdminText()
  const fields = BLOG_RESULT_FIELDS[row.channel.kind]
  const [problem, setProblem] = useState<string | null>(null)
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current && !pending && error === null) onSaved()
  }, [pending, error])
  return (
    <Modal
      open
      onClose={onCancel}
      title={t.t(`AdminBlogSharing.resultsTitle`, { channel: row.channel.name })}
      cancelLabel={t.t(`AdminBlogSharing.cancel`)}
      dataE2E="blog-share-results-dialog"
    >
      <ScreenForm
        pending={pending}
        onSubmit={(data) => {
          const counts: BlogShareResultsRequest = {
            views: null,
            reactions: null,
            comments: null,
            score: null,
          }
          for (const field of fields) {
            const text = String(data.get(field) ?? ``).trim()
            if (text === ``) continue
            const value = Number(text)
            if (!Number.isInteger(value) || value < 0) {
              setProblem(t.t(`AdminBlogSharing.resultsWhole`))
              return
            }
            counts[field] = value
          }
          if (Object.values(counts).every((value) => value === null)) {
            setProblem(t.t(`AdminBlogSharing.resultsOne`))
            return
          }
          setProblem(null)
          sent.current = true
          onSave(counts)
        }}
      >
        <Stack>
          <p class="text-sm text-muted">
            {t.t(`AdminBlogSharing.resultsText`, { channel: row.channel.name })}
          </p>
          <div class="grid grid-cols-2 gap-3">
            {fields.map((field, index) => (
              <Field key={field} id={`blog-share-result-${field}`} label={t.t(RESULT_WORDS[field])}>
                <Input
                  name={field}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  autofocus={index === 0}
                  defaultValue={row.result?.[field]?.toString() ?? ``}
                  data-e2e={`blog-share-result-${field}`}
                />
              </Field>
            ))}
          </div>
          <ErrorState message={problem ?? error} />
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t.t(`AdminBlogSharing.cancel`)}
            </Button>
            <Button type="submit" busy={pending} data-e2e="blog-share-results-save">
              {t.t(`AdminBlogSharing.resultsSave`)}
            </Button>
          </DialogActions>
        </Stack>
      </ScreenForm>
    </Modal>
  )
}
