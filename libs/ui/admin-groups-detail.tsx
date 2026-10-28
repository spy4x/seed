// deno-lint-ignore-file ui-text/no-literal
import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import { timeAgo } from "@spy4x/platform/universal/time"
import { IconEllipsisVertical } from "@spy4x/preact-icons"
import { type AttachmentItem, AttachmentList } from "@spy4x/preact-ui/attachment-list"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { Card } from "@spy4x/preact-ui/card"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { Pagination } from "@spy4x/preact-ui/pagination"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { Tabs } from "@spy4x/preact-ui/tabs"
import { Timeline, type TimelineTone } from "@spy4x/preact-ui/timeline"
import { BillingStatus } from "@domain/billing"
import {
  ADMIN_GROUP_FILE_SEARCH_MAX_LENGTH,
  ADMIN_GROUP_TRANSFER_ROLE,
  type AdminGroupActivityEvent,
  type AdminGroupDetail,
  type AdminGroupFile,
  type AdminGroupFileFilter,
  adminGroupFilePath,
  type AdminGroupFiles,
  type AdminGroupInvitation,
  type AdminGroupMember,
  type AdminInvitationState,
  describeActivity,
  GroupRole,
} from "@domain/groups"
import { ADMIN_PICTURE_PATH, pictureUrl, type UserRole } from "@domain/identity"
import { ADMIN_BILLING_PATHS } from "./admin-billing-list.tsx"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import {
  ADMIN_GROUP_PATHS,
  adminGroupPersonName,
  groupRoleLabel,
  planLabel,
} from "./admin-groups-list.tsx"
import { roleColor, roleLabel } from "./admin-users-screen.tsx"
import { GroupMark } from "./group-appearance.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { useFormat, When } from "@spy4x/preact-ui/format"

/** The signed-in operator, as far as the page needs them. */
export interface AdminGroupOperatorView {
  id: number
  role: UserRole
}

/** The dialog open on the group's page: which action, and on whom. */
export type AdminGroupDialog =
  | { kind: "remove"; userId: number }
  | { kind: "revoke"; invitationId: string }
  | { kind: "transfer" }
  | { kind: "removeFile"; fileId: string }

/** An action the operator confirmed, with everything the API needs for it. */
export type AdminGroupAction =
  | { kind: "remove"; userId: number }
  | { kind: "revoke"; invitationId: string }
  | { kind: "transfer"; userId: number }
  | { kind: "removeFile"; fileId: string }

/** The group page's tabs, in order. */
export const ADMIN_GROUP_TABS = [`members`, `invitations`, `files`, `activity`] as const

const NUMBER = new Intl.NumberFormat(`en`)

const BILLING_STATUS: Record<number, string> = {
  [BillingStatus.Trialing]: `Trialing`,
  [BillingStatus.Active]: `Active`,
  [BillingStatus.PastDue]: `Past due`,
  [BillingStatus.Canceled]: `Canceled`,
  [BillingStatus.Incomplete]: `Incomplete`,
  [BillingStatus.Paused]: `Paused`,
}

const INVITATION_STATES: Record<
  AdminInvitationState,
  { text: string; color: "green" | "gray" | "orange" | "red" }
> = {
  pending: { text: `Pending`, color: `green` },
  used: { text: `Used`, color: `gray` },
  expired: { text: `Expired`, color: `gray` },
  declined: { text: `Declined`, color: `orange` },
  revoked: { text: `Revoked`, color: `red` },
}

/** The menu button of a row: an icon, 44 pixels on a phone. */
const MENU_TRIGGER = buttonClasses(`icon`, `none`, `size-11 sm:size-9`)

/**
 * An activity entry's dot on the timeline: what removes access or a thing is a warning, what adds
 * one is good news. The sentence still says what happened, so the colour is never the only sign.
 */
export function activityTone(kind: string): TimelineTone {
  if (/(deleted|removed|revoked|left|declined|moved_out)$/.test(kind)) return `warning`
  if (/(created|restored|accepted|moved_in)$/.test(kind)) return `success`
  return `neutral`
}

