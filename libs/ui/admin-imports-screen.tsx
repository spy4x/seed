import type { JSX } from "preact"
import { Badge, type BadgeTone, type BadgeVariant } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { useFormat, When } from "@spy4x/preact-ui/format"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { RadioChips } from "@spy4x/preact-ui/radio-chips"
import type { Translator } from "@spy4x/platform/universal/i18n"
import {
  ADMIN_IMPORT_STATUS_FILTERS,
  type AdminImportFilter,
  type AdminImportListResponse,
  type AdminImportRow,
  type AdminImportStatusFilter,
  ImportStatus,
} from "@domain/imports"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { ADMIN_GROUP_PATHS } from "./admin-groups-list.tsx"
import type { Navigate } from "./progressive.tsx"
import { useAdminText } from "./i18n.ts"

/** The Imports module's page in the admin app. */
export const ADMIN_IMPORTS_PATH = `/imports`

/** Each status's word and badge; a chip of the list uses the same word. */
const STATUSES: Record<ImportStatus, { key: string; color: BadgeTone; type: BadgeVariant }> = {
  [ImportStatus.READING]: { key: `AdminImports.reading`, color: `info`, type: `outline` },
  [ImportStatus.READY]: { key: `AdminImports.ready`, color: `neutral`, type: `outline` },
  [ImportStatus.FAILED]: { key: `AdminImports.failed`, color: `danger`, type: `filled` },
  [ImportStatus.COMMITTING]: { key: `AdminImports.committing`, color: `info`, type: `filled` },
  [ImportStatus.COMMITTED]: { key: `AdminImports.committed`, color: `success`, type: `outline` },
  [ImportStatus.UNDONE]: { key: `AdminImports.undone`, color: `neutral`, type: `filled` },
}

const CHIPS: Record<AdminImportStatusFilter, string> = {
  all: `AdminImports.all`,
  failed: STATUSES[ImportStatus.FAILED].key,
  reading: STATUSES[ImportStatus.READING].key,
  ready: STATUSES[ImportStatus.READY].key,
  committing: STATUSES[ImportStatus.COMMITTING].key,
  committed: STATUSES[ImportStatus.COMMITTED].key,
  undone: STATUSES[ImportStatus.UNDONE].key,
}

/**
 * Rows fit their content and pad 1rem (0.75rem on a phone); a phone shows only the first cell,
 * which then carries the status, counts and time on a meta line.
 */
const TABLE_CLASS = [
  `[&>div:first-child]:min-h-0`,
  `[&_:is(th,td)]:px-4`,
  `max-sm:[&_:is(th,td)]:px-3`,
  `max-sm:[&_:is(th,td):nth-child(n+2)]:hidden`,
].join(` `)

export interface AdminImportsScreenProps {
  filter: AdminImportFilter
  /** `null` until the first page is read. */
  list: AdminImportListResponse | null
  pending: boolean
  error: string | null
  onFilter(filter: AdminImportFilter): void
  onReload(): void
  navigate?: Navigate
}

/** An import's status as a badge. */
function StatusBadge({ status }: { status: ImportStatus }): JSX.Element {
  const t = useAdminText()
  const view = STATUSES[status] ?? STATUSES[ImportStatus.READING]
  return (
    <span data-e2e="admin-import-status" data-status={ImportStatus[status]?.toLowerCase()}>
      <Badge text={t.t(view.key)} tone={view.color} variant={view.type} />
    </span>
  )
}

/** "3 rows · 2 saved · 1 left out": what the file held and what became of it. */
function Counts({ row }: { row: AdminImportRow }): JSX.Element {
  const t = useAdminText()
  const parts = [
    row.rowCount !== null && t.t(`AdminImports.rowCount`, { count: row.rowCount }),
    row.savedCount !== null && t.t(`AdminImports.savedCount`, { count: row.savedCount }),
    !!row.errorCount && t.t(`AdminImports.leftOut`, { count: row.errorCount }),
    !!row.skippedCount && t.t(`AdminImports.skipped`, { count: row.skippedCount }),
  ].filter((part): part is string => typeof part === `string`)
  return (
    <span class="text-sm tabular-nums" data-e2e="admin-import-counts">
      {parts.length > 0 ? parts.join(` · `) : <span class="text-muted">—</span>}
    </span>
  )
}

/** "Read in 2 s · saved in 5 s": how long each step took, once it ended. */
function Timing({ row }: { row: AdminImportRow }): JSX.Element {
  const t = useAdminText()
  const format = useFormat()
  const seconds = (ms: number) =>
    format.number(ms / 1000, {
      style: `unit`,
      unit: `second`,
      unitDisplay: `narrow`,
      maximumFractionDigits: 1,
    })
  const parts = [
    row.readMs !== null && t.t(`AdminImports.readIn`, { time: seconds(row.readMs) }),
    row.saveMs !== null && t.t(`AdminImports.savedIn`, { time: seconds(row.saveMs) }),
  ].filter((part): part is string => typeof part === `string`)
  return (
    <span class="whitespace-nowrap text-sm tabular-nums" data-e2e="admin-import-timing">
      {parts.length > 0 ? parts.join(` · `) : <span class="text-muted">—</span>}
    </span>
  )
}

