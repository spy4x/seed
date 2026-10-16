import type { ComponentChildren, JSX } from "preact"
import { useState } from "preact/hooks"
import { IconDownload } from "@spy4x/preact-icons"
import { timeAgo } from "@spy4x/platform/universal/time"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Select, type SelectOption } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { Timeline, type TimelineTone } from "@spy4x/preact-ui/timeline"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
import { ACTIVITY_KINDS } from "@domain/groups"
import {
  accountAuditEvent,
  activityAuditEvent,
  ADMIN_AUDIT_EXPORTED_KIND,
  ADMIN_AUDIT_NO_FILTER,
  ADMIN_AUDIT_SEARCH_MAX,
  ADMIN_JOB_RETRIED_KIND,
  type AdminAuditEntry,
  type AdminAuditFilter,
  type AdminAuditOperator,
  type AdminAuditPerson,
  type AuthAuditEventType,
  isAdminAuditFiltered,
  parseAuditEvent,
} from "@domain/identity"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { AUDIT_EVENTS, auditTone } from "./admin-user-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/** How the log is drawn: a dense table, or a timeline that reads like a story. */
export type AdminAuditView = "table" | "timeline"

const VIEW_CHIPS: { value: AdminAuditView; label: string }[] = [
  { value: "table", label: "Table" },
  { value: "timeline", label: "Timeline" },
]

/** What each group activity and operator action is called in the log. */
const ACTIVITY_LABELS: Record<string, string> = {
  "group.created": "Group created",
  "group.renamed": "Group renamed",
  "group.details_updated": "Group details changed",
  "group.deleted": "Group deleted",
  "group.restored": "Group restored",
  "group.member_role_changed": "Member's role changed",
  "group.member_removed": "Member removed",
  "group.member_left": "Member left",
  "group.ownership_transferred": "Ownership transferred",
  "group.invitation_created": "Invitation sent",
  "group.invitation_accepted": "Invitation accepted",
  "group.invitation_revoked": "Invitation withdrawn",
  "group.invitation_declined": "Invitation declined",
  "group.data_moved_out": "Group data moved out",
  "group.data_moved_in": "Group data moved in",
  "note.created": "Note added",
  "note.deleted": "Note deleted",
  "note.restored": "Note restored",
  "note.moved_out": "Notes moved out",
  "note.moved_in": "Notes moved in",
  "tag.created": "Tag added",
  "tag.updated": "Tag changed",
  "tag.deleted": "Tag deleted",
  [ADMIN_JOB_RETRIED_KIND]: "Job run again by an operator",
  [ADMIN_AUDIT_EXPORTED_KIND]: "Audit log exported by an operator",
}

/** What an entry's event is called; an event this page does not know shows its code. */
export function auditEventLabel(event: string): string {
  const parsed = parseAuditEvent(event)
  if (!parsed) return event
  if (parsed.source === "account") {
    return AUDIT_EVENTS[parsed.eventType as AuthAuditEventType] ??
      `Account event ${parsed.eventType}`
  }
  return ACTIVITY_LABELS[parsed.kind] ?? parsed.kind
}

/** An entry's dot: account events keep the person page's tones; operator actions stand out. */
function entryTone(entry: AdminAuditEntry): TimelineTone {
  const parsed = parseAuditEvent(entry.event)
  if (parsed?.source === "account") return auditTone(parsed.eventType as AuthAuditEventType)
  if (parsed?.kind.endsWith(".deleted") || parsed?.kind === "group.member_removed") {
    return "warning"
  }
  return entry.byOperator ? "warning" : "neutral"
}

/** Every event the filter offers: the account events, then group activity, then operator actions. */
const EVENT_OPTIONS: SelectOption[] = [
  ...Object.entries(AUDIT_EVENTS).map(([eventType, label]) => ({
    value: accountAuditEvent(Number(eventType)),
    label: `Account: ${label}`,
  })),
  ...ACTIVITY_KINDS.map((kind) => ({
    value: activityAuditEvent(kind),
    label: `Group: ${ACTIVITY_LABELS[kind] ?? kind}`,
  })),
  ...[ADMIN_JOB_RETRIED_KIND, ADMIN_AUDIT_EXPORTED_KIND].map((kind) => ({
    value: activityAuditEvent(kind),
    label: `Operator: ${ACTIVITY_LABELS[kind]}`,
  })),
]

