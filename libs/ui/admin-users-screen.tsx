import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import type { SortRule } from "@spy4x/platform/universal/sort"
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
import {
  ADMIN_DEFAULT_SORT,
  ADMIN_PICTURE_PATH,
  ADMIN_SEARCH_MAX_LENGTH,
  type AdminAccountFilter,
  type AdminBlockedFilter,
  type AdminUserFilter,
  type AdminUserListResponse,
  type AdminUserRow,
  type AdminUserSortKey,
  pictureUrl,
  USER_ROLE_NAMES,
  UserRole,
} from "@domain/identity"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { OnDay, When } from "@spy4x/preact-ui/format"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

const ROLES = [UserRole.VIEWER, UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.ADMIN]

/** Each role's name, by its catalog key. */
const ROLE_KEYS: Record<UserRole, string> = {
  [UserRole.VIEWER]: `AdminUsers.roleViewer`,
  [UserRole.OPERATOR]: `AdminUsers.roleOperator`,
  [UserRole.SUPERVISOR]: `AdminUsers.roleSupervisor`,
  [UserRole.ADMIN]: `AdminUsers.roleAdmin`,
}

/** A role as a person reads it, in the operator's language: `Operator`. */
export function roleLabel(t: Translator<string>, role: UserRole): string {
  const key = ROLE_KEYS[role]
  return key ? t.t(key) : (USER_ROLE_NAMES[role] ?? String(role))
}

/**
 * A person's name for a list or a heading: their full name, or their address before they set one,
 * or "No name" in the operator's language.
 */
export function adminUserName(
  user: Pick<AdminUserRow, "firstName" | "lastName" | "email">,
  t: Translator<string>,
): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.email || t.t(`AdminUsers.noName`)
}

/**
 * The line under a person's name: their address, or nothing when the name already is the address
 * (a person who set no name), so it is never shown twice.
 */
export function adminUserSubtitle(
  user: Pick<AdminUserRow, "firstName" | "lastName" | "email">,
): string | null {
  const name = `${user.firstName} ${user.lastName}`.trim() || user.email
  return user.email && name !== user.email ? user.email : null
}

/** A role's badge colour: viewers stay quiet, every role above them stands out. */
export function roleColor(role: UserRole): "gray" | "blue" | "purple" {
  if (role === UserRole.VIEWER) return "gray"
  return role === UserRole.ADMIN ? "purple" : "blue"
}

/**
 * The sort after a header press. The table appends a newly pressed column after the rules already
 * there; while the list is in its default order (`defaults`, the people list's newest first unless
 * another list passes its own), that order is no choice of the operator's, so the pressed column
 * replaces it instead of hiding behind it.
 */
export function nextSort<K extends string = AdminUserSortKey>(
  current: SortRule<K>[],
  next: SortRule<K>[],
  defaults: readonly SortRule<K>[] = ADMIN_DEFAULT_SORT as unknown as SortRule<K>[],
): SortRule<K>[] {
  const isDefault = current.length === defaults.length &&
    current.every((rule, index) =>
      rule.key === defaults[index].key &&
      rule.direction === defaults[index].direction
    )
  return isDefault && next.length > current.length ? next.slice(current.length) : next
}

/** One row of the table: the person, under the keys the server sorts by. */
interface UserTableRow {
  name: string
  role: UserRole
  lastSeenAt: string | null
  createdAt: string
  user: AdminUserRow
}

export interface AdminUsersScreenProps {
  /** What the address asked for; the search form and the chips start from it. */
  filter: AdminUserFilter
  /** The page of people, or `null` while it loads. */
  list: AdminUserListResponse | null
  pending: boolean
  /** Why the list could not be read, or `null`. */
  error: string | null
  /** The operator searched, sorted or changed a filter: the app reads page 1 of that. */
  onSearch: (filter: AdminUserFilter) => void
  onPage: (page: number) => void
  /** The signed-in operator's id: their own row says "You". */
  operatorId?: number
  /** Where the filtered list downloads as CSV, every page of it; no button without it. */
  exportHref?: string
  navigate?: Navigate
}

/**
 * The people page (#424): everyone with an account, in a table the server sorts and pages, with a
 * search by name or address and filter chips for status and role. Each name opens the person.
 */
