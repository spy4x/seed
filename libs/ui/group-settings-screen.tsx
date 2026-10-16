import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconArrowRight, IconPlus } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { InlineEdit } from "@spy4x/preact-ui/inline-edit"
import { Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import {
  canDelete,
  canLeave,
  canManageInvitations,
  canMutateNotes,
  canRename,
  canViewActivity,
  GROUP_RESTORE_DAYS,
  type GroupDetails,
  GroupRole,
} from "@domain/groups"
import { GroupDetailsForm, GroupMark } from "./group-appearance.tsx"
import { type GroupRow, ROLE_TEXT } from "./groups-screen.tsx"
import { type GroupMemberRow, GroupMembersSection, type MemberError } from "./group-members.tsx"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { useFreshError } from "@spy4x/preact-ui/use-fresh-error"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { transferCandidates } from "./group-transfer.tsx"
import type { PlanRefusal } from "@domain/billing"
import { GroupMoveAllForm, type MoveAllResult } from "./group-move-all.tsx"
import { type MoveTarget, NavigateItem } from "./notes-screen.tsx"
import { GROUP_PATHS, type Navigate, SCREEN_PATHS } from "./progressive.tsx"

export interface GroupSettingsScreenProps {
  /** The group, or `null` while it is read or when the person has no such group. */
  group: GroupRow | null
  /** Whether this group is the one the notes show now. */
  selected: boolean
  /** The group is being read: an unknown group is not "missing" yet. */
  loading: boolean
  /** Why the group could not be read, or `null`. Shown instead of "loading" or "missing". */
  error?: string | null
  /** Follows a link without a page load; without it every link is an ordinary one. */
  navigate?: Navigate
  /** Opens the group's notes: selects the group, then shows `/notes`. */
  onOpen?: (groupId: string) => void
  /**
   * Renames the group, from the name in the header, which an admin or the owner edits in place. A
   * rejection keeps the field open with the error's message under it.
   */
  onRename?: (name: string) => Promise<void>
  /**
   * Saves the group's description, colour and emoji, from the "Edit details" dialog in the header
   * menu, which whoever may rename the group sees. A rejection keeps the dialog open with the
   * error's message in it.
   */
  onUpdateDetails?: (details: GroupDetails) => Promise<void>
  /**
   * This is the only group the person has, so they can neither leave nor delete it: the menu says
   * so beside the disabled item. The server refuses both too.
   */
  isLastGroup?: boolean
  /**
   * The group has a subscription that is not cancelled, so it can be neither deleted nor transferred
   * until the owner cancels it in the billing portal: the menu says so beside the disabled items.
   */
  hasSubscription?: boolean
  /** A delete is in flight. */
  deleting?: boolean
  /** Why the delete was refused, shown in its dialog, or `null`. */
  deleteError?: string | null
  /** Deletes the group, once the owner confirmed it. */
  onDelete?: () => void
  /** The members, oldest first; `null` while they are read. */
  members?: readonly GroupMemberRow[] | null
  /** How many members the group has; see `GroupMembersSectionProps.memberCount`. */
  memberCount?: number | null
  /** Why the members could not be read, or `null`. */
  membersError?: string | null
  /** The member whose role change or removal is in flight, or `null`. */
  memberPendingId?: number | null
  /** The last refused member change, shown under that member, or `null`. */
  memberError?: MemberError | null
  /** Gives a member a new role. */
  onRoleChange?: (userId: number, role: GroupRole) => void
  /** Removes a member, once the person confirmed it. */
  onRemoveMember?: (userId: number) => void
  /** A leave is in flight. */
  leaving?: boolean
  /** Why the leave was refused, shown in its dialog, or `null`. */
  leaveError?: string | null
  /** Leaves the group, once the person confirmed it. */
  onLeave?: () => void
  /** The plan section (`BillingCard`), drawn under the members; left out, there is none. */
  billing?: ComponentChildren
  /**
   * The body of the "Invite people" dialog (`InviteForm`), given the function that closes it. Left
   * out, or for a member who may not invite, there is no "Invite people" button.
   */
  invite?: (close: () => void) => ComponentChildren
  /** The pending invitations (`PendingInvitations`), drawn under the members. */
  pendingInvitations?: ComponentChildren
  /**
   * The body of the "Transfer ownership" dialog (`GroupTransferForm`), given the function that
   * closes it. The menu offers it to the owner of a group with someone to hand it to.
   */
  transfer?: (close: () => void) => ComponentChildren
  /**
   * The groups the person may write to, other than this one. The menu offers "Move all data to..."
   * to an editor or above, and only when there is a group to move to and `onMoveAll` is given.
   */
  moveTargets?: readonly MoveTarget[]
  /** Moves every note of the group to the chosen group. */
  onMoveAll?: (toGroupId: string) => void
  /** A move of all the data is in flight. */
  movingAll?: boolean
  /** Why the move was refused, shown in its dialog, or `null`. */
  moveAllError?: string | null
  /** The target group's plan refused the move; shown in the dialog as the plan notice. */
  moveAllRefusal?: PlanRefusal | null
  /** The finished move, shown in its dialog with the choice to delete the group; or `null`. */
  moveAllResult?: MoveAllResult | null
  /** The person picked another target in the move dialog: the app forgets the refusal. */
  onMoveAllTargetChange?: () => void
  /** The move dialog closed: the app forgets the finished move and any error. */
  onMoveAllClose?: () => void
}

/** Which of the header menu's dialogs is open. */
enum Dialog {
  TRANSFER = 1,
  LEAVE = 2,
  DELETE = 3,
  DETAILS = 4,
  MOVE_ALL = 5,
}

/**
 * One group's settings. The header holds the name, which an admin or the owner renames in place,
 * the person's role, "Open notes", and a "More actions" menu with what the person can do to the
 * group as a whole: transfer it, leave it or delete it, each behind a dialog. Under it come the
 * members, with "Invite people" and the pending invitations, then the plan.
 */
export function GroupSettingsScreen(
  {
    group,
    selected,
    loading,
    error = null,
    navigate,
    onOpen,
    onRename,
    onUpdateDetails,
    isLastGroup = false,
    hasSubscription = false,
    deleting = false,
    deleteError = null,
    onDelete,
    members = null,
    memberCount = null,
    membersError = null,
    memberPendingId = null,
    memberError = null,
    onRoleChange,
    onRemoveMember,
    leaving = false,
    leaveError = null,
    onLeave,
    billing,
    invite,
    pendingInvitations,
    transfer,
    moveTargets = [],
    onMoveAll,
    movingAll = false,
    moveAllError = null,
    moveAllResult = null,
    moveAllRefusal = null,
    onMoveAllClose,
    onMoveAllTargetChange,
  }: GroupSettingsScreenProps,
): JSX.Element {
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [inviting, setInviting] = useState(false)
  const close = () => {
    if (dialog === Dialog.MOVE_ALL) onMoveAllClose?.()
    setDialog(null)
  }
  useSucceeded(leaving, leaveError !== null, close)
  useSucceeded(deleting, deleteError !== null, close)
  const [freshLeaveError, leaveOpened] = useFreshError(leaveError, leaving)
  const [freshDeleteError, deleteOpened] = useFreshError(deleteError, deleting)
  // A transfer that went through makes the person an admin, and the owner's dialog goes with the
  // role. Focus goes to the menu that opened it, where a closed dialog would have put it.
  const header = useRef<HTMLDivElement>(null)
  const handedOver = dialog === Dialog.TRANSFER && group != null && group.role !== GroupRole.OWNER
  useEffect(() => {
    if (!handedOver) return
    setDialog(null)
    header.current?.querySelector<HTMLElement>("[data-e2e=group-menu]")?.focus()
  }, [handedOver])

  const back = { href: SCREEN_PATHS.groups, label: "Back to groups" }
  if (!group) {
    return (
      <Stack gap="xl">
        <PageHeader title="Group" back={back} navigate={navigate} />
        {error ? <ErrorState message={error} /> : (
          <Card>
            <EmptyState
              inset
              title={loading ? "Loading the group..." : "This group does not exist."}
              description={loading
                ? undefined
                : "It may have been deleted, or you are not a member."}
            />
          </Card>
        )}
      </Stack>
    )
  }

  // Only the owner has candidates: `transferCandidates` asks `canTransfer`, which needs the owner.
  const canHandOver = transfer !== undefined &&
    transferCandidates(group.role, members).length > 0
  const subscriptionBlocks = hasSubscription ? "Cancel its subscription first" : null
  const deleteBlocked = isLastGroup ? "It is your only group" : subscriptionBlocks

  const canMoveAll = onMoveAll !== undefined && moveTargets.length > 0 &&
    canMutateNotes(group.role)

  const menu = (
    <>
      {canViewActivity(group.role) && (
        <NavigateItem
          href={GROUP_PATHS.activity(group.id)}
          navigate={navigate}
          dataE2E="group-activity-open"
        >
          Activity
        </NavigateItem>
      )}
      {canRename(group.role) && onUpdateDetails && (
        <DropdownItem
          dataE2E="group-details-open"
          onClick={() => setDialog(Dialog.DETAILS)}
        >
          Edit details
        </DropdownItem>
      )}
      {canHandOver && (
        <DropdownItem
          disabled={subscriptionBlocks !== null}
          dataE2E="group-transfer-open"
          onClick={() => setDialog(Dialog.TRANSFER)}
        >
          <MenuText
            text="Transfer ownership"
            hint={subscriptionBlocks}
            hintDataE2E="group-transfer-why"
          />
        </DropdownItem>
      )}
      {canMoveAll && (
        <DropdownItem
          dataE2E="group-move-all-open"
          onClick={() => setDialog(Dialog.MOVE_ALL)}
        >
          Move all data to...
        </DropdownItem>
      )}
      {canLeave(group.role) && (
        <DropdownItem
          danger
          disabled={isLastGroup}
          dataE2E="group-leave-open"
          onClick={() => {
            leaveOpened()
            setDialog(Dialog.LEAVE)
          }}
        >
          <MenuText
            text="Leave group"
            hint={isLastGroup ? "It is your only group" : null}
            hintDataE2E="group-leave-why"
          />
        </DropdownItem>
      )}
      {canDelete(group.role) && (
        <DropdownItem
          danger
          disabled={deleteBlocked !== null}
          dataE2E="group-delete-open"
          onClick={() => {
            deleteOpened()
            setDialog(Dialog.DELETE)
          }}
        >
          <MenuText text="Delete group" hint={deleteBlocked} hintDataE2E="group-delete-why" />
        </DropdownItem>
      )}
    </>
  )

  return (
    <Stack gap="xl">
      <div ref={header}>
        <PageHeader
          title={group.name}
          titleDataE2E="group-general-name"
          heading={canRename(group.role) && onRename
            ? (
              <InlineEdit
                value={group.name}
                onSave={onRename}
                editLabel={(name) => `Rename ${name}`}
                savingLabel="Renaming..."
                errorMessage={(reason) =>
                  reason instanceof Error ? reason.message : "Could not rename the group."}
                class="-ml-2 align-middle [&>button]:text-xl [&>button]:font-semibold sm:[&>button]:text-2xl"
              />
            )
            : undefined}
          mark={<GroupMark color={group.color} emoji={group.emoji} />}
          subtitle={
            <>
              <span data-e2e="group-general-role">{ROLE_TEXT[group.role]}</span>
              {selected && <span data-e2e="group-current">&nbsp;· your current group</span>}
            </>
          }
          back={back}
          navigate={navigate}
          action={
            <PageAction
              label="Open notes"
              Icon={IconArrowRight}
              variant="outline"
              onClick={() => onOpen?.(group.id)}
              dataE2E="group-open"
            />
          }
          menu={menu}
          menuDataE2E="group-menu"
        />
      </div>

      {group.description && (
        <p class="whitespace-pre-line text-sm" data-e2e="group-general-description">
          {group.description}
        </p>
      )}

      <GroupMembersSection
        groupId={group.id}
        actorRole={group.role}
        members={members}
        memberCount={memberCount}
        error={membersError}
        pendingUserId={memberPendingId}
        memberError={memberError}
        onRoleChange={onRoleChange}
        onRemove={onRemoveMember}
        navigate={navigate}
        action={invite && canManageInvitations(group.role) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="min-h-11 sm:min-h-9"
            data-e2e="invite-open"
            onClick={() => setInviting(true)}
          >
            <IconPlus class="size-4" aria-hidden="true" />
            Invite people
          </Button>
        )}
      >
        {pendingInvitations}
      </GroupMembersSection>

      {billing}

      {inviting && invite && (
        <Modal
          open
          title="Invite people"
          cancelLabel="Close"
          closeOnBackdrop={false}
          onClose={() => setInviting(false)}
          dataE2E="invite-dialog"
        >
          {invite(() => setInviting(false))}
        </Modal>
      )}

      {dialog === Dialog.DETAILS && onUpdateDetails && (
        <Modal
          open
          title="Edit details"
          cancelLabel="Close"
          closeOnBackdrop={false}
          onClose={close}
          dataE2E="group-details-dialog"
        >
          <GroupDetailsForm
            initial={{
              description: group.description ?? "",
              color: group.color ?? null,
              emoji: group.emoji ?? null,
            }}
            onSave={async (details) => {
              await onUpdateDetails(details)
              close()
            }}
            onCancel={close}
          />
        </Modal>
      )}

      {dialog === Dialog.TRANSFER && canHandOver && (
        <Modal
          open
          title={`Transfer "${group.name}"`}
          cancelLabel="Close"
          closeOnBackdrop={false}
          onClose={close}
          dataE2E="group-transfer-dialog"
        >
          {transfer(close)}
        </Modal>
      )}

      {dialog === Dialog.MOVE_ALL && canMoveAll && (
        <Modal
          open
          title={`Move all data of "${group.name}"`}
          cancelLabel="Close"
          closeOnBackdrop={false}
          onClose={close}
          dataE2E="group-move-all-dialog"
        >
          <GroupMoveAllForm
            groupName={group.name}
            targets={moveTargets}
            moving={movingAll}
            error={moveAllError}
            refusal={moveAllRefusal}
            navigate={navigate}
            result={moveAllResult}
            onMove={onMoveAll}
            onTargetChange={onMoveAllTargetChange}
            onCancel={close}
            onDelete={canDelete(group.role) && deleteBlocked === null
              ? () => {
                onMoveAllClose?.()
                deleteOpened()
                setDialog(Dialog.DELETE)
              }
              : undefined}
          />
        </Modal>
      )}

      {dialog === Dialog.LEAVE && (
        <ConfirmDialog
          title={`Leave "${group.name}"?`}
          confirmLabel="Leave group"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="group-leave-dialog"
          onConfirm={() => {
            if (!leaving) onLeave?.()
          }}
          onCancel={close}
        >
          <div class="flex flex-col gap-4">
            <p class="text-sm text-muted" data-e2e="group-leave-confirmation">
              You lose access right away, on every device. What you wrote stays in the group. To
              come back, someone must add you again.
            </p>
            <ErrorState focusOnAppear message={freshLeaveError} dataE2E="group-leave-error" />
          </div>
        </ConfirmDialog>
      )}

      {dialog === Dialog.DELETE && (
        <ConfirmDialog
          title={`Delete "${group.name}"?`}
          confirmLabel="Delete group"
          cancelLabel="Cancel"
          tone="danger"
          dataE2E="group-delete-dialog"
          onConfirm={() => {
            if (!deleting) onDelete?.()
          }}
          onCancel={close}
        >
          <div class="flex flex-col gap-4">
            <p class="text-sm text-muted" data-e2e="group-delete-confirmation">
              It disappears for every member right away, with all its notes. Members who have it
              open are switched to another of their groups, and anyone left with no group gets a new
              empty one named "Personal". You can restore it from the Groups page for{" "}
              {GROUP_RESTORE_DAYS}{" "}
              days. After that it and all its notes are deleted for good and cannot be recovered.
            </p>
            <ErrorState focusOnAppear message={freshDeleteError} dataE2E="group-delete-error" />
          </div>
        </ConfirmDialog>
      )}
    </Stack>
  )
}

/** A menu item's label, with a short line under it that says why the item is disabled. */
function MenuText(
  { text, hint, hintDataE2E }: { text: string; hint: string | null; hintDataE2E: string },
): JSX.Element {
  return (
    <span class="flex flex-col items-start gap-1 text-left">
      <span>{text}</span>
      {hint && <span class="text-xs text-muted" data-e2e={hintDataE2E}>{hint}</span>}
    </span>
  )
}
