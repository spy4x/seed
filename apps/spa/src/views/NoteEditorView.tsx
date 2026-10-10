import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { canMutateNotes } from "@domain/groups"
import { NoteEditorScreen } from "@ui/note-editor-screen.tsx"
import { moveTargetsOf } from "@ui/notes-screen.tsx"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { notesStore } from "../state/notes.ts"
import { selectionStore } from "../state/selection.ts"
import { OfflineStatus } from "../modules.ts"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import { isSpaPath } from "./spa-paths.ts"

/**
 * Wires the note page to the notes store: `/notes/new` (no `noteId`) creates a note in the
 * person's selected group, `/notes/:noteId` edits one of that group's notes. A note that is not in
 * the selected group is never opened by the link itself: a link must not change the selection. A
 * note in another of the person's groups names that group and offers "Switch to <group>", which
 * selects it through the group store's own command, and the note then opens. Any other note is
 * "not found", whether it does not exist or sits in a group the person is not in. Leaving with
 * unsaved text asks first.
 */
export function NoteEditorView({ noteId = null }: { noteId?: string | null }) {
  const [, navigate] = useLocation()
  const store = notesStore
  const groupId = selectionStore.groupId.value
  useEffect(() => {
    if (groupId) void store.open(groupId, noteId)
  }, [groupId, noteId])

  const membership = groupId
    ? groupsStore.groups.value.find((group) => group.id === groupId)
    : undefined
  const creating = noteId === null
  const editing = store.editing.value
  const missing = store.missing.value
  const listError = store.listError.value
  const elsewhereId = store.elsewhere.value
  const elsewhereGroup = elsewhereId
    ? groupsStore.groups.value.find((group) => group.id === elsewhereId)
    : undefined
  // The open note is read once the list is: until then it is neither found nor missing.
  const readingNote = !creating && editing === null && !missing && listError === null
  const errors = creating ? store.createErrors.value : store.editErrors.value
  return (
    <>
      {groupId && (
        <OfflineStatus
          groupId={groupId}
          onResolved={() => void store.refresh().catch(() => {})}
        />
      )}
      <NoteEditorScreen
        group={membership
          ? { id: membership.id, name: membership.name, canWrite: canMutateNotes(membership.role) }
          : null}
        loading={groupsStore.loading.value || groupId === null || readingNote}
        notFound={missing || (!creating && editing === null && listError !== null)}
        elsewhere={missing && elsewhereGroup ? { name: elsewhereGroup.name } : null}
        onSwitchGroup={elsewhereGroup && (() => void selectionStore.select(elsewhereGroup.id))}
        switching={selectionStore.pending.value}
        note={editing && { id: editing.id, version: editing.version, conflict: editing.conflict }}
        value={editing ?? store.draft.value}
        onChange={(value) => {
          if (editing) store.editing.value = { ...editing, ...value }
          else store.draft.value = value
        }}
        errors={{ title: errors.title, form: errors.form ?? listError, plan: errors.plan }}
        saving={creating ? store.creating.value : store.saving.value}
        onSave={async () => {
          if (creating) {
            const note = await store.create()
            if (note) navigate(NOTE_PATHS.note(note.id))
          } else if (await store.save()) navigate(NOTE_PATHS.list)
        }}
        onReloadLatest={() => void store.reloadLatest()}
        deleting={store.deleting.value !== null}
        onDelete={async () => {
          if (editing && await store.remove(editing)) navigate(NOTE_PATHS.list)
        }}
        moveTargets={membership && canMutateNotes(membership.role)
          ? moveTargetsOf(groupsStore.groups.value, membership.id)
          : []}
        onMove={async (toGroupId) => {
          if (editing && await store.move(toGroupId, [editing.id])) navigate(NOTE_PATHS.list)
        }}
        moving={store.moving.value}
        moveError={store.moveError.value}
        navigate={navigate}
      />
      <UnsavedGuard
        when={store.unsaved.value}
        owns={(url) => isSpaPath(url.pathname)}
        navigate={navigate}
        labels={{
          message: "Your changes to this note have not been saved. If you leave, they are lost.",
        }}
        onDiscard={() => creating && store.discardDraft()}
      />
    </>
  )
}
