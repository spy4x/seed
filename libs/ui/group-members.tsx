import type { ComponentChildren, JSX } from "preact"
import { useRef, useState } from "preact/hooks"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Card } from "@spy4x/preact-ui/card"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import type { PlanRefusal } from "@domain/billing"
import { assignableRoles, canRemoveMember, type GroupRole } from "@domain/groups"
import { pictureUrl } from "@domain/identity"
import { ROLE_TEXT } from "./groups-screen.tsx"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { useFreshError } from "@spy4x/preact-ui/use-fresh-error"
import { useFocusAfterRemoval } from "@spy4x/preact-ui/use-focus-after-removal"
import { MoreMenu } from "@spy4x/preact-ui/page-header"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import type { Navigate } from "./progressive.tsx"
import { When } from "@spy4x/preact-ui/format"

/** One member of a group as the members section shows them. */
export interface GroupMemberRow {
  userId: number
  /** First and last name; empty when the person has set none. */
  name: string
  /**
   * The address they sign in with, or `null` for an account without one. The API sends it only to
   * the owner and admins; for anyone else it is absent and the row shows no address.
   */
  email?: string | null
  /** Their profile picture (#228); `null` or absent for initials. */
  pictureId?: string | null
  role: GroupRole
  /**
   * When they were last active, as an ISO string, or `null` if not recorded. Like `email`, the API
   * sends it only to the owner and admins, so for anyone else the row shows nothing.
   */
  lastSeenAt?: string | null
  /** When they joined, as an ISO string. */
  joinedAt: string
  /** Whether this member is the person looking at the page. */
  isYou: boolean
}

/** What a member is called on the page: their name, else their address, else a placeholder. */
export function memberLabel(member: Pick<GroupMemberRow, "name" | "email">): string {
  return member.name.trim() || member.email || "Unnamed member"
}

/** A member change that was refused, shown under that member's row. */
export interface MemberError {
  userId: number
  message: string
  /** The group's plan refused the change: shown as an upgrade prompt in place of `message`. */
  plan?: PlanRefusal | null
}

export interface GroupMembersSectionProps {
  groupId: string
  /** The role of the person looking: it decides which actions each row's menu holds. */
  actorRole: GroupRole
  /** The members, oldest first; `null` while they are read. */
  members: readonly GroupMemberRow[] | null
  /**
   * How many members the group has. The list stops at 1,000, so this can be more than `members`;
   * the heading shows it, and a line under the list says it is cut off. Left out, the rows count.
   */
  memberCount?: number | null
  /** Why the members could not be read, or `null`. */
  error?: string | null
  /** The member whose role change or removal is in flight, or `null`. */
  pendingUserId?: number | null
  /** The last refused change, shown under its member's row, or `null`. */
  memberError?: MemberError | null
  /** Gives a member a new role. */
  onRoleChange?: (userId: number, role: GroupRole) => void
  /** Removes a member, once the person confirmed it. */
  onRemove?: (userId: number) => void
  /** Follows the upgrade link of a plan refusal; without it, the browser does. */
  navigate?: Navigate
  /** Drawn beside the heading: the section's one action, such as "Invite". */
  action?: ComponentChildren
  /** Drawn under the list: the pending invitations. */
  children?: ComponentChildren
}

/**
 * The members of a group, for every member to read: one row each with the avatar, the name and the
 * role. The owner and an admin find a menu on the rows of the members below them, to change the
 * role or remove the member; nobody changes the owner here.
 */
export function GroupMembersSection(
  {
    groupId,
    actorRole,
    members,
    memberCount = null,
    error = null,
    pendingUserId = null,
    memberError = null,
    onRoleChange,
    onRemove,
    navigate,
    action,
    children,
  }: GroupMembersSectionProps,
): JSX.Element {
  const total = members ? Math.max(memberCount ?? 0, members.length) : null
  const header = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  // A removed member's menu goes with their row: focus moves to the next row's menu, else to the
  // section's action ("Invite"), else to the heading.
  useFocusAfterRemoval(
    list,
    members?.map((member) => member.userId) ?? null,
    pendingUserId,
    {
      earlier: false,
      fallback: () =>
        header.current?.querySelector<HTMLElement>("a[href], button") ??
          header.current?.querySelector("h2"),
    },
  )
  return (
    // Drawn like the page's other `SettingGroup`s (the plan), with the one action beside the
    // heading that `SettingGroup` has no slot for.
    <section
      aria-labelledby="group-members"
      class="flex flex-col gap-3"
      data-e2e="group-section-members"
    >
      <div ref={header} class="flex min-h-11 items-center justify-between gap-3">
        <h2 id="group-members" class="text-sm font-semibold text-foreground" tabIndex={-1}>
          Members{total === null ? "" : ` (${total})`}
        </h2>
        {action}
      </div>
      {error
        ? <ErrorState message={error} />
        : members === null
        ? (
          <p class="text-sm text-muted" data-e2e="group-members-loading">
            Loading the members…
          </p>
        )
        : (
          <Card>
            <ul ref={list} class="divide-y divide-subtle">
              {members.map((member) => (
                <MemberItem
                  key={member.userId}
                  groupId={groupId}
                  actorRole={actorRole}
                  member={member}
                  pending={pendingUserId === member.userId}
                  error={memberError?.userId === member.userId ? memberError.message : null}
                  refusal={memberError?.userId === member.userId ? memberError.plan ?? null : null}
                  navigate={navigate}
                  onRoleChange={onRoleChange}
                  onRemove={onRemove}
                />
              ))}
            </ul>
          </Card>
        )}
      {members && total !== null && total > members.length && (
        <p class="text-sm text-muted" data-e2e="group-members-cut-off">
          Showing the first {members.length} of {total} members.
        </p>
      )}
      {children}
    </section>
  )
}

