import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { GroupSettingsScreen } from "@ui/group-settings-screen.tsx"
import { InviteForm, PendingInvitations } from "@ui/group-invitations.tsx"
import { GroupTransferForm } from "@ui/group-transfer.tsx"
import {
  canManageInvitations,
  type GroupDetails,
  type GroupRole,
  type InvitationErrorCode,
} from "@domain/groups"
import { entitlementsOf } from "@domain/billing"
import type { GroupRow } from "@ui/groups-screen.tsx"
import { moveTargetsOf } from "@ui/notes-screen.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { membersStore } from "../state/members.ts"
import { selectionStore } from "../state/selection.ts"
import { billingStore } from "../state/billing.ts"
import { invitationsStore } from "../state/invitations.ts"
import { SeatPriceConfirm } from "@ui/billing-screen.tsx"
import { GroupBillingCard } from "./BillingViews.tsx"

/**
 * Hands the open group over. When it worked, the groups are read again: this person is an admin
 * now, and the groups list holds their role. Resolves to whether the transfer worked.
 */
export async function transferAndRefresh(
  team: Pick<typeof membersStore, "transfer">,
  groups: Pick<typeof groupsStore, "refreshFromUser">,
): Promise<boolean> {
  const moved = await team.transfer()
  if (moved) await groups.refreshFromUser()
  return moved
}

/**
 * Renames the group to `name` through the store. Rejects with the store's message when the server
 * refused, so the name in the header stays open with the message under it.
 */
export async function renameGroup(
  groups: Pick<typeof groupsStore, "renameDraft" | "rename" | "actionError">,
  groupId: string,
  name: string,
): Promise<void> {
  groups.renameDraft.value = { groupId, name }
  if (await groups.rename(groupId)) return
  const failure = groups.actionError.value
  throw new Error(
    failure?.groupId === groupId && failure.action === "rename"
      ? failure.message
      : "Could not rename the group.",
  )
}

/**
 * Saves the group's description, colour and emoji through the store. Rejects with the store's
 * message when the server refused, so the dialog stays open with it.
 */
export async function updateGroupDetails(
  groups: Pick<typeof groupsStore, "updateDetails" | "actionError">,
  groupId: string,
  details: GroupDetails,
): Promise<void> {
  if (await groups.updateDetails(groupId, details)) return
  const failure = groups.actionError.value
  throw new Error(
    failure?.groupId === groupId && failure.action === "details"
      ? failure.message
      : "Could not save the details.",
  )
}

/** The open group's plan, once the billing card has read it; `null` until then. */
function billingOf(groupId: string) {
  const current = billingStore.current.value
  return current?.groupId === groupId ? current.billing : null
}

/**
 * The "Invite people" dialog's body, wired to the invitations store. The role choice follows the
 * group's plan once it is read; until then the server alone judges the role.
 */
export function GroupInvite(
  { groupId, actorRole, onClose, navigate }: {
    groupId: string
    actorRole: GroupRole
    onClose: () => void
    navigate?: Navigate
  },
) {
  const invites = invitationsStore
  const createFailure = invites.createError.value
  const billing = billingOf(groupId)
  // A create refused for want of the price confirmation shows its message at the confirmation, when
  // the confirmation is on screen; until the billing is read, it shows under the form.
  const seatRefused = !!billing?.seatPrice &&
    createFailure?.code === ("SEAT_PRICE_NOT_ACCEPTED" satisfies InvitationErrorCode)
  return (
    <InviteForm
      groupId={groupId}
      actorRole={actorRole}
      memberRoles={billing
        ? entitlementsOf(billing.planId, billing.enabled).features.memberRoles
        : true}
      draft={invites.draft.value}
      onDraftChange={(draft) => (invites.draft.value = draft)}
      creating={invites.creating.value}
      createError={createFailure?.plan || seatRefused ? null : createFailure?.message}
      createRefusal={createFailure?.plan ?? null}
      onCreate={() => void invites.create()}
      seatPrice={billing?.seatPrice && (
        <SeatPriceConfirm
          seatPrice={billing.seatPrice}
          checked={invites.acceptSeatPrice.value}
          onChange={(checked) => (invites.acceptSeatPrice.value = checked)}
          error={seatRefused ? createFailure.message : null}
        />
      )}
      created={invites.created.value}
      onClose={onClose}
      navigate={navigate}
    />
  )
}

/** The "Transfer ownership" dialog's body, wired to the members store. */
export function GroupTransfer(
  { groupId, group, onClose }: { groupId: string; group: GroupRow; onClose: () => void },
) {
  const team = membersStore
  const ours = team.groupId.value === groupId
  return (
    <GroupTransferForm
      groupName={group.name}
      role={group.role}
      members={ours ? team.members.value : null}
      draft={team.transferDraft.value}
      onDraftChange={(next) => (team.transferDraft.value = next)}
      transferring={team.transferring.value}
      error={ours ? team.transferError.value : null}
      onTransfer={() => void transferAndRefresh(team, groupsStore)}
      onCancel={onClose}
    />
  )
}

