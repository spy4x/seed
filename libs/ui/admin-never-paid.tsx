import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { IconCreditCard } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { useFormat } from "@spy4x/preact-ui/format"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import type { AdminNeverPaidGroup, AdminNeverPaidResponse } from "@domain/billing"
import { ADMIN_BILLING_PATHS, billingDate } from "./admin-billing-list.tsx"
import { ADMIN_GROUP_PATHS, adminGroupPersonName } from "./admin-groups-list.tsx"
import type { Navigate } from "./progressive.tsx"
import { useAdminText } from "./i18n.ts"

export interface AdminNeverPaidScreenProps {
  /** The page of groups, or `null` while it loads or when it failed. */
  list: AdminNeverPaidResponse | null
  pending: boolean
  /** Set when the list could not be read, or `null`. The screen says so in its own words. */
  error: string | null
  onPage: (page: number) => void
  onRetry: () => void
  navigate?: Navigate
}

interface Row {
  group: AdminNeverPaidGroup
}

/** The server keeps one order, newest first, so no column sorts. */
const NO_SORT: [] = []

/** Like the customer list: the table fits its rows, and a phone drops the owner column. */
const TABLE_CLASS = [
  `[&>div:first-child]:min-h-0`,
  `[&_:is(th,td)]:px-4`,
  `max-sm:[&_:is(th,td)]:px-3`,
  `max-sm:[&_td]:whitespace-normal`,
  `max-sm:[&_:is(th,td):nth-child(2)]:hidden`,
].join(` `)

/**
 * The groups that have never paid, newest first (#706): who signed up and stopped at the plan, for
 * an operator to follow up. Each name opens the group's admin page; the owner and the day the group
 * was made sit beside it.
 */
export function AdminNeverPaidScreen(props: AdminNeverPaidScreenProps): JSX.Element {
  const { list, pending, error, navigate } = props
  const t = useAdminText()
  const format = useFormat()
  const heading = useRef<HTMLHeadingElement>(null)
  // After a page turn the reader starts again at the count, once the new page arrives.
  const asked = useRef(false)
  useEffect(() => {
    if (pending) return
    if (asked.current && list !== null) heading.current?.focus()
    asked.current = false
  }, [pending, list])

  const header = (
    <PageHeader
      title={t.t(`AdminNeverPaid.title`)}
      subtitle={t.t(`AdminNeverPaid.subtitle`)}
      titleDataE2E="admin-never-paid-title"
      back={{ href: ADMIN_BILLING_PATHS.list, label: t.t(`AdminBillingCustomer.back`) }}
      navigate={navigate}
    />
  )

  if (list !== null && !list.enabled) {
    return (
      <Stack>
        {header}
        <Card data-e2e="admin-never-paid-off">
          <EmptyState
            inset
            icon={<IconCreditCard class="size-8" aria-hidden="true" />}
            title={t.t(`AdminBilling.off`)}
            description={t.t(`AdminBilling.offText`)}
          />
        </Card>
      </Stack>
    )
  }

  const columns: DataTableColumn<Row, "group">[] = [
    {
      id: `group`,
      header: t.t(`AdminBilling.group`),
      render: ({ group }) => (
        <div class="flex min-w-40 flex-col gap-1 max-sm:min-w-0">
          <Link
            href={ADMIN_GROUP_PATHS.group(group.groupId)}
            navigate={navigate}
            class="pc-link line-clamp-2 font-medium wrap-anywhere"
            title={group.groupName}
            translate={false}
          >
            {group.groupName}
          </Link>
          {/* A phone has no owner column: the owner's address follows the name. */}
          <span class="text-xs text-muted wrap-anywhere sm:hidden" translate={false}>
            {group.owner.email ?? adminGroupPersonName(t, group.owner)}
          </span>
        </div>
      ),
    },
    {
      id: `owner`,
      header: t.t(`AdminBilling.owner`),
      render: ({ group }) => (
        <div class="flex min-w-0 max-w-md flex-col" translate={false}>
          <span class="truncate text-sm font-medium" title={adminGroupPersonName(t, group.owner)}>
            {adminGroupPersonName(t, group.owner)}
          </span>
          {group.owner.email && group.owner.name && (
            <span class="truncate text-xs text-muted" title={group.owner.email}>
              {group.owner.email}
            </span>
          )}
        </div>
      ),
    },
    {
      id: `created`,
      header: t.t(`AdminNeverPaid.created`),
      render: ({ group }) => (
        <span class="whitespace-nowrap text-sm tabular-nums">
          {billingDate(group.createdAt, format)}
        </span>
      ),
    },
  ]

  return (
    <Stack>
      {header}
      {error && (
        <div class="flex flex-col items-center gap-3" data-e2e="admin-never-paid-error">
          <ErrorState message={t.t(`AdminNeverPaid.listError`)} />
          <Button variant="secondary" onClick={props.onRetry}>
            {t.t(`AdminBilling.retry`)}
          </Button>
        </div>
      )}
      {(list !== null || !error) && (
        <h2
          ref={heading}
          tabIndex={-1}
          class="text-sm text-muted"
          data-e2e="admin-never-paid-count"
        >
          {list?.enabled
            ? t.t(`AdminBilling.count`, { count: list.total })
            : t.t(`AdminNeverPaid.loading`)}
        </h2>
      )}
      {list === null
        ? !error && (
          <div role="status" aria-label={t.t(`AdminNeverPaid.loading`)}>
            <LoadingSkeleton rows={5} />
          </div>
        )
        : list.enabled && (
          <div data-e2e="admin-never-paid-list">
            <DataTable
              mode="server"
              class={TABLE_CLASS}
              columns={columns}
              rows={list.groups.map((group) => ({ group }))}
              caption={t.t(`AdminNeverPaid.title`)}
              captionHidden
              rowKey={(row) => row.group.groupId}
              sort={NO_SORT}
              onSortChange={() => {}}
              empty={<EmptyState inset title={t.t(`AdminNeverPaid.empty`)} />}
              paging={{
                page: list.page,
                pageSize: list.pageSize,
                total: list.total,
                onChange: (page) => {
                  asked.current = true
                  props.onPage(page)
                },
                label: t.t(`AdminNeverPaid.pages`),
              }}
            />
          </div>
        )}
    </Stack>
  )
}
