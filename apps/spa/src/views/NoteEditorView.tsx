import { useEffect, useRef } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { canMutateNotes } from "@domain/groups"
import { NoteEditorScreen } from "@ui/note-editor-screen.tsx"
import { moveTargetsOf } from "@ui/notes-screen.tsx"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { membersStore } from "../state/members.ts"
import { notesStore } from "../state/notes.ts"
import { sessionState } from "../state/session.ts"
import { toasts } from "../state/toasts.ts"
import { tagsStore } from "../state/tags.ts"
import { selectionStore } from "../state/selection.ts"
import { OfflineStatus } from "../modules.ts"
import { UnsavedGuard } from "@spy4x/preact-ui/unsaved-guard"
import { pageHeading } from "@spy4x/preact-system/route-announcer"
import { isSpaPath } from "./spa-paths.ts"
import { personName } from "./note-people.ts"
import { movedToast } from "./NotesView.tsx"

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
    if (groupId) {
      void store.open(groupId, noteId)
      void tagsStore.open(groupId)
      void membersStore.open(groupId)
    }
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
  const loading = groupsStore.loading.value || groupId === null || readingNote
  const saved = editing ? store.notes.value.find((note) => note.id === editing.id) : undefined
  const youId = sessionState.value.user?.id ?? null
  const members = membersStore.groupId.value === groupId ? membersStore.members.value : null
  const moveTargets = membership && canMutateNotes(membership.role)
    ? moveTargetsOf(groupsStore.groups.value, membership.id)
    : []
  // A route change focuses the loading page's heading, which the note's own heading then replaces,
  // leaving focus on the page body. Once the note shows, lost focus goes to its heading.
  const wasLoading = useRef(loading)
  useEffect(() => {
    if (wasLoading.current && !loading && document.activeElement === document.body) {
      pageHeading()?.focus()
    }
    wasLoading.current = loading
  }, [loading])
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
        loading={loading}
        notFound={missing || (!creating && editing === null && listError !== null)}
        elsewhere={missing && elsewhereGroup ? { name: elsewhereGroup.name } : null}
        onSwitchGroup={elsewhereGroup && (() => void selectionStore.select(elsewhereGroup.id))}
        switching={selectionStore.pending.value}
        note={editing && {
          id: editing.id,
          version: editing.version,
          conflict: editing.conflict,
          // The heading names the note as saved, so typing a new title does not rename the page.
          savedTitle: saved?.title ?? editing.title,
        }}
        authorship={saved && {
          createdAt: saved.createdAt,
          createdBy: personName(saved.createdByUserId, youId, members),
          updatedAt: saved.updatedAt,
          updatedBy: personName(saved.updatedByUserId, youId, members),
        }}
        value={editing ?? store.draft.value}
        tags={tagsStore.tags.value}
        onChange={(value) => {
          const next = { ...value, tagIds: [...(value.tagIds ?? [])] }
          if (editing) store.editing.value = { ...editing, ...next }
          else store.draft.value = next
        }}
        errors={{ title: errors.title, form: errors.form ?? listError, plan: errors.plan }}
        saving={creating ? store.creating.value : store.saving.value}
        onSave={async () => {
          if (creating) {
            const note = await store.create()
            if (!note) return
            toasts.success({
              title: "Note created",
              body: `"${note.title}" was created.`,
              dataE2E: "note-created",
            })
            navigate(NOTE_PATHS.note(note.id))
          } else if (editing) {
            const title = editing.title.trim()
            if (!await store.save()) return
            toasts.success({
              title: "Note saved",
              body: `"${title}" was saved.`,
              dataE2E: "note-saved",
            })
            navigate(NOTE_PATHS.list)
          }
        }}
        onReloadLatest={() => void store.reloadLatest()}
        deleting={store.deleting.value !== null}
        onDelete={async () => {
          if (editing && await store.remove(editing)) navigate(NOTE_PATHS.list)
        }}
        moveTargets={moveTargets}
        onMove={async (toGroupId) => {
          if (!editing || !await store.move(toGroupId, [editing.id])) return
          const target = moveTargets.find((group) => group.id === toGroupId)
          toasts.success({
            ...movedToast(1, target?.name ?? "the other group"),
            dataE2E: "note-moved",
          })
          navigate(NOTE_PATHS.list)
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