/**
 * Whether the operator may act on `member`: never on themselves, and never on a person whose
 * product role is theirs or higher. The API decides the same on locked rows; this hides what it
 * would refuse.
 */
export function canActOnMember(
  operator: AdminGroupOperatorView,
  member: Pick<AdminGroupMember, "id" | "userRole">,
): boolean {
  return operator.id !== member.id && member.userRole < operator.role
}

/** The members the group may go to: everyone but the owner whom the operator may act on. */
export function transferCandidates(
  operator: AdminGroupOperatorView,
  members: readonly AdminGroupMember[],
): AdminGroupMember[] {
  return members.filter((member) =>
    member.role !== GroupRole.OWNER && canActOnMember(operator, member)
  )
}

export interface AdminGroupScreenProps {
  /** The group, or `null` while it loads or when it could not be read. */
  detail: AdminGroupDetail | null
  /** Why the group could not be read, or `null`. */
  error: string | null
  operator: AdminGroupOperatorView
  /** The tab shown: one of {@link ADMIN_GROUP_TABS}. */
  tab: string
  onTab: (tab: string) => void
  /** The open dialog, or `null`. */
  dialog: AdminGroupDialog | null
  onOpenDialog: (dialog: AdminGroupDialog) => void
  /** The operator closed the dialog: the app drops its error. */
  onCloseDialog: () => void
  /** Why the API refused the open dialog's action, shown in the dialog, or `null`. */
  actionError: string | null
  pending: boolean
  /** The operator confirmed the open dialog's action. */
  onAction: (action: AdminGroupAction) => void
  /** One page of the group's files, or `null` while it loads or when it could not be read. */
  files: AdminGroupFiles | null
  /** Why the files could not be read, or `null`. */
  filesError: string | null
  /** The Files tab's search and page, as the address holds them. */
  fileFilter: AdminGroupFileFilter
  /** A new search (on page 1) or another page of the files. */
  onFileFilter: (filter: AdminGroupFileFilter) => void
  /** Reads the same page of files again, after a failure. */
  onRetryFiles: () => void
  /** Saves the file to the operator's device through the admin API. */
  onDownloadFile: (file: AdminGroupFile) => void
  /** Why opening or downloading a file failed, such as a file someone removed, or `null`. */
  fileNotice: string | null
  /** The read-only "Overview widgets" section (`AdminGroupOverview`), under the header card. */
  overview?: ComponentChildren
  navigate?: Navigate
}

/**
 * One group in the admin app (#426): a header card with its owner, plan and counts, then tabs for
 * its members, its invitations, its files and its activity. An operator removes a member, revokes
 * an invitation or removes a file from the row's menu; a supervisor hands the group to another member from the page's
 * menu. Each is confirmed in a dialog and recorded in the group's activity with the operator's
 * name. Nothing written inside the group shows here but its files' names and their notes' titles,
 * which an operator needs to find a file a report names (#478).
 */
