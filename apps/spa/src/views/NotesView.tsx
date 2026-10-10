import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { canMutateNotes } from "@domain/groups"
import { moveTargetsOf, NotesScreen } from "@ui/notes-screen.tsx"
import { groupsStore } from "../state/groups.ts"
import { notesStore } from "../state/notes.ts"
import { selectionStore } from "../state/selection.ts"
import { useUndoToast } from "./use-undo-toast.ts"
import { OfflineStatus } from "../modules.ts"

/**
 * Wires the notes list to the notes store for `/notes`. The notes are those of the person's
 * selected group (the selection store); the group's name and the person's role come from the
 * groups store. Writing happens on a note's own page, see `NoteEditorView`.
 */
export function NotesView() {
  const [, navigate] = useLocation()
  const store = notesStore
  useUndoToast(store)
  const groupId = selectionStore.groupId.value
  useEffect(() => {
    if (groupId) void store.open(groupId, null)
  }, [groupId])
  // An Undo that ends while the list is not on screen must not move focus when it returns.
  useEffect(() => {
    store.listShown.value = true
    return () => {
      store.listShown.value = false
      store.clearUndoOutcome()
    }
  }, [])

  const membership = groupId
    ? groupsStore.groups.value.find((group) => group.id === groupId)
    : undefined
  return (
    <>
      {groupId && (
        <OfflineStatus
          groupId={groupId}
          onResolved={() => void store.refresh().catch(() => {})}
        />
      )}
      <NotesScreen
        group={membership
          ? { id: membership.id, name: membership.name, canWrite: canMutateNotes(membership.role) }
          : null}
        notes={store.notes.value}
        loading={store.loading.value || groupsStore.loading.value || groupId === null}
        listError={store.listError.value}
        moveTargets={membership && canMutateNotes(membership.role)
          ? moveTargetsOf(groupsStore.groups.value, membership.id)
          : []}
        onMove={({ toGroupId, noteIds }) => void store.move(toGroupId, noteIds)}
        moving={store.moving.value}
        moveError={store.moveError.value}
        onDelete={(note) => void store.remove(note)}
        showDeleted={store.showDeleted.value}
        onShowDeletedChange={(on) => void store.setShowDeleted(on)}
        deletedNotes={store.deletedNotes.value}
        deletedLoading={store.deletedLoading.value}
        onRestore={(note) => void store.restore(note.id)}
        restoring={store.restoring.value}
        restoreError={store.restoreError.value}
        undoOutcome={store.undoOutcome.value}
        onUndoFocused={() => store.clearUndoOutcome()}
        navigate={navigate}
      />
    </>
  )
}