export function AdminUsersScreen(
  { filter, list, pending, error, onSearch, onPage, operatorId, exportHref, navigate }:
    AdminUsersScreenProps,
): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null)
  const t = useAdminText()

  // After a page change the list is new: the reader starts again at its heading. The first page
  // that arrives is no change, so focus stays where it was.
  const page = list?.page
  const shown = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (page === undefined) return
    if (shown.current !== undefined && shown.current !== page) heading.current?.focus()
    shown.current = page
  }, [page])

  const rows: UserTableRow[] = (list?.users ?? []).map((user) => ({
    name: adminUserName(user, t),
    role: user.role,
    lastSeenAt: user.lastSeenAt,
    createdAt: user.createdAt,
    user,
  }))
  const filtered = filter.query !== "" || filter.role !== null || filter.blocked !== "any" ||
    filter.account !== undefined

  return (
    <Stack>
      <PageHeader
        title={t.t(`AdminUsers.title`)}
        subtitle={t.t(`AdminUsers.subtitle`)}
        titleDataE2E="admin-users-title"
        action={exportHref && (
          // A plain download: the server streams every page of the filtered list.
          <Button
            href={exportHref}
            download
            variant="secondary"
            data-e2e="admin-users-export"
          >
            {t.t(`AdminUsers.export`)}
          </Button>
        )}
      />
      <div class="flex flex-col gap-4 rounded-xl border border-subtle bg-surface p-4">
        <ScreenForm
          pending={pending}
          onSubmit={(data) =>
            onSearch({ ...filter, query: String(data.get("q") ?? "").trim(), page: 1 })}
        >
          {/* Keyed by the query, so going back in history shows the search that page had. */}
          <div key={filter.query} class="flex flex-wrap items-end gap-3" role="search">
            <div class="min-w-0 flex-1 basis-60 sm:max-w-md">
              <Field id="admin-users-q" label={t.t(`AdminUsers.search`)}>
                <Input
                  name="q"
                  type="search"
                  data-e2e="admin-users-search"
                  defaultValue={filter.query}
                  maxLength={ADMIN_SEARCH_MAX_LENGTH}
                  autocomplete="off"
                />
              </Field>
            </div>
            <Button
              type="submit"
              data-e2e="admin-users-submit"
              busy={pending}
              busyLabel={t.t(`AdminUsers.searching`)}
            >
              {t.t(`AdminUsers.submit`)}
            </Button>
          </div>
        </ScreenForm>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <FilterChips label={t.t(`AdminUsers.status`)} dataE2E="admin-users-blocked">
            <ToggleChips
              mode="single"
              label={t.t(`AdminUsers.status`)}
              class="flex-nowrap sm:flex-wrap"
              options={[
                { value: `active`, label: t.t(`AdminUsers.active`) },
                { value: `blocked`, label: t.t(`AdminUsers.blocked`) },
              ]}
              value={filter.blocked === "any" ? null : filter.blocked}
              onChange={(value) =>
                onSearch({ ...filter, blocked: (value ?? "any") as AdminBlockedFilter, page: 1 })}
            />
          </FilterChips>
          <FilterChips label={t.t(`AdminUsers.account`)} dataE2E="admin-users-account">
            <ToggleChips
              mode="single"
              label={t.t(`AdminUsers.account`)}
              class="flex-nowrap sm:flex-wrap"
              // Guest accounts (#224), made with one click and no sign-in method, or every other.
              options={[
                { value: `guest`, label: t.t(`AdminUsers.guests`) },
                { value: `full`, label: t.t(`AdminUsers.withSignIn`) },
              ]}
              value={filter.account ?? null}
              onChange={(value) => {
                const { account: _old, ...rest } = filter
                onSearch({
                  ...rest,
                  ...(value ? { account: value as AdminAccountFilter } : {}),
                  page: 1,
                })
              }}
            />
          </FilterChips>
          <FilterChips label={t.t(`AdminUsers.role`)} dataE2E="admin-users-role">
            <ToggleChips
              mode="single"
              label={t.t(`AdminUsers.role`)}
              class="flex-nowrap sm:flex-wrap"
              options={ROLES.map((role) => ({ value: String(role), label: roleLabel(t, role) }))}
              value={filter.role === null ? null : String(filter.role)}
              onChange={(value) =>
                onSearch({
                  ...filter,
                  role: value === null ? null : Number(value) as UserRole,
                  page: 1,
                })}
            />
          </FilterChips>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              data-e2e="admin-users-clear"
              onClick={() => {
                const { account: _old, ...rest } = filter
                onSearch({ ...rest, query: "", role: null, blocked: "any", page: 1 })
              }}
            >
              {t.t(`AdminUsers.clear`)}
            </Button>
          )}
        </div>
      </div>

      <ErrorState message={error} />

      <h2 ref={heading} tabIndex={-1} class="text-sm text-muted" data-e2e="admin-users-count">
        {list ? t.t(`AdminUsers.count`, { count: list.total }) : t.t(`AdminUsers.loading`)}
      </h2>
      {list === null
        ? !error && (
          <div role="status" aria-label={t.t(`AdminUsers.loading`)}>
            <LoadingSkeleton rows={5} />
          </div>
        )
        : (
          <div data-e2e="admin-users-list">
            <DataTable
              mode="server"
              class="[&>div:first-child]:min-h-0"
              columns={userColumns(t, operatorId, navigate)}
              rows={rows}
              sort={filter.sort}
              onSortChange={(sort) =>
                onSearch({ ...filter, sort: nextSort(filter.sort, sort), page: 1 })}
              caption={t.t(`AdminUsers.people`)}
              captionHidden
              rowKey={(row) => row.user.id}
              empty={
                <EmptyState
                  inset
                  title={t.t(`AdminUsers.noMatch`)}
                  description={t.t(`AdminUsers.noMatchHint`)}
                />
              }
              paging={{
                page: list.page,
                pageSize: list.pageSize,
                total: list.total,
                onChange: onPage,
                label: t.t(`AdminUsers.pages`),
              }}
            />
          </div>
        )}
    </Stack>
  )
}

