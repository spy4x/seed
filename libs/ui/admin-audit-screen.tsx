import type { ComponentChildren, JSX } from "preact"
import { useState } from "preact/hooks"
import { IconDownload } from "@spy4x/preact-icons"
import { timeAgo } from "@spy4x/platform/universal/time"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
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
import type { BillingAuditEvent } from "@domain/billing"
import { BLOG_AUDIT_KINDS } from "@domain/blog"
import { ACTIVITY_KINDS } from "@domain/groups"
import {
  accountAuditEvent,
  activityAuditEvent,
  ADMIN_AUDIT_EXPORTED_KIND,
  ADMIN_AUDIT_NO_FILTER,
  ADMIN_AUDIT_SEARCH_MAX,
  ADMIN_JOB_CANCELLED_KIND,
  ADMIN_JOB_RETRIED_KIND,
  ADMIN_JOB_RUN_NOW_KIND,
  ADMIN_OPERATOR_ACTIVITY_KINDS,
  type AdminAuditEntry,
  type AdminAuditFilter,
  type AdminAuditOperator,
  type AdminAuditPerson,
  type AuthAuditEventType,
  isAdminAuditFiltered,
  parseAuditEvent,
} from "@domain/identity"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { ADMIN_GROUP_PATHS } from "./admin-groups-list.tsx"
import { BILLING_AUDIT_LABELS } from "./admin-billing-list.tsx"
import { AUDIT_EVENTS, auditDetail, auditTone, linkAuditTitle } from "./admin-user-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { useFormat } from "@spy4x/preact-ui/format"

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
  "group.exported": "Group exported",
  "group.imported": "Group imported",
  "note.created": "Note added",
  "note.deleted": "Note deleted",
  "note.attachment.added": "File attached",
  "note.attachment.removed": "Removed a file",
  "note.restored": "Note restored",
  "note.moved_out": "Notes moved out",
  "note.moved_in": "Notes moved in",
  "tag.created": "Tag added",
  "tag.updated": "Tag changed",
  "tag.deleted": "Tag deleted",
  [ADMIN_JOB_RETRIED_KIND]: "Job run again by an operator",
  [ADMIN_JOB_RUN_NOW_KIND]: "Job run now by an operator",
  [ADMIN_JOB_CANCELLED_KIND]: "Job cancelled by an operator",
  [ADMIN_AUDIT_EXPORTED_KIND]: "Audit log exported by an operator",
  [BLOG_AUDIT_KINDS.created]: "Blog post created",
  [BLOG_AUDIT_KINDS.updated]: "Blog post saved",
  [BLOG_AUDIT_KINDS.published]: "Blog post published",
  [BLOG_AUDIT_KINDS.scheduled]: "Blog post scheduled",
  [BLOG_AUDIT_KINDS.unscheduled]: "Blog post unscheduled",
  [BLOG_AUDIT_KINDS.unpublished]: "Blog post unpublished",
  [BLOG_AUDIT_KINDS.urlChanged]: "Blog post URL changed",
  [BLOG_AUDIT_KINDS.deleted]: "Blog post deleted",
}

/**
 * What an entry's event is called; an event this page does not know shows its code. A sign-in or
 * sign-up by e-mail link names the method in the title (#391), from the entry's `identifier`.
 */