export function AdminGroupScreen(props: AdminGroupScreenProps): JSX.Element {
  const { detail, error, operator, navigate } = props
  const format = useFormat()
  const back = { href: ADMIN_GROUP_PATHS.list, label: `Groups` }

  if (!detail) {
    return (
      <Stack>
        <PageHeader title="Group" back={back} navigate={navigate} />
        {error
          ? <ErrorState message={error} dataE2E="admin-group-error" />
          : (
            <div role="status" aria-label="Loading the group">
              <LoadingSkeleton rows={4} />
            </div>
          )}
      </Stack>
    )
  }

  const { group, counts } = detail
  const deleted = group.deletedAt !== null
  const owner = detail.members.find((member) => member.role === GroupRole.OWNER)
  const candidates = transferCandidates(operator, detail.members)
  const canTransfer = !deleted && operator.role >= ADMIN_GROUP_TRANSFER_ROLE &&
    operator.id !== group.owner.id && (owner === undefined || owner.userRole < operator.role) &&
    candidates.length > 0
  const menu = canTransfer && (
    <DropdownItem
      dataE2E="admin-group-transfer-open"
      onClick={() => props.onOpenDialog({ kind: `transfer` })}
    >
      Transfer ownership
    </DropdownItem>
  )
  const pending = detail.invitations.filter((invitation) => invitation.state === `pending`)

  const tabs = [
    {
      id: `members`,
      label: <TabLabel text="Members" count={detail.members.length} />,
      content: <Members {...props} detail={detail} deleted={deleted} />,
    },
    {
      id: `invitations`,
      label: <TabLabel text="Invitations" count={pending.length} />,
      content: <Invitations {...props} detail={detail} deleted={deleted} />,
    },
    {
      id: `files`,
      label: <TabLabel text="Files" count={counts.files} />,
      content: <Files {...props} detail={detail} deleted={deleted} />,
    },
    {
      id: `activity`,
      label: `Activity`,
      content: <Activity events={detail.activity} />,
    },
  ]
  const active = tabs.some((tab) => tab.id === props.tab) ? props.tab : `members`

  return (
    <Stack>
      <PageHeader
        title={group.name}
        subtitle={`Owned by ${adminGroupPersonName(group.owner)}`}
        mark={<GroupMark color={group.color} emoji={group.emoji} />}
        back={back}
        navigate={navigate}
        menu={menu || undefined}
        menuDataE2E="admin-group-menu"
        titleDataE2E="admin-group-title"
      />
      <div
        class="flex flex-col gap-4 rounded-xl border border-subtle bg-surface p-4"
        data-e2e="admin-group-card"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span data-e2e="admin-group-status">
            {deleted
              ? <Badge text="In trash" color="red" />
              : <Badge text="Active" color="green" />}
          </span>
          <Badge
            text={`${planLabel(group.planId)} plan`}
            color={group.planId === `free` ? `gray` : `purple`}
            type="outline"
          />
          {detail.billing && (
            <Badge
              text={`Subscription ${BILLING_STATUS[detail.billing.status] ?? `unknown`}`.trim()}
              color={detail.billing.status === BillingStatus.PastDue ? `orange` : `gray`}
              type="outline"
            />
          )}
        </div>
        {/* The counts are facts like the dates: no card inside the header card. */}
        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4" data-e2e="admin-group-counts">
          <Fact label="Members">{NUMBER.format(detail.members.length)}</Fact>
          <Fact label="Notes">
            {NUMBER.format(counts.notes)}
            <span class="font-normal text-muted">
              {` · ${NUMBER.format(counts.deletedNotes)} in trash`}
            </span>
          </Fact>
          <Fact label="Tags">{NUMBER.format(counts.tags)}</Fact>
          <Fact label="Open invitations">{NUMBER.format(counts.pendingInvitations)}</Fact>
          <Fact label="Files">
            {NUMBER.format(counts.files)}
            <span class="font-normal text-muted">{` · ${formatBytes(counts.fileBytes)}`}</span>
          </Fact>
          <Fact label="Owner">
            <Link
              href={ADMIN_PATHS.user(group.owner.id)}
              navigate={navigate}
              class="pc-link"
              data-e2e="admin-group-owner"
            >
              {adminGroupPersonName(group.owner)}
            </Link>
          </Fact>
          <Fact label="Created">
            <When at={group.createdAt} />
          </Fact>
          {detail.imported && (
            <Fact label="Imported">
              <span data-e2e="admin-group-imported">
                <When at={detail.imported.at} />
                {detail.imported.by && (
                  <span class="font-normal text-muted">
                    {" by "}
                    <Link
                      href={ADMIN_PATHS.user(detail.imported.by.id)}
                      navigate={navigate}
                      class="pc-link"
                    >
                      {adminGroupPersonName(detail.imported.by)}
                    </Link>
                  </span>
                )}
              </span>
            </Fact>
          )}
          <Fact label="Last activity">
            {group.lastActivityAt ? <When at={group.lastActivityAt} /> : `None`}
          </Fact>
          <Fact label="Renews">
            {detail.billing?.currentPeriodEnd
              ? detail.billing.cancelAtPeriodEnd
                ? `Ends ${format.date(detail.billing.currentPeriodEnd)}`
                : format.date(detail.billing.currentPeriodEnd)
              : `No subscription`}
          </Fact>
          {detail.billing && (
            // The same subscription the owner sees on the group's Plan and billing tab.
            <Fact label="Billing">
              <Link
                href={ADMIN_BILLING_PATHS.customer(group.id)}
                navigate={navigate}
                class="pc-link"
                data-e2e="admin-group-billing"
              >
                Open the customer
              </Link>
            </Fact>
          )}
        </dl>
        {deleted && (
          <Notice tone="danger" data-e2e="admin-group-deleted-notice">
            In the trash since{" "}
            <When at={group.deletedAt!} />. Nothing in it changes until its owner restores it.
          </Notice>
        )}
      </div>

      {props.overview}

      {/* One row that scrolls sideways on a phone; the arrow keys still move between tabs. */}
      <Tabs
        tabs={tabs}
        active={active}
        onChange={props.onTab}
        lazy
        label="About this group"
        listClass="flex-nowrap overflow-x-auto pb-px"
        panelClass="pt-4"
        tabDataE2E="admin-group-tab"
      />

      {props.dialog && (
        <ActionDialog
          {...props}
          dialog={props.dialog}
          detail={detail}
          candidates={candidates}
        />
      )}
    </Stack>
  )
}