const EXACT = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
})

export interface AdminAuditScreenProps {
  /** What the address asked for; the filter form starts from it. */
  filter: AdminAuditFilter
  /** Everyone the operator filter offers; empty while it loads. */
  operators: readonly AdminAuditOperator[]
  view: AdminAuditView
  /** Every entry read so far, newest first, or `null` while the first page loads. */
  entries: readonly AdminAuditEntry[] | null
  /** Older entries are left to read. */
  hasMore: boolean
  /** The first page of a filter is loading. */
  pending: boolean
  /** An older page is loading. */
  loadingMore: boolean
  /** Why the log could not be read, or `null`. */
  error: string | null
  /** The address of the CSV of `filter`: the page's primary action downloads it. */
  exportHref: string
  /** The operator applied or cleared the filters: the app reads the newest page of that. */
  onFilter: (filter: AdminAuditFilter) => void
  onView: (view: AdminAuditView) => void
  onMore: () => void
  navigate?: Navigate
}

/**
 * The audit log (#429): every entry across the product, newest first. The account trail of each
 * person, group activity and the operators' own actions are one list, filtered by event, person,
 * operator, UTC days and IP address. Each person links to their page. The table is dense; the
 * timeline reads like a story. The primary action downloads what the filter shows as CSV.
 */
export function AdminAuditScreen(props: AdminAuditScreenProps): JSX.Element {
  const { filter, entries, error, view, navigate } = props
  const filtered = isAdminAuditFiltered(filter)
  return (
    <Stack>
      <PageHeader
        title="Audit log"
        subtitle="Every sign-in, account change, group change and operator action, newest first."
        titleDataE2E="admin-audit-title"
        action={
          <PageAction
            label="Export CSV"
            Icon={IconDownload}
            href={props.exportHref}
            variant="secondary"
            dataE2E="admin-audit-export"
          />
        }
      />
      <FilterForm
        key={JSON.stringify(filter)}
        filter={filter}
        operators={props.operators}
        pending={props.pending}
        onFilter={props.onFilter}
      />

      <ErrorState message={error} dataE2E="admin-audit-error" />

      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-sm text-muted" data-e2e="admin-audit-count" aria-live="polite">
          {entries === null
            ? "Loading the log"
            : `${entries.length}${props.hasMore ? "+" : ""} ${
              entries.length === 1 ? "entry" : "entries"
            }${filtered ? " match" : ""}`}
        </h2>
        <div data-e2e="admin-audit-view">
          <ToggleChips
            mode="single"
            label="View"
            options={VIEW_CHIPS}
            value={view}
            onChange={(next) => next && props.onView(next as AdminAuditView)}
          />
        </div>
      </div>

      {entries === null
        ? !error && (
          <div role="status" aria-label="Loading the log" data-e2e="admin-audit-loading">
            <LoadingSkeleton rows={6} />
          </div>
        )
        : entries.length === 0
        ? (
          <div data-e2e="admin-audit-empty">
            <EmptyState
              title={filtered ? "Nothing matches" : "Nothing recorded yet"}
              description={filtered
                ? "Try a wider date range or another person, or clear the filters."
                : "Sign-ins, account changes and group changes show here as they happen."}
            />
          </div>
        )
        : view === "timeline"
        ? <AuditTimeline entries={entries} navigate={navigate} />
        : <AuditTable entries={entries} navigate={navigate} />}

      {entries !== null && props.hasMore && (
        <div class="flex justify-center">
          <Button
            variant="secondary"
            data-e2e="admin-audit-more"
            busy={props.loadingMore}
            busyLabel="Loading..."
            onClick={props.onMore}
          >
            Show older entries
          </Button>
        </div>
      )}
    </Stack>
  )
}