/**
 * Wires one group's settings screen to the groups store, which already holds every group, and to
 * the members store, which reads this group's members when the page opens.
 */
export function GroupSettingsView({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation()
  const store = groupsStore
  const team = membersStore
  const invites = invitationsStore
  // Closing the page forgets the members, so a later pull does not read them for nobody. It
  // forgets a new invitation's link too: the link is shown once.
  useEffect(() => {
    void team.open(groupId)
    return () => {
      team.reset()
      invites.closeGroup()
    }
  }, [groupId])
  const role = store.groups.value.find((candidate) => candidate.id === groupId)?.role
  // Only the owner and admins may read the invitations; the API refuses everyone else.
  useEffect(() => {
    if (role !== undefined && canManageInvitations(role)) void invites.open(groupId)
  }, [groupId, role])
  const invitesOurs = invites.groupId.value === groupId
  const billingOurs = billingOf(groupId)
  // Until the store has switched to this group, it holds another group's members.
  const ours = team.groupId.value === groupId
  const group = store.groups.value.find((candidate) => candidate.id === groupId) ?? null
  const working = store.working.value
  // An error of another group's page is not this page's.
  const failure = store.actionError.value?.groupId === groupId ? store.actionError.value : null
  const movedAll = store.moved.value?.groupId === groupId ? store.moved.value : null
  const movedTo = movedAll && store.groups.value.find((other) => other.id === movedAll.toGroupId)
  return (
    <GroupSettingsScreen
      group={group}
      selected={selectionStore.groupId.value === groupId}
      // A person always has a group, so an empty list means the first read has not answered yet.
      loading={store.loading.value || store.groups.value.length === 0}
      error={store.loadError.value}
      navigate={navigate}
      onOpen={(id) => {
        void selectionStore.select(id)
        navigate(NOTE_PATHS.list)
      }}
      onRename={(name) => renameGroup(store, groupId, name)}
      onUpdateDetails={(details) => updateGroupDetails(store, groupId, details)}
      isLastGroup={store.groups.value.length <= 1}
      hasSubscription={billingOurs?.subscribed ?? false}
      members={ours ? team.members.value : null}
      memberCount={ours ? team.memberCount.value ?? undefined : undefined}
      membersError={ours ? team.loadError.value : null}
      memberPendingId={ours ? team.pendingUserId.value : null}
      memberError={ours ? team.memberError.value : null}
      onRoleChange={(userId, role) => void team.changeRole(userId, role)}
      onRemoveMember={(userId) => void team.remove(userId)}
      leaving={ours && team.leaving.value}
      leaveError={ours ? team.leaveError.value : null}
      onLeave={() =>
        void team.leave().then(async (left) => {
          if (!left) return
          // The server may have moved this person's selection; read the list and where it went.
          // A failed list read shows its error on the Groups page. A failed selection read is left
          // alone: the leave is done, and the next pull reads the selection again.
          await Promise.all([store.refreshFromUser(), selectionStore.refresh().catch(() => {})])
          navigate(SCREEN_PATHS.groups)
        })}
      deleting={working?.groupId === groupId && working.action === "delete"}
      deleteError={failure?.action === "delete" ? failure.message : null}
      onDelete={() =>
        void store.remove(groupId).then(async (deleted) => {
          if (!deleted) return
          // The server moved everyone who had this group selected; read where this tab goes now.
          await selectionStore.refresh().catch(() => {})
          navigate(SCREEN_PATHS.groups)
        })}
      moveTargets={moveTargetsOf(store.groups.value, groupId)}
      onMoveAll={(toGroupId) => void store.moveAll(groupId, toGroupId)}
      movingAll={working?.groupId === groupId && working.action === "moveAll"}
      moveAllError={failure?.action === "moveAll" ? failure.message : null}
      moveAllResult={movedAll &&
        {
          count: movedAll.count,
          tags: movedAll.tags,
          toName: movedTo?.name ?? "the other group",
        }}
      moveAllRefusal={failure?.action === "moveAll" ? failure.plan ?? null : null}
      onMoveAllTargetChange={() => store.forgetMoveAll()}
      onMoveAllClose={() => store.forgetMoveAll()}
      billing={group && <GroupBillingCard groupId={groupId} />}
      invite={group
        ? (close) => (
          <GroupInvite
            groupId={groupId}
            actorRole={group.role}
            onClose={close}
            navigate={navigate}
          />
        )
        : undefined}
      pendingInvitations={group && (
        <PendingInvitations
          actorRole={group.role}
          invitations={invitesOurs ? invites.invitations.value : null}
          error={invitesOurs ? invites.loadError.value : null}
          revokingId={invites.revokingId.value}
          revokeError={invites.revokeError.value}
          onRevoke={(invitationId) => void invites.revoke(invitationId)}
        />
      )}
      transfer={group
        ? (close) => <GroupTransfer groupId={groupId} group={group} onClose={close} />
        : undefined}
    />
  )
}