/** A tab's name with how many rows it holds. */
function TabLabel({ text, count }: { text: string; count: number }): JSX.Element {
  return (
    <span class="inline-flex items-center gap-2">
      {text}
      <span class="rounded-full bg-canvas px-2 text-xs text-muted">{count}</span>
    </span>
  )
}

/** One fact of the header card. */
function Fact({ label, children }: { label: string; children: ComponentChildren }): JSX.Element {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <dt class="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd class="truncate text-sm font-medium">{children}</dd>
    </div>
  )
}

const ROW = `flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3`

/** A list in the page's bordered style, or a card with one quiet line when it is empty. */
function Rows(
  { empty, dataE2E, children }: { empty: string; dataE2E: string; children: JSX.Element[] },
): JSX.Element {
  if (children.length === 0) {
    return (
      // The list's card with one quiet line in its body's place: no dashed box inside the page.
      <Card data-e2e={dataE2E}>
        <EmptyState inset description={empty} />
      </Card>
    )
  }
  return (
    <ul
      class="divide-y divide-subtle rounded-lg border border-subtle bg-surface"
      data-e2e={dataE2E}
    >
      {children}
    </ul>
  )
}

/** One row's menu: a single labelled button that opens its actions. */
function RowMenu(
  { label, dataE2E, children }: { label: string; dataE2E: string; children: ComponentChildren },
): JSX.Element {
  return (
    <div class="relative -my-2 -mr-2 ml-auto shrink-0">
      <Dropdown
        trigger={<IconEllipsisVertical class="size-5" />}
        triggerLabel={label}
        triggerClasses={MENU_TRIGGER}
        triggerDataE2E={dataE2E}
        horizontal="right"
      >
        {children}
      </Dropdown>
    </div>
  )
}

