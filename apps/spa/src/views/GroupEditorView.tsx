import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { createOnlineStatus } from "@spy4x/preact-signals/online"
import { GroupEditorScreen, GroupTab, groupTabOf } from "@ui/group-editor-screen.tsx"
import { memberLabel } from "@ui/group-members.tsx"
import { PendingInvitations } from "@ui/group-invitations.tsx"
import { GroupTransferForm } from "@ui/group-transfer.tsx"
import { canManageInvitations, GroupRole } from "@domain/groups"
import type { GroupRow } from "@ui/groups-screen.tsx"
import { moveTargetsOf } from "@ui/notes-screen.tsx"
import { GROUP_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import { groupsStore } from "../state/groups.ts"
import { membersStore } from "../state/members.ts"
import { selectionStore } from "../state/selection.ts"
import { billingStore } from "../state/billing.ts"
import { invitationsStore } from "../state/invitations.ts"
import { groupExportStore } from "../state/group-files.ts"
import { GroupBillingView } from "./BillingViews.tsx"
import { GroupActivityView } from "./GroupActivityView.tsx"
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

/** The open group's plan, once the billing tab has read it; `null` until then. */
function billingOf(groupId: string) {
  const current = billingStore.current.value
  return current?.groupId === groupId ? current.billing : null
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
 * `/groups/:groupId/:tab?`: the group's page on the tab its address names. The old plans page
 * (`/pricing`) opens the Plan and billing tab, and an address with any other last part opens the
 * General tab, both in place of the address they came with.
 */
export function GroupPage({ groupId, tab }: { groupId: string; tab?: string }) {
  const [, navigate] = useLocation()
  const open = groupTabOf(tab)
  useEffect(() => {
    if (open !== null) return
    navigate(tab === "pricing" ? GROUP_PATHS.billing(groupId) : GROUP_PATHS.settings(groupId), {
      replace: true,
    })
  }, [open, tab, groupId])
  return open === null ? null : <GroupEditorView key={groupId} groupId={groupId} tab={open} />
}

/**
 * Wires the group editor to the groups store: `/groups/new` (no `groupId`) creates a group,
 * `/groups/:groupId` edits one, and `/groups/:groupId/<tab>` opens another of its tabs. A created group becomes the current one, and the address turns into
 * its page; the route announcer then moves focus to its name. Leaving with unsaved changes asks
 * first. An existing group's page also reads its members and, for the owner and admins, its
 * invitations.
 */
export function GroupEditorView(
  { groupId = null, tab = GroupTab.GENERAL }: { groupId?: string | null; tab?: GroupTab },
) {
  const [, navigate] = useLocation()
  const store = groupsStore
  useEffect(() => store.openEditor(groupId), [groupId])
  useEffect(() => network.watch(), [])
  return (
    <>
      {groupId === null ? <NewGroup /> : <ExistingGroup groupId={groupId} tab={tab} />}
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
  useEffect(() => void billingStore.loadTrial(), [])
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
      trial={billingStore.trial.value}
    />
  )
}

/** `/groups/:groupId` and its tabs: the group's details, members, invitations, plan and log. */
function ExistingGroup({ groupId, tab }: { groupId: string; tab: GroupTab }) {
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
  const memberRows = ours ? team.members.value : null
  const owner = memberRows?.find((member) => member.role === GroupRole.OWNER)
  return (
    <GroupEditorScreen
      tab={tab}
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
      onExport={() => void groupExportStore.download(groupId)}
      exporting={groupExportStore.exporting.value === groupId}
      exportFailed={groupExportStore.failed.value === groupId}
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
      billing={group && (
        <GroupBillingView
          groupId={groupId}
          groupName={group.name}
          memberCount={ours ? team.memberCount.value ?? memberRows?.length ?? null : null}
          ownerName={owner ? memberLabel(owner) : null}
        />
      )}
      activity={<GroupActivityView groupId={groupId} />}
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