/** The table's columns. Every one but the status sorts, on the server. */
function userColumns(
  t: Translator<string>,
  operatorId?: number,
  navigate?: Navigate,
): DataTableColumn<UserTableRow, AdminUserSortKey>[] {
  return [
    {
      key: "name",
      header: t.t(`AdminUsers.person`),
      sortable: true,
      render: ({ user }) => (
        <PersonCell user={user} self={user.id === operatorId} navigate={navigate} />
      ),
    },
    {
      key: "role",
      header: t.t(`AdminUsers.role`),
      sortable: true,
      render: ({ role }) => <Badge text={roleLabel(t, role)} color={roleColor(role)} />,
    },
    {
      id: "status",
      header: t.t(`AdminUsers.status`),
      render: ({ user }) =>
        user.blockedAt
          ? (
            <span data-e2e="admin-user-blocked">
              <Badge text={t.t(`AdminUsers.blocked`)} color="red" />
            </span>
          )
          : <Badge text={t.t(`AdminUsers.active`)} color="green" type="outline" />,
    },
    {
      key: "lastSeenAt",
      header: t.t(`AdminUsers.lastSeen`),
      sortable: true,
      render: ({ lastSeenAt }) =>
        lastSeenAt
          ? <When class="whitespace-nowrap text-sm" at={lastSeenAt} />
          : <span class="text-sm text-muted">{t.t(`AdminUsers.never`)}</span>,
    },
    {
      key: "createdAt",
      header: t.t(`AdminUsers.created`),
      sortable: true,
      render: ({ createdAt }) => (
        <OnDay class="whitespace-nowrap text-sm text-muted" at={createdAt} />
      ),
    },
  ]
}

/** One row of filter chips with its visible name; the chips' group carries the same name. */
function FilterChips(
  { label, dataE2E, children }: { label: string; dataE2E: string; children: JSX.Element },
): JSX.Element {
  return (
    // One row that scrolls sideways on a phone rather than wrapping onto a second line, as the
    // billing page's chips do; from `sm` it wraps.
    <div
      class="-mx-4 flex max-w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:flex-wrap sm:px-0"
      data-e2e={dataE2E}
    >
      <span class="shrink-0 text-sm text-muted" aria-hidden="true">{label}</span>
      {children}
    </div>
  )
}

/**
 * The person column: their avatar, their name as the link to their page, their address when the
 * name is not already it, and "You" on the operator's own row.
 */
function PersonCell(
  { user, self, navigate }: { user: AdminUserRow; self: boolean; navigate?: Navigate },
): JSX.Element {
  const subtitle = adminUserSubtitle(user)
  const t = useAdminText()
  const name = adminUserName(user, t)
  return (
    // At least 12rem wide: on a phone the table scrolls sideways instead of squeezing the name
    // into a column a few letters wide.
    <div class="flex min-w-48 items-center gap-3">
      <Avatar
        name={name}
        src={pictureUrl(user.pictureId, ADMIN_PICTURE_PATH)}
        size="sm"
      />
      <div class="flex min-w-0 flex-col">
        <span class="flex flex-wrap items-center gap-2">
          <Link
            href={ADMIN_PATHS.user(user.id)}
            navigate={navigate}
            class="pc-link font-medium wrap-anywhere"
            translate={false}
            data-e2e={`admin-user-${user.id}`}
          >
            {name}
          </Link>
          {user.guestSince && (
            <span data-e2e="admin-user-guest">
              <Badge text={t.t(`AdminUsers.guest`)} color="gray" type="outline" />
            </span>
          )}
          {self && (
            <span data-e2e="admin-user-you">
              <Badge text={t.t(`AdminUsers.you`)} color="gray" type="outline" />
            </span>
          )}
        </span>
        {subtitle && (
          <span class="text-sm text-muted wrap-anywhere" translate={false}>{subtitle}</span>
        )}
      </div>
    </div>
  )
}