function Members(
  { detail, deleted, operator, onOpenDialog, navigate }: AdminGroupScreenProps & {
    detail: AdminGroupDetail
    deleted: boolean
  },
): JSX.Element {
  return (
    <Rows empty="No members." dataE2E="admin-group-members">
      {detail.members.map((member) => {
        const name = adminGroupPersonName(member)
        const removable = !deleted && member.role !== GroupRole.OWNER &&
          canActOnMember(operator, member)
        return (
          <li key={member.id} class={ROW} data-e2e={`admin-group-member-${member.id}`}>
            <Avatar name={name} src={pictureUrl(member.pictureId, ADMIN_PICTURE_PATH)} size="sm" />
            <div class="flex min-w-0 flex-1 basis-48 flex-col">
              <Link
                href={ADMIN_PATHS.user(member.id)}
                navigate={navigate}
                class="pc-link font-medium wrap-anywhere"
              >
                {name}
              </Link>
              {member.email && member.name && (
                <span class="text-sm text-muted wrap-anywhere">{member.email}</span>
              )}
            </div>
            <Cluster gap="sm">
              <Badge
                text={groupRoleLabel(member.role)}
                color={member.role === GroupRole.OWNER ? `purple` : `gray`}
                type="outline"
              />
              {member.userRole > 1 && (
                <Badge text={roleLabel(member.userRole)} color={roleColor(member.userRole)} />
              )}
              {member.blocked && <Badge text="Blocked" color="red" />}
              {member.id === operator.id && <Badge text="You" color="gray" type="outline" />}
            </Cluster>
            <span class="text-xs text-muted">
              Joined <When at={member.joinedAt} />
            </span>
            {removable && (
              <RowMenu label={`Actions for ${name}`} dataE2E="admin-group-member-menu">
                <DropdownItem
                  danger
                  dataE2E="admin-group-remove-open"
                  onClick={() => onOpenDialog({ kind: `remove`, userId: member.id })}
                >
                  Remove from group
                </DropdownItem>
              </RowMenu>
            )}
          </li>
        )
      })}
    </Rows>
  )
}

/** Who made the invitation and for whom: an address, or a link anyone may use. */
function invitationTitle(invitation: AdminGroupInvitation): string {
  return invitation.email ?? `Link anyone can use`
}

function Invitations(
  { detail, deleted, onOpenDialog }: AdminGroupScreenProps & {
    detail: AdminGroupDetail
    deleted: boolean
  },
): JSX.Element {
  return (
    <Rows empty="No invitations." dataE2E="admin-group-invitations">
      {detail.invitations.map((invitation) => {
        const state = INVITATION_STATES[invitation.state]
        const title = invitationTitle(invitation)
        return (
          <li key={invitation.id} class={ROW} data-e2e={`admin-group-invitation-${invitation.id}`}>
            <div class="flex min-w-0 flex-1 basis-48 flex-col">
              <span class="font-medium wrap-anywhere">{title}</span>
              <span class="text-sm text-muted">
                {invitation.createdBy
                  ? `By ${adminGroupPersonName(invitation.createdBy)}, `
                  : `By a deleted account, `}
                <When at={invitation.createdAt} />
                {` · used ${invitation.uses} of ${invitation.maxUses}`}
              </span>
            </div>
            <Cluster gap="sm">
              <Badge text={groupRoleLabel(invitation.role)} color="gray" type="outline" />
              <span data-e2e="admin-group-invitation-state">
                <Badge text={state.text} color={state.color} />
              </span>
            </Cluster>
            {invitation.state === `pending` && (
              <span class="text-xs text-muted">
                Expires <When at={invitation.expiresAt} />
              </span>
            )}
            {invitation.state === `pending` && !deleted && (
              <RowMenu
                label={`Actions for the invitation ${title}`}
                dataE2E="admin-group-invitation-menu"
              >
                <DropdownItem
                  danger
                  dataE2E="admin-group-revoke-open"
                  onClick={() => onOpenDialog({ kind: `revoke`, invitationId: invitation.id })}
                >
                  Revoke invitation
                </DropdownItem>
              </RowMenu>
            )}
          </li>
        )
      })}
    </Rows>
  )
}

/** "37 of 100 files · 41 MB of 200 MB", or without "of" for a cap the plan does not set. */
function filesUsage(usage: AdminGroupFiles["usage"]): string {
  const files = usage.maxFiles === null
    ? `${NUMBER.format(usage.files)} files`
    : `${NUMBER.format(usage.files)} of ${NUMBER.format(usage.maxFiles)} files`
  const bytes = usage.maxBytes === null
    ? formatBytes(usage.bytes)
    : `${formatBytes(usage.bytes)} of ${formatBytes(usage.maxBytes)}`
  return `${files} · ${bytes}`
}

