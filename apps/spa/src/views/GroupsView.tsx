import { useLocation } from "wouter-preact"
import { GroupsScreen } from "@ui/groups-screen.tsx"
import { groupsStore } from "../state/groups.ts"
import { selectionStore } from "../state/selection.ts"
import { MyInvitationsView } from "./InvitationView.tsx"

/**
 * Wires the groups screen to the groups store: the list, a failed read with its retry, the deleted
 * groups and their restore. A row and "New group" are links, to the group's page and to
 * `/groups/new`.
 */
export function GroupsView() {
  const store = groupsStore
  const [, navigate] = useLocation()
  const working = store.working.value
  const failure = store.actionError.value
  return (
    <GroupsScreen
      groups={store.groups.value}
      deleted={store.deleted.value}
      selectedId={selectionStore.groupId.value}
      navigate={navigate}
      loading={store.loading.value}
      error={store.error.value}
      loadError={store.loadError.value}
      onRetry={() => void store.refresh().catch(() => {})}
      restoreError={failure?.action === "restore" ? failure.message : null}
      restoringId={working?.action === "restore" ? working.groupId : null}
      onRestore={(groupId) => void store.restore(groupId)}
      invitations={<MyInvitationsView />}
    />
  )
}
