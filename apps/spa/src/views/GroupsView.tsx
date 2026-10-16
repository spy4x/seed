import { useLocation, useSearch } from "wouter-preact"
import { GroupsScreen } from "@ui/groups-screen.tsx"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { selectionStore } from "../state/selection.ts"
import { MyInvitationsView } from "./InvitationView.tsx"

/**
 * Wires the groups screen to the groups store: reads and creates go through the store. `?new` in
 * the address (`NEW_GROUP_PATH`, the switcher's "New group") opens the create dialog, and closing
 * the dialog drops it again, so the next "New group" link opens it once more.
 */
export function GroupsView() {
  const store = groupsStore
  const [, navigate] = useLocation()
  const createOpen = new URLSearchParams(useSearch()).has("new")
  const working = store.working.value
  const failure = store.actionError.value
  return (
    <GroupsScreen
      groups={store.groups.value}
      deleted={store.deleted.value}
      selectedId={selectionStore.groupId.value}
      navigate={navigate}
      name={store.name.value}
      onNameChange={(name) => (store.name.value = name)}
      creating={store.creating.value}
      loading={store.loading.value}
      error={store.error.value}
      onCreate={() => void store.create()}
      createOpen={createOpen}
      onCreateClose={() => {
        if (createOpen) navigate(SCREEN_PATHS.groups, { replace: true })
      }}
      restoreError={failure?.action === "restore" ? failure.message : null}
      restoringId={working?.action === "restore" ? working.groupId : null}
      onRestore={(groupId) => void store.restore(groupId)}
      invitations={<MyInvitationsView />}
      onOpen={(groupId) => {
        void selectionStore.select(groupId)
        navigate(NOTE_PATHS.list)
      }}
    />
  )
}
