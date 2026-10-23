import type { ComponentChildren } from "preact"
import { useEffect } from "preact/hooks"
import { useSignal } from "@preact/signals"
import { useLocation, useSearch } from "wouter-preact"
import { canMutateNotes, canViewActivity } from "@domain/groups"
import { pictureUrl } from "@domain/identity"
import { GROUP_PATHS, NOTE_PATHS, profilePath, SCREEN_PATHS } from "@ui/progressive.tsx"
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
import { newNoteStore } from "../state/new-note.ts"
import { spaShortcutRows } from "./shortcuts.ts"
import { hasFinePointer, singleKeys, useShortcuts } from "@platform/shortcuts.ts"
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
import { GUEST_PATHS, GuestBanner, GuestSignOutDialog } from "@ui/guest-screens.tsx"
import {
  hideGuestBanner,
  isGuestBannerHidden,
  isGuestSession,
  nextPacificMidnight,
} from "../state/guest.ts"
import { demoMode } from "../state/demo.ts"
import { guestRefusal } from "../state/guest-refusal.ts"
import { GuestRefusalDialog } from "@ui/guest-profile.tsx"
import { overviewPageActions } from "./OverviewView.tsx"
import { noteEditorPageActions } from "./NoteEditorView.tsx"

/** The overview's commands in the palette, while the overview is open. */
const OVERVIEW_COMMANDS = [
  { id: "overview-range", label: "Change date range" },
  { id: "overview-customise", label: "Customise overview" },
] as const

/** The note page's command in the palette, while a note an editor can change is open. */
const NOTE_COMMANDS = [{ id: "note-attach", label: "Attach files to this note" }] as const

/** The open page's commands in the palette, if it has any. */
function pageCommands() {
  if (overviewPageActions.value) return OVERVIEW_COMMANDS
  if (noteEditorPageActions.value) return NOTE_COMMANDS
  return undefined
}

/** Runs the page command `id` of {@link pageCommands} on the open page. */
function runPageCommand(id: string): void {
  const actions = overviewPageActions.value
  if (id === "overview-range") actions?.openRange()
  if (id === "overview-customise") actions?.openCustomise()
  if (id === "note-attach") noteEditorPageActions.value?.attach()
}

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
function useSignOut(guest: boolean): { onSignOut: () => void; dialog: ComponentChildren } {
  const signOutNow = useSignOutNow()
  const [, navigate] = useLocation()
  const wait = useSignal<UnsentWait | null>(null)
  // A guest is asked first (#224): signing out of an account with no sign-in method loses it.
  const askingGuest = useSignal(false)
  const close = () => {
    wait.value?.dispose()
    wait.value = null
  }
  useEffect(() => close, [])
  const signOutChecked = () => {
    const watched = watchUnsentChanges()
    if (watched) wait.value = watched
    else signOutNow()
  }
  return {
    onSignOut: () => {
      if (guest) askingGuest.value = true
      else signOutChecked()
    },
    dialog: askingGuest.value
      ? (
        <GuestSignOutDialog
          onCancel={() => askingGuest.value = false}
          onKeep={() => {
            askingGuest.value = false
            navigate(GUEST_PATHS.keep)
          }}
          onSignOut={() => {
            askingGuest.value = false
            signOutChecked()
          }}
        />
      )
      : wait.value
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
  const guest = isGuestSession(user)
  const { onSignOut, dialog } = useSignOut(guest)
  // Hidden on this browser once dismissed; the profile keeps its own entry to the same page.
  const bannerHidden = useSignal(guest && isGuestBannerHidden(user.id))
  const groups = groupsStore.groups.value
  const current = groups.find((group) => group.id === selectionStore.groupId.value)
  const shortcutsOpen = useSignal(false)
  const rows = spaShortcutRows({
    navigate,
    openShortcuts: () => shortcutsOpen.value = true,
    openNewNote: newNoteStore.show,
    activityGroupId: current && canViewActivity(current.role) ? current.id : null,
    overviewPage: overviewPageActions.value,
  })
  useShortcuts(rows, singleKeys.on.value)
  const open = async (choice: SearchChoice) => {
    if (choice.kind === "page") return navigate(choice.href)
    if (choice.kind === "new-note") return newNoteStore.show()
    if (choice.kind === "command") return runPageCommand(choice.id)
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
          pageCommands={pageCommands()}
          onSelect={(choice) => void open(choice)}
          slashKey={singleKeys.on.value}
          guest={guest}
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
        // With no name and no address the menu would read "User"; a guest is named for what it is.
        firstName: guest && !user.firstName && !user.lastName ? "Guest" : user.firstName,
        lastName: user.lastName,
        email: emailStore.status.value?.email,
        avatarUrl: pictureUrl(user.pictureId),
      }}
      // The profile's Account section offers the code itself; the banner would only repeat it
      // there, and `/profile` shows that section from `md` up. With nothing to show it is left
      // out, because the frame keeps a margin under any banner it gets.
      banner={guest
        ? location.startsWith(GUEST_PATHS.keep) || bannerHidden.value ? undefined : (
          <GuestBanner
            wipeAt={demoMode.value ? nextPacificMidnight(new Date()) : null}
            navigate={navigate}
            onDismiss={() => {
              hideGuestBanner(user.id)
              bannerHidden.value = true
            }}
          />
        )
        : location === profilePath("account") || location === SCREEN_PATHS.profile ||
            !showsEmailBanner(emailStore.status.value)
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
      {guestRefusal.value && (
        <GuestRefusalDialog
          action={guestRefusal.value}
          navigate={navigate}
          onClose={() => guestRefusal.value = null}
        />
      )}
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
