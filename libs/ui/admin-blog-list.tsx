import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconPencilSquare, IconPlus } from "@spy4x/preact-icons"
import { Badge, type BadgeColor, type BadgeType } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { useFormat, When } from "@spy4x/preact-ui/format"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
import {
  type AdminBlogListResponse,
  type AdminBlogPostRow,
  BLOG_SEARCH_MAX_LENGTH,
  type BlogPostStatus,
} from "@domain/blog"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

/** The blog module's pages in the admin app. */
export const ADMIN_BLOG_PATHS = {
  list: `/blog`,
  create: `/blog/new`,
  post: (id: string) => `/blog/${encodeURIComponent(id)}`,
} as const

/** What the list shows: one status or every post, and the search text (title or slug). */
export interface AdminBlogFilter {
  status: BlogPostStatus | null
  query: string
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

/** Each chip: its word alone, and with the count once the list has loaded. */
const STATUS_CHIPS: { value: BlogPostStatus | `all`; label: string; counted: string }[] = [
  { value: `all`, label: `AdminBlog.all`, counted: `AdminBlog.chipAll` },
  { value: `draft`, label: `AdminBlog.drafts`, counted: `AdminBlog.chipDrafts` },
  { value: `scheduled`, label: `AdminBlog.scheduledChip`, counted: `AdminBlog.chipScheduled` },
  { value: `published`, label: `AdminBlog.publishedChip`, counted: `AdminBlog.chipPublished` },
]

export interface AdminBlogListScreenProps {
  /** What the address and the search asked for; the chips and the search form start from it. */
  filter: AdminBlogFilter
  /** The posts and the counts, or `null` while they load or when they failed. */
  list: AdminBlogListResponse | null
  pending: boolean
  /** Set when the list could not be read, or `null`. The screen says so in its own words. */
  error: string | null
  onFilter: (filter: AdminBlogFilter) => void
  onRetry: () => void
  navigate?: Navigate
}

/**
 * The blog's list (#396): every post with its status, topic and dates, filtered by status chips
 * that show their counts and searched by title or slug. "New post" is the page's one action; a
 * title opens the post's editor. On a phone each row stacks its status, topic and date under the
 * title.
 */
export function AdminBlogListScreen(props: AdminBlogListScreenProps): JSX.Element {
  const { filter, list, pending, error, onFilter, navigate } = props
  const t = useAdminText()
  const heading = useRef<HTMLHeadingElement>(null)
  // After a search or a chip the list is new: once it arrives, the reader starts again at its
  // count. The first list is no change, so focus stays where it was.
  const asked = useRef(false)
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (pending) return
    setSearching(false)
    if (asked.current && list !== null) heading.current?.focus()
    asked.current = false
  }, [pending, list])
  const change = (next: AdminBlogFilter) => {
    asked.current = true
    onFilter(next)
  }
  const filtered = filter.query !== `` || filter.status !== null
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
      />
      {none
        ? (
          <Card data-e2e="admin-blog-none">
            <EmptyState
              inset
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
            <ScreenForm
              pending={pending}
              onSubmit={(data) => {
                setSearching(true)
                change({ ...filter, query: String(data.get(`q`) ?? ``).trim() })
              }}
            >
              {/* Keyed by the query, so a cleared filter empties the field too. */}
              <div key={filter.query} class="flex flex-wrap items-end gap-3" role="search">
                <div class="min-w-0 flex-1 basis-60 sm:max-w-md">
                  <Field id="admin-blog-q" label={t.t(`AdminBlog.search`)}>
                    <Input
                      name="q"
                      type="search"
                      data-e2e="admin-blog-search"
                      defaultValue={filter.query}
                      maxLength={BLOG_SEARCH_MAX_LENGTH}
                      autocomplete="off"
                    />
                  </Field>
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  data-e2e="admin-blog-submit"
                  busy={pending && searching}
                  busyLabel={t.t(`AdminBlog.searching`)}
                >
                  {t.t(`AdminBlog.submit`)}
                </Button>
              </div>
            </ScreenForm>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
              {/* One row that scrolls sideways on a phone rather than wrapping. */}
              <div
                class="-mx-4 flex max-w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:flex-wrap sm:px-0"
                data-e2e="admin-blog-status"
              >
                <ToggleChips
                  mode="single"
                  label={t.t(`AdminBlog.status`)}
                  class="flex-nowrap sm:flex-wrap"
                  options={STATUS_CHIPS.map((chip) => ({
                    value: chip.value,
                    label: list
                      ? t.t(chip.counted, { count: list.counts[chip.value] })
                      : t.t(chip.label),
                  }))}
                  value={filter.status ?? `all`}
                  onChange={(value) =>
                    change({
                      ...filter,
                      status: value === null || value === `all` ? null : value as BlogPostStatus,
                    })}
                />
              </div>
            </div>

            {error && (
              <div class="flex flex-col items-center gap-3" data-e2e="admin-blog-error">
                <ErrorState message={t.t(`AdminBlog.listError`)} />
                <Button variant="secondary" onClick={props.onRetry}>
                  {t.t(`AdminBlog.retry`)}
                </Button>
              </div>
            )}

            {(list !== null || !error) && (
              <h2
                ref={heading}
                tabIndex={-1}
                class="text-sm text-muted"
                data-e2e="admin-blog-count"
              >
                {list
                  ? t.t(`AdminBlog.count`, { count: list.posts.length })
                  : t.t(`AdminBlog.loading`)}
              </h2>
            )}
            {list === null
              ? !error && (
                <div role="status" aria-label={t.t(`AdminBlog.loading`)}>
                  <LoadingSkeleton rows={5} />
                </div>
              )
              : (
                <div data-e2e="admin-blog-list">
                  <DataTable
                    mode="server"
                    class={TABLE_CLASS}
                    columns={postColumns(t, navigate)}
                    rows={list.posts.map((post) => ({ post }))}
                    caption={t.t(`AdminBlog.posts`)}
                    captionHidden
                    rowKey={(row) => row.post.id}
                    sort={NO_SORT}
                    onSortChange={() => {}}
                    empty={
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
                    }
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

function postColumns(
  t: Translator<string>,
  navigate?: Navigate,
): DataTableColumn<PostRow, `post`>[] {
  return [
    {
      id: `title`,
      header: t.t(`AdminBlog.colTitle`),
      render: ({ post }) => <TitleCell post={post} navigate={navigate} />,
    },
    {
      id: `status`,
      header: t.t(`AdminBlog.status`),
      render: ({ post }) => <BlogStatusBadge status={post.status} />,
    },
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
function TitleCell({ post, navigate }: { post: AdminBlogPostRow; navigate?: Navigate }) {
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
        {/* deno-lint-ignore ui-text/no-literal */}
        {`/blog/${post.slug}`}
      </span>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
        <BlogStatusBadge status={post.status} />
        {post.topic && <span class="text-sm wrap-anywhere" translate={false}>{post.topic}</span>}
        <PublishedCell post={post} />
      </div>
    </div>
  )
}