/** The images a browser may show on the admin host; the API serves any other file as a download. */
const SHOWN_TYPES = new Set([`image/jpeg`, `image/png`, `image/webp`, `image/gif`])

/** The longest file name or note title a sentence quotes before it is cut with "…". */
const QUOTE_MAX = 48

/** `text` cut to {@link QUOTE_MAX} characters, with "…" when it was longer. */
export function clipped(text: string): string {
  return text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX).trimEnd()}…` : text
}

/**
 * Where a file sits and who put it there, after its kind and size: "Ada Lovelace · 3 Oct 2026 ·
 * in “Trip receipts”", "(in trash)" after a note in the trash.
 */
export function fileDetail(file: AdminGroupFile, date: string): string {
  const uploader = file.uploader ? adminGroupPersonName(file.uploader) : `A deleted account`
  const note = file.noteTitle.trim()
    ? `in “${clipped(file.noteTitle.trim())}”`
    : `in an untitled note`
  return `${uploader} · ${date} · ${note}${file.noteDeleted ? ` (in trash)` : ``}`
}

/** "90 files", "3 files match “receipt”", "No files match “xyz”". */
export function filesCount(files: Pick<AdminGroupFiles, "total" | "query">): string {
  const { total, query } = files
  if (!query) return `${NUMBER.format(total)} ${total === 1 ? `file` : `files`}`
  if (total === 0) return `No files match “${query}”`
  return `${NUMBER.format(total)} ${total === 1 ? `file matches` : `files match`} “${query}”`
}

/** The id of the Files tab's search field, where focus goes when the last file of a page leaves. */
const FILE_SEARCH_ID = `admin-group-files-q`

/**
 * The group's files (#478): a search by name, how many match, one page of rows with a thumbnail
 * or a file icon, the name and where the file sits, then the pages and the group's room. An image
 * opens in the lightbox and any other file downloads; each row's menu downloads or removes it. An
 * operator sees the names and the notes' titles so they can find the file a report names.
 */
function Files(
  props: AdminGroupScreenProps & { detail: AdminGroupDetail; deleted: boolean },
): JSX.Element {
  const { files, filesError, fileFilter, detail, deleted, dialog, pending } = props
  const format = useFormat()
  const count = useRef<HTMLParagraphElement>(null)
  const search = useRef<HTMLDivElement>(null)

  // After a page change the rows are new: the reader starts again at the count above them.
  const page = files?.page
  const shown = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (page === undefined) return
    if (shown.current !== undefined && shown.current !== page) count.current?.focus()
    shown.current = page
  }, [page])

  // A group with no file has nothing to search: the search, the count and the pages stay away.
  const none = (files?.usage.files ?? detail.counts.files) === 0
  const groupId = detail.group.id
  const items: AttachmentItem[] = (files?.files ?? []).map((file) => {
    const image = SHOWN_TYPES.has(file.contentType.toLowerCase())
    return {
      id: file.id,
      name: file.name,
      size: file.size,
      type: file.contentType,
      status: `ready`,
      thumbnailSrc: image ? adminGroupFilePath(groupId, file.id, `thumbnail`) : undefined,
      src: image ? adminGroupFilePath(groupId, file.id, `open`) : undefined,
      detail: fileDetail(file, format.date(file.createdAt)),
    }
  })
  const byId = new Map((files?.files ?? []).map((file) => [file.id, file]))
  const removingId = dialog?.kind === `removeFile` && pending ? dialog.fileId : null

  // A removal that empties the list unmounts it, and with it the row focus would move to: focus
  // goes to the search field instead, or to the empty state once the group has no file at all.
  const removing = useRef(false)
  const empty = useRef<HTMLDivElement>(null)
  const emptied = files !== null && items.length === 0
  if (removingId !== null) removing.current = true
  useEffect(() => {
    if (!removing.current || removingId !== null) return
    removing.current = false
    if (!emptied) return
    const field = search.current?.querySelector<HTMLElement>(`#${FILE_SEARCH_ID}`)
    ;(field ?? empty.current)?.focus()
  }, [removingId, emptied])

  const body = (() => {
    if (!files) {
      return filesError
        ? (
          <Stack gap="sm" class="items-start" data-e2e="admin-group-files-error">
            <ErrorState message="Could not load the files. Check your connection, then try again." />
            <Button variant="secondary" onClick={props.onRetryFiles}>Try again</Button>
          </Stack>
        )
        : (
          <div role="status" aria-label="Loading the files">
            <LoadingSkeleton rows={3} />
          </div>
        )
    }
    if (none) {
      return (
        <div ref={empty} tabIndex={-1} class="rounded-xl">
          <Card data-e2e="admin-group-files">
            <EmptyState inset description="No files yet." />
          </Card>
        </div>
      )
    }
    if (items.length === 0) {
      return (
        <Card data-e2e="admin-group-files">
          <EmptyState
            inset
            title="No files match"
            description="Try part of the name, or clear the search."
          />
        </Card>
      )
    }
    return (
      <div data-e2e="admin-group-files">
        <AttachmentList
          id="admin-group-files"
          items={items}
          labels={{ list: `Files`, removeItem: `Remove file` }}
          onDownload={(item) => {
            const file = byId.get(item.id)
            if (file) props.onDownloadFile(file)
          }}
          onRemove={deleted
            ? undefined
            : (item) => props.onOpenDialog({ kind: `removeFile`, fileId: item.id })}
          removingId={removingId}
          focusAfterLast={() => search.current?.querySelector<HTMLElement>(`#${FILE_SEARCH_ID}`)}
        />
      </div>
    )
  })()

  return (
    <Stack gap="sm">
      {!none && (
        <div ref={search}>
          <ScreenForm
            pending={files === null && !filesError}
            onSubmit={(data) =>
              props.onFileFilter({ query: String(data.get(`q`) ?? ``).trim(), page: 1 })}
          >
            {/* Keyed by the query, so going back in history shows the search that page had. */}
            <div
              key={fileFilter.query}
              class="flex flex-wrap items-end gap-3"
              role="search"
              aria-label="Search the files"
            >
              <div class="min-w-0 flex-1 basis-48 sm:max-w-md">
                <Field id={FILE_SEARCH_ID} label="File name">
                  <Input
                    name="q"
                    type="search"
                    data-e2e="admin-group-files-search"
                    defaultValue={fileFilter.query}
                    maxLength={ADMIN_GROUP_FILE_SEARCH_MAX_LENGTH}
                    autocomplete="off"
                  />
                </Field>
              </div>
              <Button
                type="submit"
                data-e2e="admin-group-files-submit"
                busy={files === null && !filesError}
                busyLabel="Searching…"
              >
                Search
              </Button>
            </div>
          </ScreenForm>
        </div>
      )}
      {!none && files && (
        <p
          ref={count}
          tabIndex={-1}
          role="status"
          class="text-sm text-muted focus:outline-none"
          data-e2e="admin-group-files-count"
        >
          {filesCount(files)}
        </p>
      )}
      {props.fileNotice && (
        <Notice tone="danger" data-e2e="admin-group-file-notice">{props.fileNotice}</Notice>
      )}
      {body}
      {files && files.total > files.pageSize && (
        <Pagination
          page={files.page}
          pageCount={Math.ceil(files.total / files.pageSize)}
          onChange={(next) => props.onFileFilter({ query: files.query, page: next })}
          label="Pages of files"
          class="self-center"
        />
      )}
      {files && (
        <p class="text-sm text-muted" data-e2e="admin-group-files-usage">
          {filesUsage(files.usage)}
        </p>
      )}
    </Stack>
  )
}

