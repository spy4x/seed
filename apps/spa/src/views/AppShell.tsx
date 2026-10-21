import type { ComponentChildren } from "preact"
import { useEffect } from "preact/hooks"
import { useSignal } from "@preact/signals"
import { useLocation, useSearch } from "wouter-preact"
import { canMutateNotes, canViewActivity } from "@domain/groups"
import { GROUP_PATHS, NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { AppFrame, type ConnectionStatus, PublicFrame as PublicFrameScreen } from "@ui/frame.tsx"
import { EmailBanner, showsEmailBanner } from "@ui/email-screen.tsx"
import { type SearchChoice, SearchPalette } from "@ui/search-palette.tsx"
import { NewNoteDialog } from "@ui/new-note-dialog.tsx"
import { emailStore } from "../state/email.ts"
import { signOut } from "../state/auth.ts"
import { groupsStore } from "../state/groups.ts"
import { notesStore } from "../state/notes.ts"
import { notificationsStore } from "../state/notifications.ts"
import { createNoteSearch } from "../state/search.ts"
import { selectionStore } from "../state/selection.ts"
import { themeStore } from "../state/theme.ts"
import { newNoteStore } from "../state/new-note.ts"
import { spaShortcutRows } from "./shortcuts.ts"
import { hasFinePointer, singleKeys, useShortcuts } from "@platform/shortcuts.ts"
import { activeRows } from "@ui/shortcuts.tsx"
import type { SessionUser } from "../state/session.ts"
import {
  callQuery,
  canCall,
  currentLayer,
  type UnsentWait,
  watchUnsentChanges,
} from "../modules.ts"
import { signOutRedirect } from "./sign-in-gate.ts"
import { UnsentSignOut } from "./UnsentSignOut.tsx"

/**
 * Signs out, leaving a page for signed-in people for plain sign-in first, while the session still
 * holds: once it is cleared, the sign-in gate would keep the page as `next` for whoever signs in
 * next.
 */
function useSignOutNow(): () => void {
  const [location, navigate] = useLocation()
  const search = useSearch()
  return () => {
    const target = signOutRedirect(location, search)
    if (target) navigate(target, { replace: true })
    void signOut()
  }
}

/**
 * The palette's notes: the server's search, or this device's copy when the server cannot be
 * reached, over the groups the person belongs to now.
 */
const searchNotes = createNoteSearch({
  canCall,
  // One try: when the server cannot be reached the device answers at once, without retries.
  server: (q, signal) => callQuery("note.search", { q }, { attempts: 1, signal }),
  groupIds: () => groupsStore.groups.value.map((group) => group.id),
  selectedGroupId: () => selectionStore.groupId.value,
  loadedNotes: (groupId) => notesStore.groupId.value === groupId ? notesStore.notes.value : null,
  deviceNotes: async (groupId) => await currentLayer()?.cache.readNotes(groupId) ?? [],
})

/**
 * The person's own sign-out: at once when nothing waits in the offline queue, as before; otherwise
 * it first asks, in `dialog`, whether to send the queued writes before signing out.
 */
function useSignOut(): { onSignOut: () => void; dialog: ComponentChildren } {
  const signOutNow = useSignOutNow()
  const [, navigate] = useLocation()
  const wait = useSignal<UnsentWait | null>(null)
  const close = () => {
    wait.value?.dispose()
    wait.value = null
  }
  useEffect(() => close, [])
  return {
    onSignOut: () => {
      const watched = watchUnsentChanges()
      if (watched) wait.value = watched
      else signOutNow()
    },
    dialog: wait.value
      ? (
        <UnsentSignOut
          wait={wait.value}
          onSignOut={() => {
            close()
            signOutNow()
          }}
          onCancel={close}
          onReview={(groupId) => {
            close()
            // The notes page of that group shows the conflicts with their choices.
            if (groupId) void selectionStore.select(groupId)
            navigate(NOTE_PATHS.list)
          }}
        />
      )
      : null,
  }
}

/**
 * The New note dialog over every signed-in page, wired to the notes store: the note goes to the
 * group chosen in it, else the selected one when the person may write there, else their only group
 * they may write to. Adding leaves the person on the page; Ctrl Enter, or "Open note", opens the
 * note, switching to its group first when it is another one.
 */
function NewNoteLayer({ navigate }: { navigate: (href: string) => void }) {
  const store = newNoteStore
  const writable = groupsStore.groups.value.filter((group) => canMutateNotes(group.role))
  const selected = selectionStore.groupId.value
  const targetId = store.groupId.value ??
    (writable.some((group) => group.id === selected)
      ? selected
      : writable.length === 1
      ? writable[0].id
      : null)
  const target = writable.find((group) => group.id === targetId) ?? null
  const openNote = async (noteId: string, groupId: string) => {
    store.close()
    if (groupId !== selectionStore.groupId.value) await selectionStore.select(groupId)
    navigate(NOTE_PATHS.note(noteId))
  }
  return (
    <NewNoteDialog
      open={store.open.value}
      onClose={store.close}
      groups={writable.map(({ id, name }) => ({ id, name }))}
      groupId={target?.id ?? null}
      onGroupChange={(groupId) => store.groupId.value = groupId}
      title={store.title.value}
      onTitleChange={(title) => store.title.value = title}
      pending={store.pending.value}
      errors={store.errors.value}
      added={store.added.value}
      onAdd={async (openAfter) => {
        const note = await store.add(target && { id: target.id, name: target.name })
        if (note && openAfter) await openNote(note.id, note.groupId)
      }}
      onOpenNote={(noteId) => {
        const added = store.added.value
        if (added) void openNote(noteId, added.groupId)
      }}
      navigate={navigate}
    />
  )
}

/**
 * Wires the signed-in `AppFrame` to this app's router, stores and `signOut`: the groups and the
 * selected one for the switcher and the Activity entry, the name and address for the account menu,
 * and the keyboard shortcuts with the New note dialog.
 */
export function AppShell(
  { user, wsStatus, children }: {
    user: SessionUser
    wsStatus: ConnectionStatus
    children: ComponentChildren
  },
) {
  const [location, navigate] = useLocation()
  const { onSignOut, dialog } = useSignOut()
  const groups = groupsStore.groups.value
  const current = groups.find((group) => group.id === selectionStore.groupId.value)
  const shortcutsOpen = useSignal(false)
  const rows = spaShortcutRows({
    navigate,
    openShortcuts: () => shortcutsOpen.value = true,
    openNewNote: newNoteStore.show,
    activityGroupId: current && canViewActivity(current.role) ? current.id : null,
  })
  useShortcuts(activeRows(rows, singleKeys.on.value))
  const open = async (choice: SearchChoice) => {
    if (choice.kind === "page") return navigate(choice.href)
    if (choice.kind === "new-note") return newNoteStore.show()
    if (choice.kind === "group") return navigate(GROUP_PATHS.settings(choice.groupId))
    // Straight to the note: never the editor's "Note in another group" page in between.
    if (choice.groupId !== selectionStore.groupId.value) {
      await selectionStore.select(choice.groupId)
    }
    navigate(NOTE_PATHS.note(choice.noteId))
  }
  return (
    <AppFrame
      search={
        <SearchPalette
          searchNotes={searchNotes}
          groups={groups}
          currentGroup={current
            ? { id: current.id, name: current.name, canWrite: canMutateNotes(current.role) }
            : null}
          online={wsStatus === "open"}
          onSelect={(choice) => void open(choice)}
          slashKey={singleKeys.on.value}
        />
      }
      shortcuts={{
        rows,
        open: shortcutsOpen.value,
        onOpen: () => shortcutsOpen.value = true,
        onClose: () => shortcutsOpen.value = false,
        singleKeys: singleKeys.on.value,
        onSingleKeys: singleKeys.set,
        inMenu: hasFinePointer(),
      }}
      groupPicker={{
        groups: groupsStore.groups.value,
        selectedId: selectionStore.groupId.value,
        onSelect: (groupId) => {
          void selectionStore.select(groupId)
          // An open note belongs to the group just left.
          if (location.startsWith(`${NOTE_PATHS.list}/`)) navigate(NOTE_PATHS.list)
        },
      }}
      user={{
        firstName: user.firstName,
        lastName: user.lastName,
        email: emailStore.status.value?.email,
      }}
      theme={themeStore}
      // The e-mail page itself asks for the code; the banner would only repeat it there. With
      // nothing to show it is left out, because the frame keeps a margin under any banner it gets.
      banner={location === SCREEN_PATHS.email || !showsEmailBanner(emailStore.status.value)
        ? undefined
        : <EmailBanner status={emailStore.status.value} navigate={navigate} />}
      connection={wsStatus}
      unreadCount={notificationsStore.unreadCount.value}
      currentPath={location}
      navigate={navigate}
      onSignOut={onSignOut}
    >
      {children}
      {dialog}
      <NewNoteLayer navigate={navigate} />
    </AppFrame>
  )
}

/** Wires the signed-out `PublicFrame` to this app's router and `signOut`. */
export function PublicFrame(
  { canSignOut, children }: { canSignOut: boolean; children: ComponentChildren },
) {
  const [, navigate] = useLocation()
  // No queue is open before sign-in finishes, so this sign-out never has one to ask about.
  const onSignOut = useSignOutNow()
  return (
    <PublicFrameScreen
      canSignOut={canSignOut}
      navigate={navigate}
      onSignOut={onSignOut}
    >
      {children}
    </PublicFrameScreen>
  )
}