export function auditEventLabel(event: string, identifier: string | null = null): string {
  const parsed = parseAuditEvent(event)
  if (!parsed) return event
  if (parsed.source === "account") {
    return linkAuditTitle(parsed.eventType, identifier) ??
      AUDIT_EVENTS[parsed.eventType as AuthAuditEventType] ??
      BILLING_AUDIT_LABELS[parsed.eventType as BillingAuditEvent] ??
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
  ...ADMIN_OPERATOR_ACTIVITY_KINDS.map((kind) => ({
    value: activityAuditEvent(kind),
    label: `Operator: ${ACTIVITY_LABELS[kind]}`,
  })),
  ...Object.entries(BILLING_AUDIT_LABELS).map(([eventType, label]) => ({
    value: accountAuditEvent(Number(eventType)),
    label: `Operator: ${label}`,
  })),
]

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
          <Card data-e2e="admin-audit-empty">
            <EmptyState
              inset
              title={filtered ? "Nothing matches" : "Nothing recorded yet"}
              description={filtered
                ? "Try a wider date range or another person, or clear the filters."
                : "Sign-ins, account changes and group changes show here as they happen."}
            />
          </Card>
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
            busyLabel="Loading…"
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
              busyLabel="Filtering…"
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
  { person, entry, navigate, truncate = false }: {
    person: AdminAuditPerson | null
    entry: AdminAuditEntry
    navigate?: Navigate
    /** One line cut with an ellipsis, the full name in the tooltip; it wraps by default. */
    truncate?: boolean
  },
): JSX.Element {
  if (!person) {
    return <span class="text-muted">{entry.source === "account" ? "Deleted account" : "—"}</span>
  }
  return (
    <Link
      href={ADMIN_PATHS.user(person.id)}
      navigate={navigate}
      class={truncate ? "pc-link block truncate font-medium" : "pc-link font-medium wrap-anywhere"}
      title={truncate ? person.name : undefined}
      data-e2e={`admin-audit-person-${person.id}`}
    >
      {person.name}
    </Link>
  )
}

