import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { formatBytes } from "@spy4x/platform/universal/format-number"
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
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

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

/** Each subscription state's word, by catalog key. */
const BILLING_STATUS: Record<number, string> = {
  [BillingStatus.Trialing]: `AdminGroup.statusTrialing`,
  [BillingStatus.Active]: `AdminGroup.statusActive`,
  [BillingStatus.PastDue]: `AdminGroup.statusPastDue`,
  [BillingStatus.Canceled]: `AdminGroup.statusCanceled`,
  [BillingStatus.Incomplete]: `AdminGroup.statusIncomplete`,
  [BillingStatus.Paused]: `AdminGroup.statusPaused`,
}

/** Each invitation state's word (a catalog key) and colour. */
const INVITATION_STATES: Record<
  AdminInvitationState,
  { key: string; color: "green" | "gray" | "orange" | "red" }
> = {
  pending: { key: `AdminGroup.pending`, color: `green` },
  used: { key: `AdminGroup.used`, color: `gray` },
  expired: { key: `AdminGroup.expired`, color: `gray` },
  declined: { key: `AdminGroup.declined`, color: `orange` },
  revoked: { key: `AdminGroup.revoked`, color: `red` },
}

/** A user value inside a sentence: isolated for right-to-left text and never machine-translated. */
function isolated(text: string): JSX.Element {
  return <bdi translate={false}>{text}</bdi>
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
  const t = useAdminText()
  const back = { href: ADMIN_GROUP_PATHS.list, label: t.t(`AdminGroups.title`) }

  if (!detail) {
    return (
      <Stack>
        <PageHeader title={t.t(`AdminGroup.title`)} back={back} navigate={navigate} />
        {error
          ? <ErrorState message={error} dataE2E="admin-group-error" />
          : (
            <div role="status" aria-label={t.t(`AdminGroup.loading`)}>
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
      {t.t(`AdminGroup.transfer`)}
    </DropdownItem>
  )
  const pending = detail.invitations.filter((invitation) => invitation.state === `pending`)

  const tabs = [
    {
      id: `members`,
      label: <TabLabel text={t.t(`AdminGroup.members`)} count={detail.members.length} />,
      content: <Members {...props} detail={detail} deleted={deleted} />,
    },
    {
      id: `invitations`,
      label: <TabLabel text={t.t(`AdminGroup.invitations`)} count={pending.length} />,
      content: <Invitations {...props} detail={detail} deleted={deleted} />,
    },
    {
      id: `files`,
      label: <TabLabel text={t.t(`AdminGroup.files`)} count={counts.files} />,
      content: <Files {...props} detail={detail} deleted={deleted} />,
    },
    {
      id: `activity`,
      label: t.t(`AdminGroup.activity`),
      content: <Activity events={detail.activity} />,
    },
  ]
  const active = tabs.some((tab) => tab.id === props.tab) ? props.tab : `members`

  return (
    <Stack>
      <PageHeader
        title={group.name}
        subtitle={t.t(`AdminGroup.ownedBy`, { owner: adminGroupPersonName(t, group.owner) })}
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
              ? <Badge text={t.t(`AdminGroup.inTrash`)} color="red" />
              : <Badge text={t.t(`AdminGroup.active`)} color="green" />}
          </span>
          <Badge
            text={t.t(`AdminGroup.planBadge`, { plan: planLabel(t, group.planId) })}
            color={group.planId === `free` ? `gray` : `purple`}
            type="outline"
          />
          {detail.billing && (
            <Badge
              text={t.t(`AdminGroup.subscription`, {
                status: t.t(BILLING_STATUS[detail.billing.status] ?? `AdminGroup.statusUnknown`),
              })}
              color={detail.billing.status === BillingStatus.PastDue ? `orange` : `gray`}
              type="outline"
            />
          )}
        </div>
        {/* The counts are facts like the dates: no card inside the header card. */}
        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4" data-e2e="admin-group-counts">
          <Fact label={t.t(`AdminGroup.members`)}>{NUMBER.format(detail.members.length)}</Fact>
          <Fact label={t.t(`AdminGroup.notes`)}>
            {NUMBER.format(counts.notes)}
            <span class="font-normal text-muted">
              {` · `}
              {t.t(`AdminGroup.notesInTrash`, { count: counts.deletedNotes })}
            </span>
          </Fact>
          <Fact label={t.t(`AdminGroup.tags`)}>{NUMBER.format(counts.tags)}</Fact>
          <Fact label={t.t(`AdminGroup.openInvitations`)}>
            {NUMBER.format(counts.pendingInvitations)}
          </Fact>
          <Fact label={t.t(`AdminGroup.files`)}>
            {NUMBER.format(counts.files)}
            <span class="font-normal text-muted">{` · ${formatBytes(counts.fileBytes)}`}</span>
          </Fact>
          <Fact label={t.t(`AdminGroup.owner`)}>
            <Link
              href={ADMIN_PATHS.user(group.owner.id)}
              navigate={navigate}
              class="pc-link"
              translate={false}
              data-e2e="admin-group-owner"
            >
              {adminGroupPersonName(t, group.owner)}
            </Link>
          </Fact>
          <Fact label={t.t(`AdminGroup.created`)}>
            <When at={group.createdAt} />
          </Fact>
          {detail.imported && (
            <Fact label={t.t(`AdminGroup.imported`)}>
              <span data-e2e="admin-group-imported">
                {detail.imported.by
                  ? (
                    <Rich
                      parts={t.parts(`AdminGroup.importedBy`, {
                        name: adminGroupPersonName(t, detail.imported.by),
                      })}
                      tags={{
                        when: () => <When at={detail.imported!.at} />,
                        person: (name: string) => (
                          <Link
                            href={ADMIN_PATHS.user(detail.imported!.by!.id)}
                            navigate={navigate}
                            class="pc-link font-normal"
                            translate={false}
                          >
                            {name}
                          </Link>
                        ),
                      }}
                    />
                  )
                  : <When at={detail.imported.at} />}
              </span>
            </Fact>
          )}
          <Fact label={t.t(`AdminGroup.lastActivity`)}>
            {group.lastActivityAt ? <When at={group.lastActivityAt} /> : t.t(`AdminGroup.none`)}
          </Fact>
          <Fact label={t.t(`AdminGroup.renews`)}>
            {detail.billing?.currentPeriodEnd
              ? detail.billing.cancelAtPeriodEnd
                ? t.t(`AdminGroup.endsOn`, { date: format.date(detail.billing.currentPeriodEnd) })
                : format.date(detail.billing.currentPeriodEnd)
              : t.t(`AdminGroup.noSubscription`)}
          </Fact>
          {detail.billing && (
            // The same subscription the owner sees on the group's Plan and billing tab.
            <Fact label={t.t(`AdminGroup.billing`)}>
              <Link
                href={ADMIN_BILLING_PATHS.customer(group.id)}
                navigate={navigate}
                class="pc-link"
                data-e2e="admin-group-billing"
              >
                {t.t(`AdminGroup.openCustomer`)}
              </Link>
            </Fact>
          )}
        </dl>
        {deleted && (
          <Notice tone="danger" data-e2e="admin-group-deleted-notice">
            <Rich
              parts={t.parts(`AdminGroup.deletedNotice`)}
              tags={{ when: () => <When at={group.deletedAt!} /> }}
            />
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
        label={t.t(`AdminGroup.about`)}
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
  const t = useAdminText()
  return (
    <Rows empty={t.t(`AdminGroup.noMembers`)} dataE2E="admin-group-members">
      {detail.members.map((member) => {
        const name = adminGroupPersonName(t, member)
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
                translate={false}
              >
                {name}
              </Link>
              {member.email && member.name && (
                <span class="text-sm text-muted wrap-anywhere" translate={false}>
                  {member.email}
                </span>
              )}
            </div>
            <Cluster gap="sm">
              <Badge
                text={groupRoleLabel(t, member.role)}
                color={member.role === GroupRole.OWNER ? `purple` : `gray`}
                type="outline"
              />
              {member.userRole > 1 && (
                <Badge text={roleLabel(t, member.userRole)} color={roleColor(member.userRole)} />
              )}
              {member.blocked && <Badge text={t.t(`AdminGroup.blocked`)} color="red" />}
              {member.id === operator.id && (
                <Badge text={t.t(`AdminGroup.you`)} color="gray" type="outline" />
              )}
            </Cluster>
            <span class="text-xs text-muted">
              <Rich
                parts={t.parts(`AdminGroup.joined`)}
                tags={{ when: () => <When at={member.joinedAt} /> }}
              />
            </span>
            {removable && (
              <RowMenu
                label={t.t(`AdminGroup.memberActions`, { name })}
                dataE2E="admin-group-member-menu"
              >
                <DropdownItem
                  danger
                  dataE2E="admin-group-remove-open"
                  onClick={() => onOpenDialog({ kind: `remove`, userId: member.id })}
                >
                  {t.t(`AdminGroup.removeFromGroup`)}
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
function invitationTitle(t: Translator<string>, invitation: AdminGroupInvitation): string {
  return invitation.email ?? t.t(`AdminGroup.anyoneLink`)
}

function Invitations(
  { detail, deleted, onOpenDialog }: AdminGroupScreenProps & {
    detail: AdminGroupDetail
    deleted: boolean
  },
): JSX.Element {
  const t = useAdminText()
  return (
    <Rows empty={t.t(`AdminGroup.noInvitations`)} dataE2E="admin-group-invitations">
      {detail.invitations.map((invitation) => {
        const state = INVITATION_STATES[invitation.state]
        const title = invitationTitle(t, invitation)
        return (
          <li key={invitation.id} class={ROW} data-e2e={`admin-group-invitation-${invitation.id}`}>
            <div class="flex min-w-0 flex-1 basis-48 flex-col">
              <span
                class="font-medium wrap-anywhere"
                translate={invitation.email ? false : undefined}
              >
                {title}
              </span>
              <span class="text-sm text-muted">
                <Rich
                  parts={invitation.createdBy
                    ? t.parts(`AdminGroup.invitedBy`, {
                      name: adminGroupPersonName(t, invitation.createdBy),
                      uses: invitation.uses,
                      max: invitation.maxUses,
                    })
                    : t.parts(`AdminGroup.invitedByDeleted`, {
                      uses: invitation.uses,
                      max: invitation.maxUses,
                    })}
                  tags={{ when: () => <When at={invitation.createdAt} /> }}
                />
              </span>
            </div>
            <Cluster gap="sm">
              <Badge text={groupRoleLabel(t, invitation.role)} color="gray" type="outline" />
              <span data-e2e="admin-group-invitation-state">
                <Badge text={t.t(state.key)} color={state.color} />
              </span>
            </Cluster>
            {invitation.state === `pending` && (
              <span class="text-xs text-muted">
                <Rich
                  parts={t.parts(`AdminGroup.expires`)}
                  tags={{ when: () => <When at={invitation.expiresAt} /> }}
                />
              </span>
            )}
            {invitation.state === `pending` && !deleted && (
              <RowMenu
                label={t.t(`AdminGroup.invitationActions`, { title })}
                dataE2E="admin-group-invitation-menu"
              >
                <DropdownItem
                  danger
                  dataE2E="admin-group-revoke-open"
                  onClick={() => onOpenDialog({ kind: `revoke`, invitationId: invitation.id })}
                >
                  {t.t(`AdminGroup.revokeInvitation`)}
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
function filesUsage(t: Translator<string>, usage: AdminGroupFiles["usage"]): string {
  const files = usage.maxFiles === null
    ? t.t(`AdminGroup.usageFiles`, { count: usage.files })
    : t.t(`AdminGroup.usageFilesOf`, { files: usage.files, count: usage.maxFiles })
  const bytes = usage.maxBytes === null
    ? formatBytes(usage.bytes)
    : t.t(`AdminGroup.usageBytesOf`, {
      used: formatBytes(usage.bytes),
      max: formatBytes(usage.maxBytes),
    })
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
export function fileDetail(t: Translator<string>, file: AdminGroupFile, date: string): string {
  const uploader = file.uploader
    ? adminGroupPersonName(t, file.uploader)
    : t.t(`AdminGroup.deletedAccount`)
  const title = clipped(file.noteTitle.trim())
  const key = title
    ? file.noteDeleted ? `AdminGroup.fileInNoteTrash` : `AdminGroup.fileInNote`
    : file.noteDeleted
    ? `AdminGroup.fileInUntitledTrash`
    : `AdminGroup.fileInUntitled`
  return t.t(key, { uploader, date, title })
}

/** "90 files", "3 files match “receipt”", "No files match “xyz”". */
export function filesCount(
  t: Translator<string>,
  files: Pick<AdminGroupFiles, "total" | "query">,
): string {
  const { total, query } = files
  if (!query) return t.t(`AdminGroup.filesTotal`, { count: total })
  if (total === 0) return t.t(`AdminGroup.noFilesMatchQuery`, { query })
  return t.t(`AdminGroup.filesMatch`, { count: total, query })
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
  const t = useAdminText()
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
      detail: fileDetail(t, file, format.date(file.createdAt)),
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
            <ErrorState message={t.t(`AdminGroup.filesError`)} />
            <Button variant="secondary" onClick={props.onRetryFiles}>
              {t.t(`AdminGroup.retry`)}
            </Button>
          </Stack>
        )
        : (
          <div role="status" aria-label={t.t(`AdminGroup.loadingFiles`)}>
            <LoadingSkeleton rows={3} />
          </div>
        )
    }
    if (none) {
      return (
        <div ref={empty} tabIndex={-1} class="rounded-xl">
          <Card data-e2e="admin-group-files">
            <EmptyState inset description={t.t(`AdminGroup.noFilesYet`)} />
          </Card>
        </div>
      )
    }
    if (items.length === 0) {
      return (
        <Card data-e2e="admin-group-files">
          <EmptyState
            inset
            title={t.t(`AdminGroup.noFilesMatch`)}
            description={t.t(`AdminGroup.noFilesMatchHint`)}
          />
        </Card>
      )
    }
    return (
      <div data-e2e="admin-group-files">
        <AttachmentList
          id="admin-group-files"
          items={items}
          labels={{ list: t.t(`AdminGroup.files`), removeItem: t.t(`AdminGroup.removeFile`) }}
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
              aria-label={t.t(`AdminGroup.searchFiles`)}
            >
              <div class="min-w-0 flex-1 basis-48 sm:max-w-md">
                <Field id={FILE_SEARCH_ID} label={t.t(`AdminGroup.fileName`)}>
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
                busyLabel={t.t(`AdminGroup.searching`)}
              >
                {t.t(`AdminGroup.search`)}
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
          {filesCount(t, files)}
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
          label={t.t(`AdminGroup.filePages`)}
          class="self-center"
        />
      )}
      {files && (
        <p class="text-sm text-muted" data-e2e="admin-group-files-usage">
          {filesUsage(t, files.usage)}
        </p>
      )}
    </Stack>
  )
}

/** The newest entries of the group's activity log, newest first, on a timeline. */
function Activity({ events }: { events: readonly AdminGroupActivityEvent[] }): JSX.Element {
  const t = useAdminText()
  return (
    <Timeline
      label={t.t(`AdminGroup.activity`)}
      empty={t.t(`AdminGroup.nothingRecorded`)}
      dataE2E="admin-group-activity"
      items={events.map((event) => ({
        id: event.id,
        title: describeActivity(event),
        at: event.at,
        when: <When at={event.at} />,
        description: event.byOperator ? t.t(`AdminGroup.byOperator`) : undefined,
        tone: activityTone(event.kind),
        dataE2E: `admin-group-event-${event.kind}`,
      }))}
    />
  )
}

/** Each dialog's copy, in the operator's language: its title, what it does, and its button. */
function dialogCopy(
  t: Translator<string>,
  dialog: AdminGroupDialog,
  detail: AdminGroupDetail,
  files: AdminGroupFiles | null,
): { title: string; text: ComponentChildren; submit: string; busy: string } {
  const group = detail.group.name
  const sentence = (key: string, values: Record<string, string> = {}) => (
    <Rich parts={t.parts(key, { group, ...values })} tags={{ group: isolated, name: isolated }} />
  )
  switch (dialog.kind) {
    case `remove`: {
      const member = detail.members.find((row) => row.id === dialog.userId)
      const name = member ? adminGroupPersonName(t, member) : null
      return {
        title: name === null
          ? t.t(`AdminGroup.removeTitleUnknown`)
          : t.t(`AdminGroup.removeTitle`, { name }),
        text: name === null
          ? sentence(`AdminGroup.removeTextUnknown`)
          : sentence(`AdminGroup.removeText`, { name }),
        submit: t.t(`AdminGroup.removeSubmit`),
        busy: t.t(`AdminGroup.removing`),
      }
    }
    case `revoke`:
      return {
        title: t.t(`AdminGroup.revokeTitle`),
        text: sentence(`AdminGroup.revokeText`),
        submit: t.t(`AdminGroup.revokeSubmit`),
        busy: t.t(`AdminGroup.revoking`),
      }
    case `removeFile`: {
      const file = files?.files.find((row) => row.id === dialog.fileId)
      return {
        title: file
          ? t.t(`AdminGroup.removeFileTitle`, { name: clipped(file.name) })
          : t.t(`AdminGroup.removeFileTitleUnknown`),
        text: sentence(`AdminGroup.removeFileText`),
        submit: t.t(`AdminGroup.removeFile`),
        busy: t.t(`AdminGroup.removing`),
      }
    }
    case `transfer`:
      return {
        title: t.t(`AdminGroup.transferTitle`, { group }),
        text: sentence(`AdminGroup.transferText`, {
          name: adminGroupPersonName(t, detail.group.owner),
        }),
        submit: t.t(`AdminGroup.transferSubmit`),
        busy: t.t(`AdminGroup.transferring`),
      }
  }
}

/** The dialog of one action: what it does, the choice a transfer needs, and its button. */
function ActionDialog(
  { dialog, detail, files, candidates, actionError, pending, onAction, onCloseDialog }:
    & AdminGroupScreenProps
    & { dialog: AdminGroupDialog; detail: AdminGroupDetail; candidates: AdminGroupMember[] },
): JSX.Element {
  const t = useAdminText()
  const copy = dialogCopy(t, dialog, detail, files)
  return (
    <Modal
      open
      onClose={onCloseDialog}
      title={copy.title}
      cancelLabel={t.t(`AdminGroup.close`)}
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
              legend={t.t(`AdminGroup.newOwner`)}
              name="userId"
              required
              data-e2e="admin-group-transfer-choice"
              options={candidates.map((member) => ({
                value: member.id,
                label: t.t(`AdminGroup.candidate`, {
                  name: adminGroupPersonName(t, member),
                  role: groupRoleLabel(t, member.role),
                }),
              }))}
            />
          )}
          <ErrorState message={actionError} dataE2E="admin-group-dialog-error" />
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onCloseDialog}>
              {t.t(`AdminGroup.cancel`)}
            </Button>
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
