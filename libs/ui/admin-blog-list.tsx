import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { IconPencilSquare, IconPlus } from "@spy4x/preact-icons"
import { Badge, type BadgeColor, type BadgeType } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { FilterBar } from "@spy4x/preact-ui/filter-bar"
import { useFormat, When } from "@spy4x/preact-ui/format"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import {
  type AdminBlogListResponse,
  type AdminBlogPostRow,
  type AdminBlogSharingSummary,
  blogPostPath,
  type BlogPostStatus,
} from "@domain/blog"
import { ADMIN_SEARCH_DELAY } from "./admin-frame.tsx"
import type { Navigate } from "./progressive.tsx"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

/** The blog module's pages in the admin app. */
export const ADMIN_BLOG_PATHS = {
  list: `/blog`,
  create: `/blog/new`,
  post: (id: string) => `/blog/${encodeURIComponent(id)}`,
  channels: `/blog/channels`,
} as const

/**
 * What the list shows: one status or every post, and the search text (title or slug). `sharing`
 * keeps the live posts that still list a channel as to do; it takes the status filter's place.
 */
export interface AdminBlogFilter {
  status: BlogPostStatus | null
  query: string
  sharing?: boolean
}

export const ADMIN_BLOG_NO_FILTER: AdminBlogFilter = { status: null, query: `` }

/** Each status's badge (its word as a catalog key), the same in the list and in the editor's header. */
const BLOG_STATUS_BADGES: Record<
  BlogPostStatus,
  { key: string; color: BadgeColor; type: BadgeType }
> = {
  draft: { key: `AdminBlog.draft`, color: `gray`, type: `filled` },
  scheduled: { key: `AdminBlog.scheduled`, color: `blue`, type: `outline` },
  published: { key: `AdminBlog.published`, color: `green`, type: `filled` },
}

/** A post's status as its badge. */
export function BlogStatusBadge({ status }: { status: BlogPostStatus }): JSX.Element {
  const t = useAdminText()
  const badge = BLOG_STATUS_BADGES[status]
  return <Badge text={t.t(badge.key)} color={badge.color} type={badge.type} />
}

/** Each choice of the Status menu, its word as a catalog key; the menu adds its count. */
const STATUS_OPTIONS: { value: BlogPostStatus; label: string }[] = [
  { value: `draft`, label: `AdminBlog.drafts` },
  { value: `scheduled`, label: `AdminBlog.scheduledChip` },
  { value: `published`, label: `AdminBlog.publishedChip` },
]

export interface AdminBlogListScreenProps {
  /** What the address and the search asked for; the filter bar starts from it. */
  filter: AdminBlogFilter
  /** The posts and the counts, or `null` while they load or when they failed. */
  list: AdminBlogListResponse | null
  pending: boolean
  /** Set when the list could not be read, or `null`. The screen says so in its own words. */
  error: string | null
  /** `replace` is set while the operator types, so the address changes without a history entry. */
  onFilter: (filter: AdminBlogFilter, replace?: boolean) => void
  onRetry: () => void
  navigate?: Navigate
}

/**
 * The blog's list: every post with its status, topic and dates, in a `FilterBar` that searches
 * by title or slug as you type, filters by status with each one's count, and toggles the live
 * posts that still need sharing. "New post" is the page's one action; a
 * title opens the post's editor. On a phone each row stacks its status, topic and date under the
 * title.
 */