function columns(
  t: Translator<string>,
  navigate?: Navigate,
): DataTableColumn<AdminImportRow, never>[] {
  return [
    {
      id: `import`,
      header: t.t(`AdminImports.import`),
      render: (row) => (
        <div class="flex min-w-0 flex-col gap-1" data-e2e={`admin-import-${row.id}`}>
          <Link
            href={ADMIN_GROUP_PATHS.group(row.group.id)}
            navigate={navigate}
            class="pc-link line-clamp-2 font-medium"
            translate={false}
            data-e2e="admin-import-group"
          >
            {row.group.name}
          </Link>
          <span class="flex flex-wrap gap-x-2 text-xs text-muted">
            <span class="font-mono" translate={false}>{row.kind}</span>
            <Link
              href={ADMIN_PATHS.user(row.uploaderId)}
              navigate={navigate}
              class="pc-link"
              data-e2e="admin-import-uploader"
            >
              {t.t(`AdminImports.uploader`, { id: row.uploaderId })}
            </Link>
          </span>
          {row.failure && (
            <span class="text-sm text-danger wrap-anywhere" data-e2e="admin-import-failure">
              <bdi>{row.failure}</bdi>
            </span>
          )}
          <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:hidden">
            <StatusBadge status={row.status} />
            <Counts row={row} />
            <When at={row.createdAt} />
          </span>
        </div>
      ),
    },
    {
      id: `status`,
      header: t.t(`AdminImports.status`),
      render: (row) => <StatusBadge status={row.status} />,
    },
    { id: `rows`, header: t.t(`AdminImports.rows`), render: (row) => <Counts row={row} /> },
    { id: `timing`, header: t.t(`AdminImports.timing`), render: (row) => <Timing row={row} /> },
    {
      id: `when`,
      header: t.t(`AdminImports.uploaded`),
      render: (row) => <When at={row.createdAt} class="whitespace-nowrap text-sm" />,
    },
  ]
}

/**
 * Every group's file imports, newest first, filtered by status: the group, the kind, the uploader,
 * the counts, how long the read and the save took, and why one failed. Never what a file holds.
 */
export function AdminImportsScreen(props: AdminImportsScreenProps): JSX.Element {
  const { filter, list, error, navigate } = props
  const t = useAdminText()
  const showAll = () => props.onFilter({ status: `all`, page: 1 })
  return (
    <Stack>
      <PageHeader
        title={t.t(`AdminImports.title`)}
        subtitle={t.t(`AdminImports.subtitle`)}
        titleDataE2E="admin-imports-title"
      />
      <p class="text-sm text-muted" data-e2e="admin-imports-private">
        {t.t(`AdminImports.private`)}
      </p>
      <RadioChips
        legend={t.t(`AdminImports.status`)}
        hideLegend
        name="status"
        value={filter.status}
        optionsClass="flex flex-nowrap gap-2 overflow-x-auto pb-1"
        onChange={(value) => props.onFilter({ status: value as AdminImportStatusFilter, page: 1 })}
        options={ADMIN_IMPORT_STATUS_FILTERS.map((status) => ({
          value: status,
          label: list
            ? t.t(`AdminImports.chip`, { status: t.t(CHIPS[status]), count: list.counts[status] })
            : t.t(CHIPS[status]),
          inputAttributes: { "data-e2e": `admin-imports-chip-${status}` },
        }))}
      />
      {list === null
        ? error
          ? (
            <div class="flex flex-col items-start gap-3" data-e2e="admin-imports-error">
              <ErrorState message={t.t(`AdminImports.loadError`)} />
              <Button variant="secondary" onClick={props.onReload}>
                {t.t(`AdminImports.retry`)}
              </Button>
            </div>
          )
          : (
            <div
              role="status"
              aria-label={t.t(`AdminImports.loading`)}
              data-e2e="admin-imports-loading"
            >
              <LoadingSkeleton rows={5} />
            </div>
          )
        : (
          <>
            <ErrorState message={error} />
            <p class="text-sm text-muted" data-e2e="admin-imports-count" aria-live="polite">
              {t.t(`AdminImports.count`, { count: list.total })}
            </p>
            <div data-e2e="admin-imports-list">
              <DataTable
                mode="server"
                class={TABLE_CLASS}
                columns={columns(t, navigate)}
                rows={list.imports}
                sort={[]}
                onSortChange={() => {}}
                caption={t.t(`AdminImports.title`)}
                captionHidden
                rowKey={(row) => row.id}
                empty={filter.status === `all`
                  ? (
                    <EmptyState
                      inset
                      title={t.t(`AdminImports.noneYet`)}
                      description={t.t(`AdminImports.noneYetHint`)}
                    />
                  )
                  : (
                    <EmptyState
                      inset
                      title={t.t(`AdminImports.noMatch`)}
                      action={
                        <Button variant="secondary" onClick={showAll}>
                          {t.t(`AdminImports.showAll`)}
                        </Button>
                      }
                    />
                  )}
                paging={{
                  page: list.page,
                  pageSize: list.pageSize,
                  total: list.total,
                  onChange: (page) => props.onFilter({ ...filter, page }),
                  label: t.t(`AdminImports.pages`),
                }}
              />
            </div>
          </>
        )}
    </Stack>
  )
}
