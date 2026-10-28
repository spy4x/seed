import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { canMutateNotes } from "@domain/groups"
import { TagsScreen } from "@ui/tags-screen.tsx"
import { groupsStore } from "../state/groups.ts"
import { notesStore } from "../state/notes.ts"
import { selectionStore } from "../state/selection.ts"
import { tagsStore } from "../state/tags.ts"
import { toasts } from "../state/toasts.ts"
import { OfflineStatus } from "../modules.ts"
import { deleteAndAnnounce } from "./tag-delete.ts"
import { useAppText } from "@ui/i18n.ts"

/**
 * Wires the tags page to the tags store for `/tags`. The tags are those of the person's selected
 * group, as the notes are; whoever may write notes may change tags, on the tag editor's pages.
 */
export function TagsView() {
  const [, navigate] = useLocation()
  const t = useAppText()
  const store = tagsStore
  const groupId = selectionStore.groupId.value
  useEffect(() => {
    if (groupId) void store.open(groupId)
  }, [groupId])
  const membership = groupId
    ? groupsStore.groups.value.find((group) => group.id === groupId)
    : undefined
  const canWrite = membership ? canMutateNotes(membership.role) : false
  return (
    <>
      {groupId && (
        <OfflineStatus
          groupId={groupId}
          onResolved={() => void store.refresh().catch(() => {})}
        />
      )}
      <TagsScreen
        group={membership ? { id: membership.id, name: membership.name, canWrite } : null}
        tags={store.tags.value}
        loading={store.loading.value || groupsStore.loading.value || groupId === null}
        listError={store.listError.value}
        onDelete={canWrite
          ? (id) => void deleteAndAnnounce(t, store, id, notesStore, toasts)
          : undefined}
        navigate={navigate}
      />
    </>
  )
}
