import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
import { FREE_PLAN_ID } from "@domain/billing"
import {
  ADMIN_GROUP_DEFAULT_SORT,
  ADMIN_GROUP_SEARCH_MAX_LENGTH,
  type AdminGroupFilter,
  type AdminGroupListResponse,
  type AdminGroupPerson,
  type AdminGroupRow,
  type AdminGroupSortKey,
  type AdminGroupStatusFilter,
  GroupRole,
} from "@domain/groups"
import { GroupMark } from "./group-appearance.tsx"
import { nextSort } from "./admin-users-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { OnDay, When } from "@spy4x/preact-ui/format"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

/** The groups module's pages in the admin app. */
export const ADMIN_GROUP_PATHS = {
  list: `/groups`,
  group: (id: string) => `/groups/${encodeURIComponent(id)}`,
} as const

const STATUS_CHIPS: { value: Exclude<AdminGroupStatusFilter, "any">; label: string }[] = [
  { value: `active`, label: `AdminGroups.active` },
  { value: `deleted`, label: `AdminGroups.inTrash` },
]

/**
 * The table's layout on top of preact-ui's `DataTable`, which takes no class per column:
 *
 * - The library's table box keeps 300px of height even under a single row; here it fits its rows.
 * - Cells are padded 1rem on each side instead of 1.5rem, so all seven columns fit at 1280px,
 *   and 0.75rem on a phone.
 * - On narrower screens the low-value columns go, by position, so the rest fit without scrolling:
 *   below 1280px the note count, the plan and the creation date; below 640px also the last
 *   activity and the owner, which leaves the group and its member count. On a phone the group's
 *   cell names the owner instead, in full: a touch screen cannot open a tooltip.
 *
 * Positions follow `groupColumns`: 2 owner, 4 notes, 5 plan, 6 last activity, 7 created.
 */
const TABLE_CLASS = [
  `[&>div:first-child]:min-h-0`,
  `[&_:is(th,td)]:px-4`,
  `max-sm:[&_:is(th,td)]:px-3`,
  `max-xl:[&_:is(th,td):nth-child(4)]:hidden`,
  `max-xl:[&_:is(th,td):nth-child(5)]:hidden`,
  `max-xl:[&_:is(th,td):nth-child(7)]:hidden`,
  `max-sm:[&_:is(th,td):nth-child(2)]:hidden`,
  `max-sm:[&_:is(th,td):nth-child(n+4)]:hidden`,
].join(` `)

const NUMBER = new Intl.NumberFormat(`en`)

/** A group role as a person reads it, in the operator's language: `Owner`. */
export function groupRoleLabel(t: Translator<string>, role: GroupRole): string {
  switch (role) {
    case GroupRole.OWNER:
      return t.t(`AdminGroups.roleOwner`)
    case GroupRole.ADMIN:
      return t.t(`AdminGroups.roleAdmin`)
    case GroupRole.EDITOR:
      return t.t(`AdminGroups.roleEditor`)
    case GroupRole.VIEWER:
      return t.t(`AdminGroups.roleViewer`)
    default:
      return t.t(`AdminGroups.roleMember`)
  }
}

/** A person's name for a list: their full name, or their address before they set one. */
export function adminGroupPersonName(
  t: Translator<string>,
  person: Pick<AdminGroupPerson, "name" | "email">,
): string {
  return person.name || person.email || t.t(`AdminGroups.noName`)
}

/** A plan's name as a person reads it: `Free` in the operator's language, `Pro` as named. */
export function planLabel(t: Translator<string>, planId: string): string {
  return planId === FREE_PLAN_ID
    ? t.t(`AdminGroups.free`)
    : planId[0].toUpperCase() + planId.slice(1)
}

/** One row of the table: the group, under the keys the server sorts by. */
interface GroupTableRow {
  name: string
  memberCount: number
  lastActivityAt: string | null
  createdAt: string
  group: AdminGroupRow
}

export interface AdminGroupsListScreenProps {
  /** What the address asked for; the search form and the chips start from it. */
  filter: AdminGroupFilter
  /** The page of groups, or `null` while it loads. */
  list: AdminGroupListResponse | null
  pending: boolean
  /** Why the list could not be read, or `null`. */
  error: string | null
  /** The operator searched, sorted or changed a filter: the app reads page 1 of that. */
  onSearch: (filter: AdminGroupFilter) => void
  onPage: (page: number) => void
  navigate?: Navigate
}

/**
 * The groups page (#426): every group, in a table the server sorts and pages, with a search by
 * the group's name or its owner and chips for active groups and groups in the trash. Each name
 * opens the group. Counts only: nothing written inside a group shows here.
 */