/** The newest entries of the group's activity log, newest first, on a timeline. */
function Activity({ events }: { events: readonly AdminGroupActivityEvent[] }): JSX.Element {
  return (
    <Timeline
      label="Activity"
      empty="Nothing recorded."
      dataE2E="admin-group-activity"
      items={events.map((event) => ({
        id: event.id,
        title: describeActivity(event),
        at: event.at,
        when: timeAgo(event.at),
        description: event.byOperator ? `By an operator, from the admin area` : undefined,
        tone: activityTone(event.kind),
        dataE2E: `admin-group-event-${event.kind}`,
      }))}
    />
  )
}

/** Each dialog's copy: its title, what it does, and its button. */
function dialogCopy(
  dialog: AdminGroupDialog,
  detail: AdminGroupDetail,
  files: AdminGroupFiles | null,
): { title: string; text: string; submit: string; busy: string } {
  switch (dialog.kind) {
    case `remove`: {
      const member = detail.members.find((row) => row.id === dialog.userId)
      const name = member ? adminGroupPersonName(member) : `this member`
      return {
        title: `Remove ${name}?`,
        text:
          `${name} loses access to ${detail.group.name} at once, with their API tokens and the invitations they made for it. What they wrote stays in the group. They get a notice.`,
        submit: `Remove`,
        busy: `Removing…`,
      }
    }
    case `revoke`:
      return {
        title: `Revoke this invitation?`,
        text:
          `Nobody can join ${detail.group.name} with it any more. People who already joined stay.`,
        submit: `Revoke`,
        busy: `Revoking…`,
      }
    case `removeFile`: {
      const file = files?.files.find((row) => row.id === dialog.fileId)
      return {
        title: file ? `Remove “${clipped(file.name)}”?` : `Remove this file?`,
        text:
          `The members of ${detail.group.name} will no longer see it. Its note stays. The group's activity records that the support team removed it.`,
        submit: `Remove file`,
        busy: `Removing…`,
      }
    }
    case `transfer`:
      return {
        title: `Transfer ${detail.group.name}`,
        text: `The member you pick becomes the owner and gets a notice. ${
          adminGroupPersonName(detail.group.owner)
        } stays in the group as an admin. A subscription that still renews must be canceled by its owner first.`,
        submit: `Transfer`,
        busy: `Transferring…`,
      }
  }
}

