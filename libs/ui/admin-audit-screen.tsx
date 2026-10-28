import type { ComponentChildren, JSX } from "preact"
import { useState } from "preact/hooks"
import { IconDownload } from "@spy4x/preact-icons"
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
import { BLOG_AUDIT_KINDS } from "@domain/blog"
import { CONTACT_LINK_AUDIT_KINDS } from "@domain/contact-links"
import { CATALOG_AUDIT_KINDS } from "@domain/catalog"
import { ACTIVITY_KINDS } from "@domain/groups"
import {
  accountAuditEvent,
  activityAuditEvent,
  ADMIN_AUDIT_EXPORTED_KIND,
  ADMIN_AUDIT_NO_FILTER,
  ADMIN_AUDIT_SEARCH_MAX,
  ADMIN_FILE_DOWNLOADED_KIND,
  ADMIN_FILE_OPENED_KIND,
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
import {
  AUDIT_EVENTS,
  auditDetail,
  auditEventTitle,
  auditTone,
  linkAuditTitle,
} from "./admin-user-screen.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { useFormat, When as Ago } from "@spy4x/preact-ui/format"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

/** How the log is drawn: a dense table, or a timeline that reads like a story. */
export type AdminAuditView = "table" | "timeline"

const VIEW_CHIPS: { value: AdminAuditView; key: string }[] = [
  { value: "table", key: `AdminAudit.table` },
  { value: "timeline", key: `AdminAudit.timeline` },
]

/** What each group activity and operator action is called in the log: one catalog key per code. */
const ACTIVITY_LABELS: Record<string, string> = {
  "group.created": `AdminAuditEvent.groupCreated`,
  "group.renamed": `AdminAuditEvent.groupRenamed`,
  "group.details_updated": `AdminAuditEvent.groupDetailsUpdated`,
  "group.deleted": `AdminAuditEvent.groupDeleted`,
  "group.restored": `AdminAuditEvent.groupRestored`,
  "group.member_role_changed": `AdminAuditEvent.memberRoleChanged`,
  "group.member_removed": `AdminAuditEvent.memberRemoved`,
  "group.member_left": `AdminAuditEvent.memberLeft`,
  "group.ownership_transferred": `AdminAuditEvent.ownershipTransferred`,
  "group.invitation_created": `AdminAuditEvent.invitationCreated`,
  "group.invitation_accepted": `AdminAuditEvent.invitationAccepted`,
  "group.invitation_revoked": `AdminAuditEvent.invitationRevoked`,
  "group.invitation_declined": `AdminAuditEvent.invitationDeclined`,
  "group.data_moved_out": `AdminAuditEvent.groupDataMovedOut`,
  "group.data_moved_in": `AdminAuditEvent.groupDataMovedIn`,
  "group.exported": `AdminAuditEvent.groupExported`,
  "group.imported": `AdminAuditEvent.groupImported`,
  "note.created": `AdminAuditEvent.noteCreated`,
  "note.deleted": `AdminAuditEvent.noteDeleted`,
  "note.attachment.added": `AdminAuditEvent.fileAttached`,
  "note.attachment.removed": `AdminAuditEvent.fileRemoved`,
  "note.restored": `AdminAuditEvent.noteRestored`,
  "note.moved_out": `AdminAuditEvent.notesMovedOut`,
  "note.moved_in": `AdminAuditEvent.notesMovedIn`,
  "tag.created": `AdminAuditEvent.tagCreated`,
  "tag.updated": `AdminAuditEvent.tagUpdated`,
  "tag.deleted": `AdminAuditEvent.tagDeleted`,
  [ADMIN_JOB_RETRIED_KIND]: `AdminAuditEvent.jobRetried`,
  [ADMIN_JOB_RUN_NOW_KIND]: `AdminAuditEvent.jobRunNow`,
  [ADMIN_JOB_CANCELLED_KIND]: `AdminAuditEvent.jobCancelled`,
  [ADMIN_AUDIT_EXPORTED_KIND]: `AdminAuditEvent.auditExported`,
  [ADMIN_FILE_OPENED_KIND]: `AdminAuditEvent.fileOpened`,
  [ADMIN_FILE_DOWNLOADED_KIND]: `AdminAuditEvent.fileDownloaded`,
  [BLOG_AUDIT_KINDS.created]: `AdminAuditEvent.blogCreated`,
  [BLOG_AUDIT_KINDS.updated]: `AdminAuditEvent.blogUpdated`,
  [BLOG_AUDIT_KINDS.published]: `AdminAuditEvent.blogPublished`,
  [BLOG_AUDIT_KINDS.scheduled]: `AdminAuditEvent.blogScheduled`,
  [BLOG_AUDIT_KINDS.unscheduled]: `AdminAuditEvent.blogUnscheduled`,
  [BLOG_AUDIT_KINDS.unpublished]: `AdminAuditEvent.blogUnpublished`,
  [BLOG_AUDIT_KINDS.urlChanged]: `AdminAuditEvent.blogUrlChanged`,
  [BLOG_AUDIT_KINDS.deleted]: `AdminAuditEvent.blogDeleted`,
  [CONTACT_LINK_AUDIT_KINDS.created]: `AdminAuditEvent.contactLinkCreated`,
  [CONTACT_LINK_AUDIT_KINDS.updated]: `AdminAuditEvent.contactLinkUpdated`,
  [CONTACT_LINK_AUDIT_KINDS.deleted]: `AdminAuditEvent.contactLinkDeleted`,
  [CONTACT_LINK_AUDIT_KINDS.reordered]: `AdminAuditEvent.contactLinksReordered`,
  [CATALOG_AUDIT_KINDS.itemCreated]: `AdminAuditEvent.catalogItemCreated`,
  [CATALOG_AUDIT_KINDS.itemUpdated]: `AdminAuditEvent.catalogItemUpdated`,
  [CATALOG_AUDIT_KINDS.itemPublished]: `AdminAuditEvent.catalogItemPublished`,
  [CATALOG_AUDIT_KINDS.itemHidden]: `AdminAuditEvent.catalogItemHidden`,
  [CATALOG_AUDIT_KINDS.itemDeleted]: `AdminAuditEvent.catalogItemDeleted`,
  [CATALOG_AUDIT_KINDS.photoAdded]: `AdminAuditEvent.catalogPhotoAdded`,
  [CATALOG_AUDIT_KINDS.photoUpdated]: `AdminAuditEvent.catalogPhotoUpdated`,
  [CATALOG_AUDIT_KINDS.photoRemoved]: `AdminAuditEvent.catalogPhotoRemoved`,
  [CATALOG_AUDIT_KINDS.photosReordered]: `AdminAuditEvent.catalogPhotosReordered`,
  [CATALOG_AUDIT_KINDS.categoryCreated]: `AdminAuditEvent.catalogCategoryCreated`,
  [CATALOG_AUDIT_KINDS.categoryUpdated]: `AdminAuditEvent.catalogCategoryUpdated`,
  [CATALOG_AUDIT_KINDS.categoryDeleted]: `AdminAuditEvent.catalogCategoryDeleted`,
  [CATALOG_AUDIT_KINDS.categoriesReordered]: `AdminAuditEvent.catalogCategoriesReordered`,
  [CATALOG_AUDIT_KINDS.sourceCreated]: `AdminAuditEvent.catalogSourceCreated`,
  [CATALOG_AUDIT_KINDS.sourceUpdated]: `AdminAuditEvent.catalogSourceUpdated`,
  [CATALOG_AUDIT_KINDS.sourceDeleted]: `AdminAuditEvent.catalogSourceDeleted`,
  [CATALOG_AUDIT_KINDS.sourcesReordered]: `AdminAuditEvent.catalogSourcesReordered`,
  [CATALOG_AUDIT_KINDS.linkCreated]: `AdminAuditEvent.catalogLinkCreated`,
}

/**
 * What an entry's event is called, in the operator's language: one whole message per event code.
 * An event this page does not know shows its code. A sign-in or sign-up by e-mail link names the
 * method in the title (#391), from the entry's `identifier`.
 */
export function auditEventLabel(
  t: Translator<string>,
  event: string,
  identifier: string | null = null,
): string {
  const parsed = parseAuditEvent(event)
  if (!parsed) return event
  if (parsed.source === "account") {
    return auditEventTitle(t, parsed.eventType, identifier) ??
      t.t(`AdminAudit.accountEvent`, { code: String(parsed.eventType) })
  }
  const key = ACTIVITY_LABELS[parsed.kind]
  return key ? t.t(key) : parsed.kind
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
function eventOptions(t: Translator<string>): SelectOption[] {
  const label = (key: string, event: string | undefined, code: string) =>
    t.t(key, { event: event ? t.t(event) : code })
  return [
    ...Object.entries(AUDIT_EVENTS).map(([eventType, event]) => ({
      value: accountAuditEvent(Number(eventType)),
      label: label(`AdminAudit.optionAccount`, event, eventType),
    })),
    ...ACTIVITY_KINDS.map((kind) => ({
      value: activityAuditEvent(kind),
      label: label(`AdminAudit.optionGroup`, ACTIVITY_LABELS[kind], kind),
    })),
    ...ADMIN_OPERATOR_ACTIVITY_KINDS.map((kind) => ({
      value: activityAuditEvent(kind),
      label: label(`AdminAudit.optionOperator`, ACTIVITY_LABELS[kind], kind),
    })),
    ...Object.entries(BILLING_AUDIT_LABELS).map(([eventType, event]) => ({
      value: accountAuditEvent(Number(eventType)),
      label: label(`AdminAudit.optionOperator`, event, eventType),
    })),
  ]
}

/** "40 entries", "40+ entries match": how many entries the page holds, and whether more wait. */
function countKey(more: boolean, filtered: boolean): string {
  if (more) return filtered ? `AdminAudit.countMoreMatch` : `AdminAudit.countMore`
  return filtered ? `AdminAudit.countMatch` : `AdminAudit.count`
}

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
  const t = useAdminText()
  return (
    <Stack>
      <PageHeader
        title={t.t(`AdminAudit.title`)}
        subtitle={t.t(`AdminAudit.subtitle`)}
        titleDataE2E="admin-audit-title"
        action={
          <PageAction
            label={t.t(`AdminAudit.export`)}
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
            ? t.t(`AdminAudit.loading`)
            : t.t(countKey(props.hasMore, filtered), { count: entries.length })}
        </h2>
        <div data-e2e="admin-audit-view">
          <ToggleChips
            mode="single"
            label={t.t(`AdminAudit.view`)}
            options={VIEW_CHIPS.map((chip) => ({ value: chip.value, label: t.t(chip.key) }))}
            value={view}
            onChange={(next) => next && props.onView(next as AdminAuditView)}
          />
        </div>
      </div>

      {entries === null
        ? !error && (
          <div role="status" aria-label={t.t(`AdminAudit.loading`)} data-e2e="admin-audit-loading">
            <LoadingSkeleton rows={6} />
          </div>
        )
        : entries.length === 0
        ? (
          <Card data-e2e="admin-audit-empty">
            <EmptyState
              inset
              title={t.t(filtered ? `AdminAudit.nothingMatches` : `AdminAudit.nothingYet`)}
              description={t.t(
                filtered ? `AdminAudit.nothingMatchesHint` : `AdminAudit.nothingYetHint`,
              )}
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
            busyLabel={t.t(`AdminAudit.loadingMore`)}
            onClick={props.onMore}
          >
            {t.t(`AdminAudit.more`)}
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
  const t = useAdminText()
  const [draft, setDraft] = useState(filter)
  const set = (part: Partial<AdminAuditFilter>) => setDraft({ ...draft, ...part })
  const text = (event: Event) => (event.currentTarget as HTMLInputElement).value
  const operatorOptions: SelectOption[] = operators.map((operator) => ({
    value: String(operator.id),
    label: operator.email
      ? t.t(`AdminAudit.operatorOption`, { name: operator.name, email: operator.email })
      : operator.name,
  }))
  return (
    <div class="rounded-xl border border-subtle bg-surface p-4">
      <ScreenForm
        pending={pending}
        onSubmit={() => onFilter({ ...draft, person: draft.person.trim(), ip: draft.ip.trim() })}
      >
        <div class="flex flex-col gap-4" role="search" aria-label={t.t(`AdminAudit.filter`)}>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="admin-audit-event" label={t.t(`AdminAudit.event`)}>
              <Select
                name="event"
                data-e2e="admin-audit-event"
                options={eventOptions(t)}
                placeholder={t.t(`AdminAudit.everyEvent`)}
                value={draft.event ?? ""}
                onChange={(event) => set({ event: text(event) || null })}
              />
            </Field>
            <Field id="admin-audit-person" label={t.t(`AdminAudit.person`)}>
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
            <Field id="admin-audit-operator" label={t.t(`AdminAudit.operator`)}>
              <Select
                name="operator"
                data-e2e="admin-audit-operator"
                options={operatorOptions}
                placeholder={t.t(`AdminAudit.anyone`)}
                value={draft.operator === null ? "" : String(draft.operator)}
                onChange={(event) => {
                  const value = text(event)
                  set({ operator: value ? Number(value) : null })
                }}
              />
            </Field>
            <Field id="admin-audit-from" label={t.t(`AdminAudit.from`)}>
              <Input
                name="from"
                type="date"
                data-e2e="admin-audit-from"
                value={draft.from ?? ""}
                max={draft.to ?? undefined}
                onInput={(event) => set({ from: text(event) || null })}
              />
            </Field>
            <Field id="admin-audit-to" label={t.t(`AdminAudit.to`)}>
              <Input
                name="to"
                type="date"
                data-e2e="admin-audit-to"
                value={draft.to ?? ""}
                min={draft.from ?? undefined}
                onInput={(event) => set({ to: text(event) || null })}
              />
            </Field>
            <Field id="admin-audit-ip" label={t.t(`AdminAudit.ip`)}>
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
              busyLabel={t.t(`AdminAudit.filtering`)}
            >
              {t.t(`AdminAudit.apply`)}
            </Button>
            {isAdminAuditFiltered(filter) && (
              <Button
                type="button"
                variant="ghost"
                data-e2e="admin-audit-clear"
                onClick={() => onFilter(ADMIN_AUDIT_NO_FILTER)}
              >
                {t.t(`AdminAudit.clear`)}
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
  const t = useAdminText()
  if (!person) {
    return (
      <span class="text-muted">
        {entry.source === "account" ? t.t(`AdminAudit.deletedAccount`) : "—"}
      </span>
    )
  }
  return (
    <Link
      href={ADMIN_PATHS.user(person.id)}
      navigate={navigate}
      class={truncate ? "pc-link block truncate font-medium" : "pc-link font-medium wrap-anywhere"}
      title={truncate ? person.name : undefined}
      translate={false}
      data-e2e={`admin-audit-person-${person.id}`}
    >
      {person.name}
    </Link>
  )
}

/** What an entry names besides its people: the group, the method or token, the job. */
function detailOf(t: Translator<string>, entry: AdminAuditEntry): string | null {
  const event = parseAuditEvent(entry.event)
  const eventType = event?.source === "account" ? event.eventType : null
  const parts = [
    entry.group && t.t(`AdminAudit.detailGroup`, { name: entry.group.name }),
    // A link row's title already names the method.
    entry.identifier && !linkAuditTitle(eventType, entry.identifier) &&
    auditDetail(t, eventType, entry.identifier),
    entry.jobKind && t.t(`AdminAudit.detailJob`, { kind: entry.jobKind }),
    entry.fileName && t.t(`AdminAudit.detailFile`, { name: entry.fileName }),
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
    <span class="flex flex-col whitespace-nowrap">
      <Ago at={at} class="text-sm" />
      <span class="text-xs text-muted">{format.utc().exact(at)}</span>
    </span>
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
        <span class="truncate text-muted" title={person.email ?? undefined} translate={false}>
          {person.email}
        </span>
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
  const t = useAdminText()
  const name = (person: AdminAuditPerson | null) =>
    person?.name ?? (entry.source === "account" ? t.t(`AdminAudit.deletedAccount`) : null)
  const who = (text: string) => (
    <bdi class="font-medium text-foreground" translate={false}>{text}</bdi>
  )
  // An operator's billing action is about a group, which no person stands for.
  const about = entry.person === null && entry.group ? entry.group.name : name(entry.person)
  const by = selfDone(entry) ? null : name(entry.actor)
  if (!about && !by) return null
  return (
    <span class="text-muted wrap-anywhere sm:hidden" data-e2e="admin-audit-people-phone">
      {about && <Rich parts={t.parts(`AdminAudit.phoneAbout`, { about })} tags={{ who }} />}
      {about && by && " · "}
      {by && <Rich parts={t.parts(`AdminAudit.phoneBy`, { by })} tags={{ who }} />}
    </span>
  )
}

/**
 * The Detail column: at most two lines of the detail and two of the browser, 7rem wide from `sm`,
 * each with its full text in the tooltip. A token's detail names three ids, which would otherwise
 * make the row tall and push the IP address column off the page.
 */
function DetailCell({ entry }: { entry: AdminAuditEntry }): JSX.Element {
  const t = useAdminText()
  const detail = detailOf(t, entry)
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
  const t = useAdminText()
  const columns: DataTableColumn<AdminAuditEntry, never>[] = [
    { id: "at", header: t.t(`AdminAudit.when`), render: (entry) => <When at={entry.at} /> },
    {
      id: "event",
      header: t.t(`AdminAudit.event`),
      render: (entry) => (
        <Cell>
          <span class="font-medium" data-e2e="admin-audit-event-label">
            {auditEventLabel(t, entry.event, entry.identifier)}
          </span>
          {entry.byOperator && (
            <span>
              <Badge text={t.t(`AdminAudit.operatorBadge`)} color="blue" type="outline" />
            </span>
          )}
          <PhonePeople entry={entry} />
        </Cell>
      ),
    },
    {
      id: "person",
      header: t.t(`AdminAudit.about`),
      render: (entry) =>
        entry.person === null && entry.group
          ? (
            <Link
              href={ADMIN_GROUP_PATHS.group(entry.group.id)}
              navigate={navigate}
              class="pc-link block w-36 truncate text-sm font-medium"
              title={entry.group.name}
              translate={false}
            >
              {entry.group.name}
            </Link>
          )
          : <PersonCell entry={entry} person={entry.person} navigate={navigate} address />,
    },
    {
      id: "actor",
      header: t.t(`AdminAudit.doneBy`),
      render: (entry) =>
        selfDone(entry)
          ? <span class="text-sm text-muted">{t.t(`AdminAudit.themselves`)}</span>
          : <PersonCell entry={entry} person={entry.actor} navigate={navigate} />,
    },
    {
      id: "detail",
      header: t.t(`AdminAudit.detail`),
      render: (entry) => <DetailCell entry={entry} />,
    },
    {
      id: "ip",
      header: t.t(`AdminAudit.ipAddress`),
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
        caption={t.t(`AdminAudit.caption`)}
        captionHidden
        rowKey={(entry) => entry.key}
      />
    </div>
  )
}

function AuditTimeline(
  { entries, navigate }: { entries: readonly AdminAuditEntry[]; navigate?: Navigate },
): JSX.Element {
  const t = useAdminText()
  return (
    <div class="rounded-xl border border-subtle bg-surface p-4" data-e2e="admin-audit-timeline">
      <Timeline
        label={t.t(`AdminAudit.caption`)}
        items={entries.map((entry) => {
          const detail = detailOf(t, entry)
          return {
            id: entry.key,
            title: auditEventLabel(t, entry.event, entry.identifier),
            at: entry.at,
            when: <Ago at={entry.at} />,
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
                      <span class="text-muted">
                        <Rich
                          parts={t.parts(`AdminAudit.byActor`)}
                          tags={{
                            actor: () => (
                              <PersonLink entry={entry} person={entry.actor} navigate={navigate} />
                            ),
                          }}
                        />
                      </span>
                      {entry.byOperator && (
                        <Badge text={t.t(`AdminAudit.operatorBadge`)} color="blue" type="outline" />
                      )}
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