/** The filter form: what the operator types, applied together. */
function FilterForm(
  { filter, operators, pending, onFilter }: {
    filter: AdminAuditFilter
    operators: readonly AdminAuditOperator[]
    pending: boolean
    onFilter: (filter: AdminAuditFilter) => void
  },
): JSX.Element {
  // The form's own copy: the address changes only when the operator applies it.
  const [draft, setDraft] = useState(filter)
  const set = (part: Partial<AdminAuditFilter>) => setDraft({ ...draft, ...part })
  const text = (event: Event) => (event.currentTarget as HTMLInputElement).value
  const operatorOptions: SelectOption[] = operators.map((operator) => ({
    value: String(operator.id),
    label: operator.email ? `${operator.name} (${operator.email})` : operator.name,
  }))
  return (
    <div class="rounded-xl border border-subtle bg-surface p-4">
      <ScreenForm
        pending={pending}
        onSubmit={() => onFilter({ ...draft, person: draft.person.trim(), ip: draft.ip.trim() })}
      >
        <div class="flex flex-col gap-4" role="search" aria-label="Filter the audit log">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="admin-audit-event" label="Event">
              <Select
                name="event"
                data-e2e="admin-audit-event"
                options={EVENT_OPTIONS}
                placeholder="Every event"
                value={draft.event ?? ""}
                onChange={(event) => set({ event: text(event) || null })}
              />
            </Field>
            <Field id="admin-audit-person" label="Person (name, address or id)">
              <Input
                name="person"
                type="search"
                data-e2e="admin-audit-person"
                value={draft.person}
                maxLength={ADMIN_AUDIT_SEARCH_MAX}
                autocomplete="off"
                onInput={(event) => set({ person: text(event) })}
              />
            </Field>
            <Field id="admin-audit-operator" label="Done by operator">
              <Select
                name="operator"
                data-e2e="admin-audit-operator"
                options={operatorOptions}
                placeholder="Anyone"
                value={draft.operator === null ? "" : String(draft.operator)}
                onChange={(event) => {
                  const value = text(event)
                  set({ operator: value ? Number(value) : null })
                }}
              />
            </Field>
            <Field id="admin-audit-from" label="From (UTC day)">
              <Input
                name="from"
                type="date"
                data-e2e="admin-audit-from"
                value={draft.from ?? ""}
                max={draft.to ?? undefined}
                onInput={(event) => set({ from: text(event) || null })}
              />
            </Field>
            <Field id="admin-audit-to" label="To (UTC day, included)">
              <Input
                name="to"
                type="date"
                data-e2e="admin-audit-to"
                value={draft.to ?? ""}
                min={draft.from ?? undefined}
                onInput={(event) => set({ to: text(event) || null })}
              />
            </Field>
            <Field id="admin-audit-ip" label="IP address starts with">
              <Input
                name="ip"
                type="search"
                inputMode="decimal"
                data-e2e="admin-audit-ip"
                value={draft.ip}
                maxLength={45}
                pattern="[0-9a-fA-F:.]*"
                autocomplete="off"
                onInput={(event) => set({ ip: text(event) })}
              />
            </Field>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              data-e2e="admin-audit-apply"
              busy={pending}
              busyLabel="Filtering..."
            >
              Apply filters
            </Button>
            {isAdminAuditFiltered(filter) && (
              <Button
                type="button"
                variant="ghost"
                data-e2e="admin-audit-clear"
                onClick={() => onFilter(ADMIN_AUDIT_NO_FILTER)}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </ScreenForm>
    </div>
  )
}

/**
 * A person as a link to their page, or a quiet word when the entry names nobody. A person's own
 * trail always names someone, so there an empty slot means the account is gone; a group or system
 * entry may name nobody at all, and says only that.
 */
function PersonLink(
  { person, entry, navigate }: {
    person: AdminAuditPerson | null
    entry: AdminAuditEntry
    navigate?: Navigate
  },
): JSX.Element {
  if (!person) {
    return <span class="text-muted">{entry.source === "account" ? "Deleted account" : "—"}</span>
  }
  return (
    <Link
      href={ADMIN_PATHS.user(person.id)}
      navigate={navigate}
      class="pc-link font-medium wrap-anywhere"
      data-e2e={`admin-audit-person-${person.id}`}
    >
      {person.name}
    </Link>
  )
}

/** What an entry names besides its people: the group, the method or token, the job. */
function detailOf(entry: AdminAuditEntry): string | null {
  const parts = [
    entry.group && `Group ${entry.group.name}`,
    entry.identifier,
    entry.jobKind && `Job ${entry.jobKind}`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}

/** Whether the person the entry is about is also who did it: then the log names them once. */
function selfDone(entry: AdminAuditEntry): boolean {
  return !entry.byOperator && entry.person !== null && entry.person.id === entry.actor?.id
}

/** The exact moment, in UTC, under a relative time. */
function When({ at }: { at: string }): JSX.Element {
  return (
    <time class="flex flex-col whitespace-nowrap" dateTime={at}>
      <span class="text-sm">{timeAgo(at)}</span>
      <span class="text-xs text-muted">{EXACT.format(new Date(at))}</span>
    </time>
  )
}

function Cell({ children }: { children: ComponentChildren }): JSX.Element {
  // At least 9rem wide: on a phone the table scrolls sideways instead of squeezing its words.
  return <div class="flex min-w-36 flex-col gap-1 text-sm">{children}</div>
}

function AuditTable(
  { entries, navigate }: { entries: readonly AdminAuditEntry[]; navigate?: Navigate },
): JSX.Element {
  const columns: DataTableColumn<AdminAuditEntry, never>[] = [
    { id: "at", header: "When", render: (entry) => <When at={entry.at} /> },
    {
      id: "event",
      header: "Event",
      render: (entry) => (
        <Cell>
          <span class="font-medium" data-e2e="admin-audit-event-label">
            {auditEventLabel(entry.event)}
          </span>
          {entry.byOperator && (
            <span>
              <Badge text="Operator" color="blue" type="outline" />
            </span>
          )}
        </Cell>
      ),
    },
    {
      id: "person",
      header: "About",
      render: (entry) => (
        <Cell>
          <PersonLink entry={entry} person={entry.person} navigate={navigate} />
          {entry.person && entry.person.email !== entry.person.name && (
            <span class="text-muted wrap-anywhere">{entry.person.email}</span>
          )}
        </Cell>
      ),
    },
    {
      id: "actor",
      header: "Done by",
      render: (entry) =>
        selfDone(entry) ? <span class="text-sm text-muted">Themselves</span> : (
          <Cell>
            <PersonLink entry={entry} person={entry.actor} navigate={navigate} />
          </Cell>
        ),
    },
    {
      id: "detail",
      header: "Detail",
      render: (entry) => (
        <Cell>
          <span class="wrap-anywhere">{detailOf(entry) ?? "—"}</span>
          {entry.userAgent && (
            <span class="line-clamp-2 text-xs text-muted wrap-anywhere" title={entry.userAgent}>
              {entry.userAgent}
            </span>
          )}
        </Cell>
      ),
    },
    {
      id: "ip",
      header: "IP address",
      render: (entry) => <span class="whitespace-nowrap font-mono text-sm">{entry.ip ?? "—"}</span>,
    },
  ]
  return (
    <div data-e2e="admin-audit-table">
      <DataTable
        columns={columns}
        rows={entries}
        sort={[]}
        onSortChange={() => {}}
        caption="Audit log, newest first"
        captionHidden
        rowKey={(entry) => entry.key}
      />
    </div>
  )
}

function AuditTimeline(
  { entries, navigate }: { entries: readonly AdminAuditEntry[]; navigate?: Navigate },
): JSX.Element {
  return (
    <div class="rounded-xl border border-subtle bg-surface p-4" data-e2e="admin-audit-timeline">
      <Timeline
        label="Audit log, newest first"
        items={entries.map((entry) => {
          const detail = detailOf(entry)
          return {
            id: entry.key,
            title: auditEventLabel(entry.event),
            at: entry.at,
            when: <span title={EXACT.format(new Date(entry.at))}>{timeAgo(entry.at)}</span>,
            tone: entryTone(entry),
            dataE2E: `admin-audit-entry-${entry.key}`,
            description: (
              <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                {selfDone(entry)
                  ? <PersonLink entry={entry} person={entry.person} navigate={navigate} />
                  : (
                    <>
                      {entry.person && (
                        <>
                          <PersonLink entry={entry} person={entry.person} navigate={navigate} />
                          <span class="text-muted">·</span>
                        </>
                      )}
                      <span class="text-muted">by</span>
                      <PersonLink entry={entry} person={entry.actor} navigate={navigate} />
                      {entry.byOperator && <Badge text="Operator" color="blue" type="outline" />}
                    </>
                  )}
                {detail && <span class="text-muted wrap-anywhere">· {detail}</span>}
                {entry.ip && <span class="font-mono text-muted">· {entry.ip}</span>}
              </span>
            ),
          }
        })}
      />
    </div>
  )
}
