import type { ComponentChildren, JSX } from "preact"
import { timeAgo } from "@spy4x/platform/universal/time"
import { Kpi, KpiGrid } from "@spy4x/preact-charts/kpi"
import { IconEllipsisVertical } from "@spy4x/preact-icons"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { Tabs } from "@spy4x/preact-ui/tabs"
import { Timeline, type TimelineTone } from "@spy4x/preact-ui/timeline"
import { BillingStatus } from "@domain/billing"
import {
  ADMIN_GROUP_TRANSFER_ROLE,
  type AdminGroupActivityEvent,
  type AdminGroupDetail,
  type AdminGroupInvitation,
  type AdminGroupMember,
  type AdminInvitationState,
  describeActivity,
  GroupRole,
} from "@domain/groups"
import type { UserRole } from "@domain/identity"
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

/** An action the operator confirmed, with everything the API needs for it. */
export type AdminGroupAction =
  | { kind: "remove"; userId: number }
  | { kind: "revoke"; invitationId: string }
  | { kind: "transfer"; userId: number }

/** The group page's tabs, in order. */
export const ADMIN_GROUP_TABS = [`members`, `invitations`, `activity`] as const

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
  navigate?: Navigate
}

/**
 * One group in the admin app (#426): a header card with its owner, plan and counts, then tabs for
 * its members, its invitations and its activity. An operator removes a member or revokes an
 * invitation from the row's menu; a supervisor hands the group to another member from the page's
 * menu. Each is confirmed in a dialog and recorded in the group's activity with the operator's
 * name. Nothing written inside the group shows here: counts only.
 */
export function AdminGroupScreen(props: AdminGroupScreenProps): JSX.Element {
  const { detail, error, operator, navigate } = props
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
        <section aria-label="Counts" data-e2e="admin-group-counts">
          <KpiGrid minWidth="9rem">
            <Kpi label="Members" value={NUMBER.format(detail.members.length)} tone="accent" />
            <Kpi
              label="Notes"
              value={NUMBER.format(counts.notes)}
              sub={`${NUMBER.format(counts.deletedNotes)} in trash`}
            />
            <Kpi label="Tags" value={NUMBER.format(counts.tags)} />
            <Kpi label="Open invitations" value={NUMBER.format(counts.pendingInvitations)} />
          </KpiGrid>
        </section>
        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
          <Fact label="Last activity">
            {group.lastActivityAt ? <When at={group.lastActivityAt} /> : `None`}
          </Fact>
          <Fact label="Renews">
            {detail.billing?.currentPeriodEnd
              ? detail.billing.cancelAtPeriodEnd
                ? `Ends ${new Date(detail.billing.currentPeriodEnd).toLocaleDateString()}`
                : new Date(detail.billing.currentPeriodEnd).toLocaleDateString()
              : `No subscription`}
          </Fact>
        </dl>
        {deleted && (
          <Notice tone="danger" data-e2e="admin-group-deleted-notice">
            In the trash since{" "}
            <When at={group.deletedAt!} />. Nothing in it changes until its owner restores it.
          </Notice>
        )}
      </div>

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

/** A moment as "3 days ago", with the exact time for a machine and on hover. */
function When({ at }: { at: string }): JSX.Element {
  return <time dateTime={at} title={new Date(at).toLocaleString()}>{timeAgo(at)}</time>
}

const ROW = `flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3`

/** A list in the page's bordered style, or one quiet line when it is empty. */
function Rows(
  { empty, dataE2E, children }: { empty: string; dataE2E: string; children: JSX.Element[] },
): JSX.Element {
  if (children.length === 0) {
    return (
      <p
        class="rounded-lg border border-dashed border-subtle px-4 py-6 text-center text-sm text-muted"
        data-e2e={dataE2E}
      >
        {empty}
      </p>
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
            <Avatar name={name} size="sm" />
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
  { dialog, detail, candidates, actionError, pending, onAction, onCloseDialog }:
    & AdminGroupScreenProps
    & { dialog: AdminGroupDialog; detail: AdminGroupDetail; candidates: AdminGroupMember[] },
): JSX.Element {
  const copy = dialogCopy(dialog, detail)
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
          <Cluster justify="end">
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
          </Cluster>
        </Stack>
      </ScreenForm>
    </Modal>
  )
}
