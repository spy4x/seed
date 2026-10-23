import { batch, useSignal } from "@preact/signals"
import { useEffect } from "preact/hooks"
import { useUrlFilters } from "@spy4x/preact-signals/use-url-filters"
import { copyToClipboard } from "@spy4x/platform/browser/clipboard"
import { useLocation, useSearchParams } from "wouter-preact"
import { canMutateNotes } from "@domain/groups"
import { moveTargetsOf, NotesScreen } from "@ui/notes-screen.tsx"
import { defaultDirection, NOTE_SORTS, type NoteFilters, type NoteSort } from "@ui/notes-filter.ts"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { membersStore } from "../state/members.ts"
import { notesStore } from "../state/notes.ts"
import { sessionState } from "../state/session.ts"
import { tagsStore } from "../state/tags.ts"
import { selectionStore } from "../state/selection.ts"
import { toasts } from "../state/toasts.ts"
import { useUndoToast } from "./use-undo-toast.ts"
import { personName, personPicture } from "./note-people.ts"
import { movedToast } from "./note-toasts.ts"
import { OfflineStatus } from "../modules.ts"
import { OnboardingView } from "./OnboardingView.tsx"

/** The filter parameters "Clear filters" takes out of the address; search and sort stay. */
const FILTER_PARAMS = ["tag", "match", "author", "mine"]

/**
 * Wires the notes list to the notes store for `/notes`. The notes are those of the person's
 * selected group (the selection store); the group's name and the person's role come from the
 * groups store, and the authors' names from the members store. The search, filters and order live
 * in the address: `?q=`, `?tag=` (repeated, one per tag), `?match=all`, `?author=<userId>`,
 * `?mine=1`, `?sort=created|title` and `?dir=asc|desc`, the last only when it is not the order's
 * own direction. Writing happens on a note's own page, see `NoteEditorView`.
 */