/** The dialog of one action: what it does, the choice a transfer needs, and its button. */
function ActionDialog(
  { dialog, detail, files, candidates, actionError, pending, onAction, onCloseDialog }:
    & AdminGroupScreenProps
    & { dialog: AdminGroupDialog; detail: AdminGroupDetail; candidates: AdminGroupMember[] },
): JSX.Element {
  const copy = dialogCopy(dialog, detail, files)
  return (
    <Modal
      open
      onClose={onCloseDialog}
      title={copy.title}
      cancelLabel="Close"
      tone="danger"
      dataE2E="admin-group-dialog"
    >
      <ScreenForm
        pending={pending}
        onSubmit={(data) => {
          if (dialog.kind === `transfer`) {
            const userId = Number(data.get(`userId`))
            if (Number.isInteger(userId) && userId > 0) onAction({ kind: `transfer`, userId })
            return
          }
          onAction(dialog)
        }}
      >
        <Stack>
          <p class="text-sm text-muted">{copy.text}</p>
          {dialog.kind === `transfer` && (
            <RadioGroup
              legend="New owner"
              name="userId"
              required
              data-e2e="admin-group-transfer-choice"
              options={candidates.map((member) => ({
                value: member.id,
                label: `${adminGroupPersonName(member)} (${groupRoleLabel(member.role)})`,
              }))}
            />
          )}
          <ErrorState message={actionError} dataE2E="admin-group-dialog-error" />
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onCloseDialog}>Cancel</Button>
            <Button
              type="submit"
              variant="danger"
              data-e2e="admin-group-action-submit"
              busy={pending}
              busyLabel={copy.busy}
            >
              {copy.submit}
            </Button>
          </DialogActions>
        </Stack>
      </ScreenForm>
    </Modal>
  )
}