export function AdminBlogListScreen(props: AdminBlogListScreenProps): JSX.Element {
  const { filter, list, pending, error, onFilter, navigate } = props
  const t = useAdminText()
  const heading = useRef<HTMLDivElement>(null)
  // The empty state's Clear goes away with the filter it clears: once the new list arrives, the
  // reader starts again at the list. The filter bar's controls stay, so focus stays in them, and
  // the bar announces the new count.
  const asked = useRef(false)
  useEffect(() => {
    if (pending) return
    if (asked.current && list !== null) heading.current?.focus()
    asked.current = false
  }, [pending, list])
  const change = (next: AdminBlogFilter) => {
    asked.current = true
    onFilter(next)
  }
  const filtered = filter.query !== `` || filter.status !== null || filter.sharing === true
  // Sharing shows once a channel exists: before that there is nothing to share a post on.
  const sharing = list?.sharing && list.sharing.activeChannels > 0 ? list.sharing : null
  // No post at all: the counts follow the search, so only an empty search says so.
  const none = list !== null && list.counts.all === 0 && filter.query === ``
  const newPost = (
    <PageAction
      label={t.t(`AdminBlog.newPost`)}
      Icon={IconPlus}
      href={ADMIN_BLOG_PATHS.create}
      navigate={navigate}
      dataE2E="admin-blog-new"
    />
  )

  return (
    <Stack>
      <PageHeader
        title={t.t(`AdminBlog.title`)}
        subtitle={t.t(`AdminBlog.subtitle`)}
        titleDataE2E="admin-blog-title"
        action={newPost}
        menuDataE2E="admin-blog-list-menu"
        menu={
          <DropdownItem
            href={ADMIN_BLOG_PATHS.channels}
            navigate={navigate}
            dataE2E="admin-blog-channels"
          >
            {t.t(`AdminBlog.channels`)}
          </DropdownItem>
        }
      />
      {none
        ? (
          <Card data-e2e="admin-blog-none">
            <EmptyState
              inset
              headingLevel={2}
              icon={<IconPencilSquare class="size-8" aria-hidden="true" />}
              title={t.t(`AdminBlog.noPosts`)}
              description={t.t(`AdminBlog.noPostsHint`)}
              action={
                <Button href={ADMIN_BLOG_PATHS.create} navigate={navigate}>
                  {t.t(`AdminBlog.newPost`)}
                </Button>
              }
            />
          </Card>
        )
        : (
          <>
            <div data-e2e="admin-blog-filters">
              <FilterBar
                search={{
                  value: filter.query,
                  label: t.t(`AdminBlog.search`),
                  delay: ADMIN_SEARCH_DELAY,
                  onChange: (query) => onFilter({ ...filter, query: query.trim() }, true),
                }}
                filters={[{
                  id: `status`,
                  label: t.t(`AdminBlog.status`),
                  options: STATUS_OPTIONS.map((option) => ({
                    value: option.value,
                    label: t.t(option.label),
                    ...(list ? { count: list.counts[option.value] } : {}),
                  })),
                  value: filter.status,
                  // A status and the sharing filter are one choice in the address: either drops the other.
                  onChange: (value) =>
                    onFilter({
                      ...filter,
                      sharing: undefined,
                      status: value as BlogPostStatus | null,
                    }),
                }]}
                toggles={sharing || filter.sharing
                  ? [{
                    id: `sharing`,
                    label: sharing
                      ? t.t(`AdminBlog.chipNeedsSharing`, { count: sharing.needsSharing })
                      : t.t(`AdminBlog.needsSharing`),
                    pressed: filter.sharing === true,
                    onChange: (pressed) =>
                      onFilter({ ...filter, status: null, sharing: pressed ? true : undefined }),
                  }]
                  : []}
                onClear={() => onFilter({ ...ADMIN_BLOG_NO_FILTER, query: filter.query })}
                clearLabel={t.t(`AdminBlog.clear`)}
                count={list
                  ? (
                    <span data-e2e="admin-blog-count">
                      {t.t(`AdminBlog.count`, { count: list.posts.length })}
                    </span>
                  )
                  : undefined}
              />
            </div>

            {error && (
              <div class="flex flex-col items-center gap-3" data-e2e="admin-blog-error">
                <ErrorState message={t.t(`AdminBlog.listError`)} />
                <Button variant="secondary" onClick={props.onRetry}>
                  {t.t(`AdminBlog.retry`)}
                </Button>
              </div>
            )}

            {list === null
              ? !error && (
                <div role="status" aria-label={t.t(`AdminBlog.loading`)}>
                  <LoadingSkeleton rows={5} />
                </div>
              )
              : (
                <div
                  ref={heading}
                  tabIndex={-1}
                  aria-label={t.t(`AdminBlog.posts`)}
                  aria-busy={pending}
                  class="rounded-xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
                  data-e2e="admin-blog-list"
                >
                  <DataTable
                    mode="server"
                    class={TABLE_CLASS}
                    columns={postColumns(t, sharing, navigate)}
                    rows={list.posts.map((post) => ({ post }))}
                    caption={t.t(`AdminBlog.posts`)}
                    captionHidden
                    rowKey={(row) => row.post.id}
                    sort={NO_SORT}
                    onSortChange={() => {}}
                    empty={filter.sharing && filter.query === ``
                      ? (
                        <EmptyState
                          inset
                          title={t.t(`AdminBlog.allShared`)}
                          description={t.t(`AdminBlog.allSharedHint`)}
                          action={
                            <Button
                              variant="ghost"
                              data-e2e="admin-blog-clear"
                              onClick={() => change(ADMIN_BLOG_NO_FILTER)}
                            >
                              {t.t(`AdminBlog.showAll`)}
                            </Button>
                          }
                        />
                      )
                      : (
                        <EmptyState
                          inset
                          title={t.t(`AdminBlog.noMatch`)}
                          description={t.t(`AdminBlog.noMatchHint`)}
                          action={filtered && (
                            <Button
                              variant="ghost"
                              data-e2e="admin-blog-clear"
                              onClick={() => change(ADMIN_BLOG_NO_FILTER)}
                            >
                              {t.t(`AdminBlog.clear`)}
                            </Button>
                          )}
                        />
                      )}
                  />
                </div>
              )}
          </>
        )}
    </Stack>
  )
}

/**
 * The table's layout on top of preact-ui's `DataTable`, as the billing list does: rows fit their
 * content, and below 640px the status, topic and dates columns go, because the title cell then
 * shows them under the title.
 */
const TABLE_CLASS = [
  `[&>div:first-child]:min-h-0`,
  `[&_:is(th,td)]:px-4`,
  `max-sm:[&_:is(th,td)]:px-3`,
  `max-sm:[&_td]:whitespace-normal`,
  `max-sm:[&_:is(th,td):not(:first-child)]:hidden`,
].join(` `)