/** What an entry names besides its people: the group, the method or token, the job. */
function detailOf(entry: AdminAuditEntry): string | null {
  const event = parseAuditEvent(entry.event)
  const eventType = event?.source === "account" ? event.eventType : null
  const parts = [
    entry.group && `Group ${entry.group.name}`,
    // A link row's title already names the method.
    entry.identifier && !linkAuditTitle(eventType, entry.identifier) &&
    auditDetail(eventType, entry.identifier),
    entry.jobKind && `Job ${entry.jobKind}`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}

/** Whether the person the entry is about is also who did it: then the log names them once. */
function selfDone(entry: AdminAuditEntry): boolean {
  return !entry.byOperator && entry.person !== null && entry.person.id === entry.actor?.id
}

/**
 * The exact moment under a relative time. In UTC on purpose, in the operator's region format: an
 * operator matches a row against the server's logs, which are in UTC.
 */
function When({ at }: { at: string }): JSX.Element {
  const format = useFormat()
  return (
    <time class="flex flex-col whitespace-nowrap" dateTime={at}>
      <span class="text-sm">{timeAgo(at)}</span>
      <span class="text-xs text-muted">{format.utc().exact(at)}</span>
    </time>
  )
}

function Cell({ children }: { children: ComponentChildren }): JSX.Element {
  // At least 9rem wide from `sm`, where every column shows. A phone shows two columns, When and
  // Event, and the Event cell takes the rest of the row.
  return <div class="flex flex-col gap-1 text-sm sm:min-w-36">{children}</div>
}

/**
 * A person in the About and Done by columns: the name as the link and the address under it, each
 * on one line and cut with an ellipsis at 9rem (`w-36`), the full text in its tooltip. An address
 * never breaks mid-word. The groups list's owner column draws the same.
 */
function PersonCell(
  { person, entry, navigate, address = false }: {
    person: AdminAuditPerson | null
    entry: AdminAuditEntry
    navigate?: Navigate
    /** Whether to show the address under the name, when the name is not already it. */
    address?: boolean
  },
): JSX.Element {
  return (
    <div class="flex w-36 min-w-0 flex-col gap-1 text-sm">
      <PersonLink person={person} entry={entry} navigate={navigate} truncate />
      {address && person && person.email !== person.name && (
        <span class="truncate text-muted" title={person.email ?? undefined}>{person.email}</span>
      )}
    </div>
  )
}

/**
 * The people of an entry inside its Event cell on a phone, which hides the About and Done by
 * columns: "About Ada · by Olga", or only the name when they did it themselves. Plain text: the
 * links are the columns', which a phone hides.
 */
function PhonePeople({ entry }: { entry: AdminAuditEntry }): JSX.Element | null {
  const name = (person: AdminAuditPerson | null) =>
    person?.name ?? (entry.source === "account" ? "Deleted account" : null)
  // An operator's billing action is about a group, which no person stands for.
  const about = entry.person === null && entry.group ? entry.group.name : name(entry.person)
  const by = selfDone(entry) ? null : name(entry.actor)
  if (!about && !by) return null
  return (
    <span class="text-muted wrap-anywhere sm:hidden" data-e2e="admin-audit-people-phone">
      {about && (
        <>
          About <span class="font-medium text-foreground">{about}</span>
        </>
      )}
      {about && by && " · "}
      {by && (
        <>
          by <span class="font-medium text-foreground">{by}</span>
        </>
      )}
    </span>
  )
}

/**
 * The Detail column: at most two lines of the detail and two of the browser, 7rem wide from `sm`,
 * each with its full text in the tooltip. A token's detail names three ids, which would otherwise
 * make the row tall and push the IP address column off the page.
 */
function DetailCell({ entry }: { entry: AdminAuditEntry }): JSX.Element {
  const detail = detailOf(entry)
  return (
    <div class="flex flex-col gap-1 text-sm sm:w-28" data-e2e="admin-audit-detail">
      <span class="line-clamp-2 wrap-anywhere" title={detail ?? undefined}>{detail ?? "—"}</span>
      {entry.userAgent && (
        <span class="line-clamp-2 text-xs text-muted wrap-anywhere" title={entry.userAgent}>
          {entry.userAgent}
        </span>
      )}
    </div>
  )
}

/**
 * The table's classes. Below `sm` only When and Event show, and the Event cell names the people
 * ({@link PhonePeople}), so a phone reads each entry without scrolling sideways. Positions follow
 * {@link AuditTable}: 3 About, 4 Done by, 5 Detail, 6 IP address. The cells keep 0.75rem of side
 * padding at every width, so all six columns fit the 64rem page at `lg` without sideways scroll.
 */
const AUDIT_TABLE_CLASS = [
  `[&>div:first-child]:min-h-0`,
  `[&_:is(th,td)]:px-3`,
  `max-sm:[&_:is(th,td):nth-child(n+3)]:hidden`,
].join(` `)

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
            {auditEventLabel(entry.event, entry.identifier)}
          </span>
          {entry.byOperator && (
            <span>
              <Badge text="Operator" color="blue" type="outline" />
            </span>
          )}
          <PhonePeople entry={entry} />
        </Cell>
      ),
    },
    {
      id: "person",
      header: "About",
      render: (entry) =>
        entry.person === null && entry.group
          ? (
            <Link
              href={ADMIN_GROUP_PATHS.group(entry.group.id)}
              navigate={navigate}
              class="pc-link block w-36 truncate text-sm font-medium"
              title={entry.group.name}
            >
              {entry.group.name}
            </Link>
          )
          : <PersonCell entry={entry} person={entry.person} navigate={navigate} address />,
    },
    {
      id: "actor",
      header: "Done by",
      render: (entry) =>
        selfDone(entry)
          ? <span class="text-sm text-muted">Themselves</span>
          : <PersonCell entry={entry} person={entry.actor} navigate={navigate} />,
    },
    {
      id: "detail",
      header: "Detail",
      render: (entry) => <DetailCell entry={entry} />,
    },
    {
      id: "ip",
      header: "IP address",
      // 8rem holds a whole IPv4 address on one line; a longer IPv6 one wraps, never cut.
      render: (entry) => (
        <span class="block font-mono text-sm wrap-anywhere sm:w-32">{entry.ip ?? "—"}</span>
      ),
    },
  ]
  return (
    <div data-e2e="admin-audit-table">
      <DataTable
        class={AUDIT_TABLE_CLASS}
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
  const format = useFormat()
  return (
    <div class="rounded-xl border border-subtle bg-surface p-4" data-e2e="admin-audit-timeline">
      <Timeline
        label="Audit log, newest first"
        items={entries.map((entry) => {
          const detail = detailOf(entry)
          return {
            id: entry.key,
            title: auditEventLabel(entry.event, entry.identifier),
            at: entry.at,
            when: <span title={format.utc().exact(entry.at)}>{timeAgo(entry.at)}</span>,
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
