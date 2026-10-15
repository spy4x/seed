import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { timeAgo } from "@spy4x/platform/universal/time"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Select } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { Pagination } from "@spy4x/preact-ui/pagination"
import {
  ADMIN_SEARCH_MAX_LENGTH,
  type AdminBlockedFilter,
  type AdminUserFilter,
  type AdminUserListResponse,
  type AdminUserRow,
  USER_ROLE_NAMES,
  UserRole,
} from "@domain/identity"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

const ANY = ""

const ROLE_OPTIONS = [
  { value: ANY, label: "Any role" },
  ...[UserRole.VIEWER, UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.ADMIN].map((role) => ({
    value: String(role),
    label: roleLabel(role),
  })),
]

const BLOCKED_OPTIONS: { value: AdminBlockedFilter; label: string }[] = [
  { value: "any", label: "Blocked or not" },
  { value: "active", label: "Not blocked" },
  { value: "blocked", label: "Blocked" },
]

/** A role as a person reads it: `Operator`. */
export function roleLabel(role: UserRole): string {
  const name = USER_ROLE_NAMES[role] ?? "unknown"
  return name[0].toUpperCase() + name.slice(1)
}

/** A person's name for a list or a heading: their full name, or their address before they set one. */
export function adminUserName(
  user: Pick<AdminUserRow, "firstName" | "lastName" | "email">,
): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.email || "No name"
}

export interface AdminUsersScreenProps {
  /** What the address asked for; the search form starts from it. */
  filter: AdminUserFilter
  /** The page of people, or `null` while it loads. */
  list: AdminUserListResponse | null
  pending: boolean
  /** Why the list could not be read, or `null`. */
  error: string | null
  /** The operator searched or changed a filter: the app reads page 1 of that. */
  onSearch: (filter: AdminUserFilter) => void
  onPage: (page: number) => void
  navigate?: Navigate
}

/**
 * The admin app's start page: everyone who has an account, newest first, with a search by name or
 * address and filters by role and by blocked state. Each row opens the person's page.
 */
export function AdminUsersScreen(
  { filter, list, pending, error, onSearch, onPage, navigate }: AdminUsersScreenProps,
): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null)
  const pageCount = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1

  // After a page change the list is new: the reader starts again at its heading.
  const page = list?.page
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
  }, [page])

  return (
    <Stack>
      <PageHeader title="Users" titleDataE2E="admin-users-title" />
      <ScreenForm
        pending={pending}
        onSubmit={(data) =>
          onSearch({
            query: String(data.get("q") ?? "").trim(),
            role: data.get("role") ? Number(data.get("role")) as UserRole : null,
            blocked: (data.get("blocked") as AdminBlockedFilter | null) ?? "any",
            page: 1,
          })}
      >
        {/* Keyed by the filter, so going back in history shows the search that page had. */}
        <div
          key={`${filter.query}|${filter.role}|${filter.blocked}`}
          class="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
          role="search"
        >
          <Field id="admin-users-q" label="Name or address">
            <Input
              name="q"
              type="search"
              data-e2e="admin-users-search"
              defaultValue={filter.query}
              maxLength={ADMIN_SEARCH_MAX_LENGTH}
              autocomplete="off"
            />
          </Field>
          <Field id="admin-users-role" label="Role">
            <Select
              name="role"
              data-e2e="admin-users-role"
              options={ROLE_OPTIONS}
              defaultValue={filter.role === null ? ANY : String(filter.role)}
            />
          </Field>
          <Field id="admin-users-blocked" label="Blocked">
            <Select
              name="blocked"
              data-e2e="admin-users-blocked"
              options={BLOCKED_OPTIONS}
              defaultValue={filter.blocked}
            />
          </Field>
          <Button
            type="submit"
            data-e2e="admin-users-submit"
            busy={pending}
            busyLabel="Searching..."
          >
            Search
          </Button>
        </div>
      </ScreenForm>

      <ErrorState message={error} />

      <h2 ref={heading} tabIndex={-1} class="sr-only" data-e2e="admin-users-count">
        {list ? `${list.total} ${list.total === 1 ? "person" : "people"}` : "Loading"}
      </h2>
      {list === null
        ? !error && <p class="text-sm text-muted" role="status">Loading people...</p>
        : list.users.length === 0
        ? (
          <EmptyState
            title="Nobody matches"
            description="Try another name or address, or clear the filters."
          />
        )
        : (
          <>
            <p class="text-sm text-muted" aria-hidden="true">
              {list.total} {list.total === 1 ? "person" : "people"}
            </p>
            <ul
              class="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface"
              data-e2e="admin-users-list"
            >
              {list.users.map((user) => <UserRow key={user.id} user={user} navigate={navigate} />)}
            </ul>
            <Pagination
              page={list.page}
              pageCount={pageCount}
              onChange={onPage}
              label="Pages of people"
            />
          </>
        )}
    </Stack>
  )
}

function UserRow(
  { user, navigate }: { user: AdminUserRow; navigate?: Navigate },
): JSX.Element {
  return (
    <li class="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <div class="flex min-w-0 flex-1 flex-col">
        <Link
          href={ADMIN_PATHS.user(user.id)}
          navigate={navigate}
          class="pc-link min-h-11 content-center font-medium wrap-anywhere sm:min-h-0"
          data-e2e={`admin-user-${user.id}`}
        >
          {adminUserName(user)}
        </Link>
        {user.email && <span class="text-sm text-muted wrap-anywhere">{user.email}</span>}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {user.role !== UserRole.VIEWER && <Badge text={roleLabel(user.role)} color="blue" />}
        {user.blockedAt && <Badge text="Blocked" color="red" data-e2e="admin-user-blocked" />}
        <span class="text-xs text-muted">
          {user.lastSeenAt
            ? (
              <>
                Seen <time dateTime={user.lastSeenAt}>{timeAgo(user.lastSeenAt)}</time>
              </>
            )
            : "Never seen"}
        </span>
      </div>
    </li>
  )
}