function MemberItem(
  { groupId, actorRole, member, pending, error, refusal, navigate, onRoleChange, onRemove }: {
    groupId: string
    actorRole: GroupRole
    member: GroupMemberRow
    pending: boolean
    error: string | null
    refusal: PlanRefusal | null
    navigate?: Navigate
    onRoleChange?: (userId: number, role: GroupRole) => void
    onRemove?: (userId: number) => void
  },
): JSX.Element {
  const label = memberLabel(member)
  const roles = assignableRoles(actorRole, member.role)
  const removable = canRemoveMember(actorRole, member.role)
  const [removing, setRemoving] = useState(false)
  useSucceeded(pending, error !== null, () => setRemoving(false))
  const [removeError, opened] = useFreshError(error, pending)

  return (
    <li
      class="flex min-h-14 flex-col justify-center gap-3 px-4 py-3 sm:px-6"
      data-e2e="group-member"
      data-user-id={member.userId}
    >
      <div class="flex min-w-0 items-center gap-3">
        <Avatar name={label} src={pictureUrl(member.pictureId)} alt="" size="sm" />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="flex min-w-0 items-center gap-2 text-sm">
            <span
              class="line-clamp-2 break-words font-medium"
              title={label}
              data-e2e="group-member-name"
            >
              {label}
            </span>
            {member.isYou && <span class="shrink-0 text-xs text-muted">you</span>}
          </span>
          {member.name.trim() && member.email && (
            <span class="truncate text-sm text-muted" title={member.email}>{member.email}</span>
          )}
          {member.lastSeenAt && (
            <span class="text-sm text-muted" data-e2e="group-member-last-seen">
              Last seen <When at={member.lastSeenAt} />
            </span>
          )}
        </div>
        <span class="shrink-0 text-sm text-muted" data-e2e="group-member-role">
          {pending ? "Saving…" : ROLE_TEXT[member.role]}
        </span>
        {roles.length > 0 || removable
          ? (
            <MoreMenu label={`Actions for ${label}`} dataE2E="group-member-menu">
              {roles.map((role) => (
                <DropdownItem
                  key={role}
                  disabled={pending}
                  dataE2E="group-member-make"
                  onClick={() => onRoleChange?.(member.userId, role)}
                >
                  Make {ROLE_TEXT[role]}
                </DropdownItem>
              ))}
              {removable && (
                <DropdownItem
                  danger
                  disabled={pending}
                  dataE2E="group-member-remove-open"
                  onClick={() => {
                    opened()
                    setRemoving(true)
                  }}
                >
                  Remove from group
                </DropdownItem>
              )}
            </MoreMenu>
          )
          // A row without a menu keeps its place, so every role lines up.
          : <span class="w-11 shrink-0 sm:w-9" aria-hidden="true" />}
      </div>
      {!removing && (refusal
        ? <PlanRefusalNotice groupId={groupId} refusal={refusal} navigate={navigate} />
        : <ErrorState focusOnAppear message={error} dataE2E="group-member-error" />)}
      {removing && (
        <ConfirmDialog
          title={`Remove ${label}?`}
          confirmLabel="Remove member"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="group-member-remove-dialog"
          onConfirm={() => {
            if (!pending) onRemove?.(member.userId)
          }}
          onCancel={() =>
            setRemoving(false)}
        >
          <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
              They lose access right away, on every device. What they wrote stays in the group. If
              this is their only group, they get a new empty one named "Personal". An invitation
              link they still hold lets them back in from another account, so revoke such links too.
            </p>
            <ErrorState focusOnAppear message={removeError} dataE2E="group-member-remove-error" />
          </div>
        </ConfirmDialog>
      )}
    </li>
  )
}
