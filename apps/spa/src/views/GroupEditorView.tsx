import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { GroupEditorScreen } from "@ui/group-editor-screen.tsx"
import { InviteForm, PendingInvitations } from "@ui/group-invitations.tsx"
import { GroupTransferForm } from "@ui/group-transfer.tsx"
import { canManageInvitations, type GroupRole, type InvitationErrorCode } from "@domain/groups"
import { entitlementsOf } from "@domain/billing"
import type { GroupRow } from "@ui/groups-screen.tsx"
import { moveTargetsOf } from "@ui/notes-screen.tsx"
import { GROUP_PATHS, type Navigate, SCREEN_PATHS } from "@ui/progressive.tsx"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import { groupsStore } from "../state/groups.ts"
import { membersStore } from "../state/members.ts"
import { selectionStore } from "../state/selection.ts"
import { billingStore } from "../state/billing.ts"
import { invitationsStore } from "../state/invitations.ts"
import { SeatPriceConfirm } from "@ui/billing-screen.tsx"
import { GroupBillingCard } from "./BillingViews.tsx"
import { toasts } from "../state/toasts.ts"
import { isSpaPath } from "./spa-paths.ts"
import { currentLayer } from "../modules.ts"

const network = createOnlineStatus()

/** Whether the app has no network while a device copy is on: the editor says writing waits. */
function offlineNow(): boolean {
  return !network.online.value && currentLayer() !== null
}

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
 * Creates the group from the new group's form. When it worked, the address turns into the group's
 * page in place of `/groups/new`, so Back does not reopen an emptied form; the group becomes the
 * current one; and a toast says so. Resolves to whether the group was created.
 */
export async function createAndOpen(
  groups: Pick<typeof groupsStore, "create">,
  selection: Pick<typeof selectionStore, "select">,
  navigate: (to: string, options: { replace: boolean }) => void,
  notices: Pick<typeof toasts, "success">,
): Promise<boolean> {
  const group = await groups.create()
  if (!group) return false
  // The group is in the list before the address changes, so its page draws at once.
  navigate(GROUP_PATHS.settings(group.id), { replace: true })
  void selection.select(group.id)
  notices.success({
    title: "Group created",
    body: `"${group.name}" is now your current group.`,
    dataE2E: "group-created",
  })
  return true
}

/**
 * Saves what the person changed in a group's editor and, when it worked, says so in a toast: the
 * toasts are a polite live region, so a screen reader hears it. Resolves to whether it saved.
 */
export async function saveAndAnnounce(
  groups: Pick<typeof groupsStore, "save" | "groups">,
  groupId: string,
  notices: Pick<typeof toasts, "success">,
): Promise<boolean> {
  if (!await groups.save(groupId)) return false
  const saved = groups.groups.value.find((candidate) => candidate.id === groupId)
  notices.success({
    title: "Group saved",
    body: saved ? `"${saved.name}" saved.` : "The group is saved.",
    dataE2E: "group-saved",
  })
  return true
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
 * Wires the group editor to the groups store: `/groups/new` (no `groupId`) creates a group,
 * `/groups/:groupId` edits one. A created group becomes the current one, and the address turns into
 * its page; the route announcer then moves focus to its name. Leaving with unsaved changes asks
 * first. An existing group's page also reads its members and, for the owner and admins, its
 * invitations.
 */
export function GroupEditorView({ groupId = null }: { groupId?: string | null }) {
  const [, navigate] = useLocation()
  const store = groupsStore
  useEffect(() => store.openEditor(groupId), [groupId])
  useEffect(() => network.watch(), [])
  return (
    <>
      {groupId === null ? <NewGroup /> : <ExistingGroup groupId={groupId} />}
      <UnsavedGuard
        when={store.unsaved(groupId)}
        owns={(url) => isSpaPath(url.pathname)}
        navigate={navigate}
        labels={{
          title: "Discard your changes?",
          message: groupId === null
            ? "This group is not created yet."
            : `Your changes to "${
              store.groups.value.find((group) => group.id === groupId)?.name ?? "this group"
            }" are not saved.`,
          leave: "Discard changes",
          stay: "Keep editing",
        }}
        onDiscard={() => store.discard()}
      />
    </>
  )
}

/** `/groups/new`: the editor with empty fields and "Create group". */
function NewGroup() {
  const [, navigate] = useLocation()
  const store = groupsStore
  return (
    <GroupEditorScreen
      creating
      group={null}
      current={false}
      loading={false}
      value={store.draft(null)}
      onChange={(value) => store.edit(null, value)}
      errors={store.editorErrors.value}
      saving={store.creating.value}
      offline={offlineNow()}
      onSave={() => void createAndOpen(store, selectionStore, navigate, toasts)}
      navigate={navigate}
    />
  )
}

/** `/groups/:groupId`: the group's details, members, invitations and plan. */
function ExistingGroup({ groupId }: { groupId: string }) {
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
    <GroupEditorScreen
      group={group}
      current={selectionStore.groupId.value === groupId}
      // A person always has a group, so an empty list means the first read has not answered yet.
      loading={store.loading.value || store.groups.value.length === 0}
      error={store.loadError.value}
      navigate={navigate}
      onSwitch={() => void selectionStore.select(groupId)}
      value={store.draft(groupId)}
      onChange={(value) => store.edit(groupId, value)}
      errors={store.editorErrors.value}
      dirty={store.unsaved(groupId)}
      saving={working?.groupId === groupId && working.action === "save"}
      offline={offlineNow()}
      onSave={() => void saveAndAnnounce(store, groupId, toasts)}
      onDiscard={() => store.discard()}
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