export function AdminGroupsListScreen(
  { filter, list, pending, error, onSearch, onPage, navigate }: AdminGroupsListScreenProps,
): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null)
  const t = useAdminText()

  // After a page change the list is new: the reader starts again at its heading.
  const page = list?.page
  const shown = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (page === undefined) return
    if (shown.current !== undefined && shown.current !== page) heading.current?.focus()
    shown.current = page
  }, [page])

  const rows: GroupTableRow[] = (list?.groups ?? []).map((group) => ({
    name: group.name,
    memberCount: group.memberCount,
    lastActivityAt: group.lastActivityAt,
    createdAt: group.createdAt,
    group,
  }))
  const filtered = filter.query !== `` || filter.status !== `any`

  return (
    <Stack>
      <PageHeader
        title={t.t(`AdminGroups.title`)}
        subtitle={t.t(`AdminGroups.subtitle`)}
        titleDataE2E="admin-groups-title"
      />
      <div class="flex flex-col gap-4 rounded-xl border border-subtle bg-surface p-4">
        <ScreenForm
          pending={pending}
          onSubmit={(data) =>
            onSearch({ ...filter, query: String(data.get(`q`) ?? ``).trim(), page: 1 })}
        >
          {/* Keyed by the query, so going back in history shows the search that page had. */}
          <div key={filter.query} class="flex flex-wrap items-end gap-3" role="search">
            <div class="min-w-0 flex-1 basis-60 sm:max-w-md">
              <Field id="admin-groups-q" label={t.t(`AdminGroups.search`)}>
                <Input
                  name="q"
                  type="search"
                  data-e2e="admin-groups-search"
                  defaultValue={filter.query}
                  maxLength={ADMIN_GROUP_SEARCH_MAX_LENGTH}
                  autocomplete="off"
                />
              </Field>
            </div>
            <Button
              type="submit"
              data-e2e="admin-groups-submit"
              busy={pending}
              busyLabel={t.t(`AdminGroups.searching`)}
            >
              {t.t(`AdminGroups.submit`)}
            </Button>
          </div>
        </ScreenForm>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div class="flex flex-wrap items-center gap-2" data-e2e="admin-groups-status">
            <span class="text-sm text-muted" aria-hidden="true">{t.t(`AdminGroups.status`)}</span>
            <ToggleChips
              mode="single"
              label={t.t(`AdminGroups.status`)}
              options={STATUS_CHIPS.map((chip) => ({ ...chip, label: t.t(chip.label) }))}
              value={filter.status === `any` ? null : filter.status}
              onChange={(value) =>
                onSearch({
                  ...filter,
                  status: (value ?? `any`) as AdminGroupStatusFilter,
                  page: 1,
                })}
            />
          </div>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              data-e2e="admin-groups-clear"
              onClick={() => onSearch({ ...filter, query: ``, status: `any`, page: 1 })}
            >
              {t.t(`AdminGroups.clear`)}
            </Button>
          )}
        </div>
      </div>

      <ErrorState message={error} />

      <h2 ref={heading} tabIndex={-1} class="text-sm text-muted" data-e2e="admin-groups-count">
        {list ? t.t(`AdminGroups.count`, { count: list.total }) : t.t(`AdminGroups.loading`)}
      </h2>
      {list === null
        ? !error && (
          <div role="status" aria-label={t.t(`AdminGroups.loading`)}>
            <LoadingSkeleton rows={5} />
          </div>
        )
        : (
          <div data-e2e="admin-groups-list">
            <DataTable
              mode="server"
              class={TABLE_CLASS}
              columns={groupColumns(t, navigate)}
              rows={rows}
              sort={filter.sort}
              onSortChange={(sort) =>
                onSearch({
                  ...filter,
                  sort: nextSort<AdminGroupSortKey>(filter.sort, sort, ADMIN_GROUP_DEFAULT_SORT),
                  page: 1,
                })}
              caption={t.t(`AdminGroups.title`)}
              captionHidden
              rowKey={(row) => row.group.id}
              empty={
                <EmptyState
                  inset
                  title={t.t(`AdminGroups.noMatch`)}
                  description={t.t(filtered ? `AdminGroups.noMatchHint` : `AdminGroups.noneYet`)}
                />
              }
              paging={{
                page: list.page,
                pageSize: list.pageSize,
                total: list.total,
                onChange: onPage,
                label: t.t(`AdminGroups.pages`),
              }}
            />
          </div>
        )}
    </Stack>
  )
}