/** The server keeps one order, most recently changed first, so no column sorts. */
const NO_SORT: [] = []

interface PostRow {
  post: AdminBlogPostRow
}

/** "Goes live" with the time for a scheduled post, the first publish date otherwise. */
function PublishedCell({ post }: { post: AdminBlogPostRow }): JSX.Element {
  // A phone's row wraps the date with the rest of its line; the table's column keeps it on one.
  const format = useFormat()
  const t = useAdminText()
  if (post.status === `scheduled` && post.publishAt) {
    return (
      <span class="text-sm sm:whitespace-nowrap">
        {t.t(`AdminBlog.goesLive`, { date: format.dateTime(post.publishAt) })}
      </span>
    )
  }
  if (post.publishedAt) {
    return <span class="text-sm sm:whitespace-nowrap">{format.date(post.publishedAt)}</span>
  }
  return <span class="text-sm text-muted">{t.t(`AdminBlog.notYet`)}</span>
}

/**
 * A post's sharing: how many channels still list it as to do, as a link to its checklist, "Done"
 * for a live post with none left, and a dash for a post that is not live.
 */
function SharingCell(
  { post, sharing, navigate }: {
    post: AdminBlogPostRow
    sharing: AdminBlogSharingSummary
    navigate?: Navigate
  },
): JSX.Element {
  const t = useAdminText()
  const toDo = sharing.toDo[post.id] ?? 0
  if (post.status !== `published`) {
    return <span class="text-sm text-muted">{t.t(`AdminBlog.sharingNone`)}</span>
  }
  if (toDo === 0) return <span class="text-sm text-muted">{t.t(`AdminBlog.sharingDone`)}</span>
  return (
    <Link
      href={ADMIN_BLOG_SHARING_PATH(post.id)}
      navigate={navigate}
      class="pc-link whitespace-nowrap text-sm font-medium"
      data-e2e="admin-blog-sharing"
    >
      {t.t(`AdminBlog.sharingToDo`, { count: toDo })}
    </Link>
  )
}

/** A post's sharing checklist. */
const ADMIN_BLOG_SHARING_PATH = (id: string) => `${ADMIN_BLOG_PATHS.post(id)}/sharing`

function postColumns(
  t: Translator<string>,
  sharing: AdminBlogSharingSummary | null,
  navigate?: Navigate,
): DataTableColumn<PostRow, `post`>[] {
  return [
    {
      id: `title`,
      header: t.t(`AdminBlog.colTitle`),
      render: ({ post }) => <TitleCell post={post} sharing={sharing} navigate={navigate} />,
    },
    {
      id: `status`,
      header: t.t(`AdminBlog.status`),
      render: ({ post }) => <BlogStatusBadge status={post.status} />,
    },
    ...(sharing
      ? [{
        id: `sharing`,
        header: t.t(`AdminBlog.colSharing`),
        render: ({ post }: PostRow) => (
          <SharingCell post={post} sharing={sharing} navigate={navigate} />
        ),
      }]
      : []),
    {
      id: `topic`,
      header: t.t(`AdminBlog.colTopic`),
      render: ({ post }) =>
        post.topic
          ? (
            <span class="block max-w-40 truncate text-sm" title={post.topic} translate={false}>
              {post.topic}
            </span>
          )
          : <span class="text-sm text-muted">{t.t(`AdminBlog.none`)}</span>,
    },
    {
      id: `published`,
      header: t.t(`AdminBlog.colPublished`),
      render: ({ post }) => <PublishedCell post={post} />,
    },
    {
      id: `updated`,
      header: t.t(`AdminBlog.colUpdated`),
      render: ({ post }) => (
        <span class="whitespace-nowrap text-sm">
          <When at={post.updatedAt} />
        </span>
      ),
    },
  ]
}

/**
 * The title column: the title as the link to the editor, the address under it, and on a phone the
 * status, topic and publish date under that.
 */
function TitleCell(
  { post, sharing, navigate }: {
    post: AdminBlogPostRow
    sharing: AdminBlogSharingSummary | null
    navigate?: Navigate
  },
) {
  return (
    <div class="flex min-w-48 max-w-md flex-col gap-1 max-sm:min-w-0">
      <Link
        href={ADMIN_BLOG_PATHS.post(post.id)}
        navigate={navigate}
        class="pc-link line-clamp-2 font-medium wrap-anywhere"
        translate={false}
        data-e2e="admin-blog-row"
      >
        {post.title}
      </Link>
      {/* A path, no language changes it. The rule knows only translate="no", which Preact cannot set. */}
      <span class="font-mono text-xs text-muted max-sm:break-all sm:truncate" translate={false}>
        {blogPostPath(post)}
      </span>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
        <BlogStatusBadge status={post.status} />
        {post.topic && <span class="text-sm wrap-anywhere" translate={false}>{post.topic}</span>}
        <PublishedCell post={post} />
        {sharing && (sharing.toDo[post.id] ?? 0) > 0 && (
          <SharingCell post={post} sharing={sharing} navigate={navigate} />
        )}
      </div>
    </div>
  )
}