export function NotesView() {
  const [, navigate] = useLocation()
  const store = notesStore
  useUndoToast(store)
  const groupId = selectionStore.groupId.value
  useEffect(() => {
    if (groupId) {
      void store.open(groupId, null)
      void tagsStore.open(groupId)
      void membersStore.open(groupId)
    }
  }, [groupId])

  // The search and the single-value filters go through `useUrlFilters`, which spares the history
  // a step per typed letter. The tags are a repeated `tag=` parameter, which that hook does not
  // read, so they are read and written through the router's own search parameters.
  const q = useSignal<string | number | null>("")
  const author = useSignal<string | number | null>("")
  const mine = useSignal<string | number | null>("")
  const match = useSignal<string | number | null>("any")
  const sort = useSignal<string | number | null>("updated")
  // Empty while the order runs its own way (`defaultDirection`), so the address stays clean.
  const dir = useSignal<string | number | null>("")
  useUrlFilters({
    q: { signal: q, urlParam: "q", initialValue: "" },
    author: { signal: author, urlParam: "author", initialValue: "" },
    mine: { signal: mine, urlParam: "mine", initialValue: "", parser: (v) => v === "1" ? "1" : "" },
    match: {
      signal: match,
      urlParam: "match",
      initialValue: "any",
      parser: (v) => v === "all" ? "all" : "any",
    },
    sort: {
      signal: sort,
      urlParam: "sort",
      initialValue: "updated",
      parser: (v) => NOTE_SORTS.some((option) => option.value === v) ? v : "updated",
    },
    dir: {
      signal: dir,
      urlParam: "dir",
      initialValue: "",
      parser: (v) => v === "asc" || v === "desc" ? v : "",
    },
  })
  const [params, setParams] = useSearchParams()
  const filters: NoteFilters = {
    q: String(q.value ?? ""),
    tagIds: params.getAll("tag"),
    match: match.value === "all" ? "all" : "any",
    author: author.value ? String(author.value) : null,
    mine: mine.value === "1",
    sort: (sort.value ?? "updated") as NoteSort,
    direction: dir.value === "asc" || dir.value === "desc"
      ? dir.value
      : defaultDirection((sort.value ?? "updated") as NoteSort),
  }
  const setTags = (ids: readonly string[]) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete("tag")
      for (const id of ids) next.append("tag", id)
      return next
    })

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
  const youId = sessionState.value.user?.id ?? null
  const members = membersStore.groupId.value === groupId ? membersStore.members.value : null
  const moveTargets = membership && canMutateNotes(membership.role)
    ? moveTargetsOf(groupsStore.groups.value, membership.id)
    : []
  return (
    <>
      {groupId && (
        <OfflineStatus
          groupId={groupId}
          onResolved={() => void store.refresh().catch(() => {})}
        />
      )}
      <NotesScreen
        // The first steps sit under the page header, where a new account lands after sign-in.
        intro={<OnboardingView />}
        group={membership
          ? { id: membership.id, name: membership.name, canWrite: canMutateNotes(membership.role) }
          : null}
        notes={store.notes.value.map((note) => ({
          ...note,
          authorId: note.createdByUserId === null ? null : String(note.createdByUserId),
          authorName: personName(note.createdByUserId, youId, members),
          authorPictureUrl: personPicture(note.createdByUserId, members),
          authorAvatarName: note.createdByUserId === youId
            ? members?.find((member) => member.userId === youId)?.name.trim() || undefined
            : undefined,
        }))}
        tags={tagsStore.tags.value}
        filters={filters}
        onFiltersChange={(next) => {
          if (next.tagIds.join() !== filters.tagIds.join()) return setTags(next.tagIds)
          batch(() => {
            q.value = next.q
            author.value = next.author ?? ""
            mine.value = next.mine ? "1" : ""
            match.value = next.match
            sort.value = next.sort
            dir.value = next.direction === defaultDirection(next.sort) ? "" : next.direction
          })
        }}
        onClearFilters={() =>
          setParams((previous) => {
            const next = new URLSearchParams(previous)
            for (const name of FILTER_PARAMS) next.delete(name)
            return next
          })}
        authors={(members ?? []).map((member) => ({
          id: String(member.userId),
          name: personName(member.userId, null, members) ?? member.name,
          isYou: member.userId === youId,
        }))}
        youId={youId === null ? null : String(youId)}
        loading={store.loading.value || groupsStore.loading.value || groupId === null}
        listError={store.listError.value}
        moveTargets={moveTargets}
        onMove={async ({ toGroupId, noteIds }) => {
          if (!await store.move(toGroupId, noteIds)) return
          const target = moveTargets.find((group) => group.id === toGroupId)
          toasts.success({
            ...movedToast(noteIds.length, target?.name ?? "the other group"),
            dataE2E: "note-moved",
          })
        }}
        moving={store.moving.value}
        moveError={store.moveError.value}
        onDelete={(note) => void store.remove(note)}
        onCopyLink={async (note) => {
          const copied = await copyToClipboard(
            new URL(NOTE_PATHS.note(note.id), location.href).href,
          )
          if (copied) {
            toasts.success({
              title: "Link copied",
              body: `Only people in ${membership?.name ?? "this group"} can open it.`,
              dataE2E: "note-link-copied",
            })
          } else {
            toasts.error({
              title: "Could not copy the link",
              body: "Your browser did not allow it. Open the note and copy the address instead.",
            })
          }
        }}
        showDeleted={store.showDeleted.value}
        onShowDeletedChange={(on) => void store.setShowDeleted(on)}
        deletedNotes={store.deletedNotes.value}
        deletedLoading={store.deletedLoading.value}
        onRestore={async (note) => {
          const title = store.deletedNotes.value.find((deleted) => deleted.id === note.id)?.title
          if (await store.restore(note.id)) {
            toasts.success({
              title: "Note restored",
              body: title ? `"${title}" is back in the list.` : "The note is back in the list.",
              dataE2E: "note-restored",
            })
          }
        }}
        restoring={store.restoring.value}
        restoreError={store.restoreError.value}
        undoOutcome={store.undoOutcome.value}
        onUndoFocused={() => store.clearUndoOutcome()}
        navigate={navigate}
      />
    </>
  )
}