/** The table's columns. The name, member count, last activity and creation sort, on the server. */
function groupColumns(
  t: Translator<string>,
  navigate?: Navigate,
): DataTableColumn<GroupTableRow, AdminGroupSortKey>[] {
  return [
    {
      key: `name`,
      header: t.t(`AdminGroups.group`),
      sortable: true,
      render: ({ group }) => <GroupCell group={group} navigate={navigate} />,
    },
    {
      id: `owner`,
      header: t.t(`AdminGroups.owner`),
      render: ({ group }) => (
        // One line each, cut with an ellipsis at 11rem; the full text stays in the tooltip. A
        // phone hides this column and shows the owner in the group's cell.
        <div class="flex items-center gap-2">
          {/* Decorative: the name beside it already names the owner. */}
          <Avatar name={adminGroupPersonName(t, group.owner)} alt="" size="sm" />
          <div class="flex w-44 min-w-0 flex-col" translate={false}>
            <span
              class="truncate text-sm font-medium"
              title={adminGroupPersonName(t, group.owner)}
              data-e2e="admin-groups-owner"
            >
              {adminGroupPersonName(t, group.owner)}
            </span>
            {group.owner.email && group.owner.name && (
              <span class="truncate text-xs text-muted" title={group.owner.email}>
                {group.owner.email}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: `memberCount`,
      header: t.t(`AdminGroups.members`),
      sortable: true,
      render: ({ memberCount }) => <span class="tabular-nums">{NUMBER.format(memberCount)}</span>,
    },
    {
      id: `notes`,
      header: t.t(`AdminGroups.notes`),
      render: ({ group }) => (
        <span class="tabular-nums text-muted">{NUMBER.format(group.noteCount)}</span>
      ),
    },
    {
      id: `plan`,
      header: t.t(`AdminGroups.plan`),
      render: ({ group }) => (
        <Badge
          text={planLabel(t, group.planId)}
          color={group.planId === FREE_PLAN_ID ? `gray` : `purple`}
          type="outline"
        />
      ),
    },
    {
      key: `lastActivityAt`,
      header: t.t(`AdminGroups.lastActivity`),
      sortable: true,
      render: ({ lastActivityAt }) =>
        lastActivityAt
          ? <When class="whitespace-nowrap text-sm" at={lastActivityAt} />
          : <span class="text-sm text-muted">{t.t(`AdminGroups.none`)}</span>,
    },
    {
      key: `createdAt`,
      header: t.t(`AdminGroups.created`),
      sortable: true,
      render: ({ createdAt }) => (
        <OnDay class="whitespace-nowrap text-sm text-muted" at={createdAt} />
      ),
    },
  ]
}

/**
 * The group column: its mark, its name as the link to its page, and a badge while in the trash.
 * On a phone, which has no owner column, the owner's name and address follow, in full.
 */
function GroupCell(
  { group, navigate }: { group: AdminGroupRow; navigate?: Navigate },
): JSX.Element {
  const t = useAdminText()
  const owner = adminGroupPersonName(t, group.owner)
  return (
    // At least 10rem wide on a wider screen: a long name wraps rather than squeezing into a few
    // letters. A phone has no room to spare, so there the name wraps as narrow as it must.
    <div class="flex min-w-40 items-center gap-3 max-sm:min-w-0 max-sm:items-start max-sm:gap-2">
      <GroupMark color={group.color} emoji={group.emoji} size="sm" />
      <div class="flex min-w-0 flex-col gap-1">
        {/* The badge goes under a long name rather than squeezing it. */}
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={ADMIN_GROUP_PATHS.group(group.id)}
            navigate={navigate}
            class="pc-link font-medium wrap-anywhere"
            translate={false}
            data-e2e={`admin-group-${group.id}`}
          >
            {group.name}
          </Link>
          {group.deletedAt && (
            <span data-e2e="admin-group-deleted">
              <Badge text={t.t(`AdminGroups.inTrash`)} color="red" type="outline" />
            </span>
          )}
        </div>
        <div class="flex flex-col text-xs text-muted sm:hidden" data-e2e="admin-groups-owner-phone">
          <span class="wrap-anywhere">
            <Rich
              parts={t.parts(`AdminGroups.ownerLine`, { name: owner })}
              tags={{
                name: (text) => (
                  <bdi class="font-medium text-foreground" translate={false}>{text}</bdi>
                ),
              }}
            />
          </span>
          {group.owner.email && group.owner.email !== owner && (
            <span class="wrap-anywhere" translate={false}>{group.owner.email}</span>
          )}
        </div>
      </div>
    </div>
  )
}
