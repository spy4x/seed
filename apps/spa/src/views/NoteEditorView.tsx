import { signal } from "@preact/signals"
import { useEffect, useRef } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { canMutateNotes } from "@domain/groups"
import { NoteEditorScreen } from "@ui/note-editor-screen.tsx"
import { ATTACH_BUTTON_ID } from "@ui/note-attachments.tsx"
import { attachmentsStore } from "../state/attachments.ts"
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
import { movedToast } from "./note-toasts.ts"
import { useAppText } from "@ui/i18n.ts"
import { messageText } from "@ui/message.ts"

/** The palette's "Attach files to this note" while a note page an editor can change is open. */
export const noteEditorPageActions = signal<{ attach(): void } | null>(null)

/** Downloads `url`: an image opens in a new tab (it is served inline), any other file saves. */
function openDownload(url: string, type: string): void {
  if (!type.startsWith("image/")) return location.assign(url)
  const link = document.createElement("a")
  link.href = url
  link.target = "_blank"
  link.rel = "noopener"
  link.click()
}

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
  const t = useAppText()
  const store = notesStore
  const groupId = selectionStore.groupId.value
  useEffect(() => {
    if (groupId) {
      void store.open(groupId, noteId)
      void tagsStore.open(groupId)
      void membersStore.open(groupId)
      void attachmentsStore.open(groupId, noteId)
    }
  }, [groupId, noteId])
  // Files that waited for the network upload once it is back.
  useEffect(() => {
    const flush = () => void attachmentsStore.flush()
    addEventListener("online", flush)
    return () => removeEventListener("online", flush)
  }, [])

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
  // Only the first read of the groups counts: a later one runs after every change to a group (an
  // upload, a removal, another member's edit), and drawing the loading page for it would throw the
  // person's focus and place away.
  const loading = (groupsStore.loading.value && membership === undefined) || groupId === null ||
    readingNote
  const saved = editing ? store.notes.value.find((note) => note.id === editing.id) : undefined
  const youId = sessionState.value.user?.id ?? null
  const members = membersStore.groupId.value === groupId ? membersStore.members.value : null
  const canWrite = membership !== undefined && canMutateNotes(membership.role)
  useEffect(() => {
    if (!canWrite) return
    noteEditorPageActions.value = {
      // Focus lands on the button too, so the person is there once the chooser closes. The palette
      // sends focus back where it was as its dialog closes, so the move waits for that close.
      attach: () => {
        const button = document.getElementById(ATTACH_BUTTON_ID)
        button?.click()
        const focus = () => setTimeout(() => button?.focus())
        if (!document.querySelector("dialog[open]")) return focus()
        document.addEventListener("close", focus, { capture: true, once: true })
      },
    }
    return () => noteEditorPageActions.value = null
  }, [canWrite])
  const attachments = attachmentsStore.groupId.value === groupId ? attachmentsStore : null
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
          createdBy: personName(t, saved.createdByUserId, youId, members),
          updatedAt: saved.updatedAt,
          updatedBy: personName(t, saved.updatedByUserId, youId, members),
        }}
        attachments={attachments && {
          items: attachments.rows.value.map((row) => ({
            ...row,
            error: messageText(t, row.error) ?? undefined,
            detail: row.status === "ready" && row.createdByUserId !== undefined
              ? personName(t, row.createdByUserId, youId, members)
              : undefined,
          })),
          usage: attachments.usage.value,
          refusals: attachments.refusals.value,
          plan: attachments.plan.value,
          announcement: attachments.announcement.value,
          onAdd: attachments.add,
          onCancel: attachments.cancel,
          onRetry: (id) => void attachments.retry(id),
          onRemove: attachments.remove,
          onDownload: async (id) => {
            const row = attachments.rows.value.find((item) => item.id === id)
            try {
              openDownload(await attachments.link(id), row?.type ?? "")
              return null
            } catch (cause) {
              return cause instanceof Error ? cause.message : `AttachmentMessages.linkExpired`
            }
          },
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
            void attachmentsStore.created(note.id)
            toasts.success({
              title: t.t(`NoteEditorView.createdTitle`),
              body: t.t(`NoteEditorView.created`, { title: note.title }),
              dataE2E: "note-created",
            })
            navigate(NOTE_PATHS.note(note.id))
          } else if (editing) {
            const title = editing.title.trim()
            if (!await store.save()) return
            toasts.success({
              title: t.t(`NoteEditorView.savedTitle`),
              body: t.t(`NoteEditorView.saved`, { title }),
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
            ...movedToast(t, 1, target?.name),
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
          message: t.t(`NoteEditorView.unsaved`),
        }}
        onDiscard={() => creating && store.discardDraft()}
      />
    </>
  )
}
