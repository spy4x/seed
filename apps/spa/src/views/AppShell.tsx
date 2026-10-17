import type { ComponentChildren } from "preact"
import { useEffect } from "preact/hooks"
import { useSignal } from "@preact/signals"
import { useLocation, useSearch } from "wouter-preact"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { AppFrame, type ConnectionStatus, PublicFrame as PublicFrameScreen } from "@ui/frame.tsx"
import { EmailBanner } from "@ui/email-screen.tsx"
import { emailStore } from "../state/email.ts"
import { signOut } from "../state/auth.ts"
import { groupsStore } from "../state/groups.ts"
import { notificationsStore } from "../state/notifications.ts"
import { selectionStore } from "../state/selection.ts"
import { themeStore } from "../state/theme.ts"
import type { SessionUser } from "../state/session.ts"
import { type UnsentWait, watchUnsentChanges } from "../modules.ts"
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
 * Wires the signed-in `AppFrame` to this app's router, stores and `signOut`: the groups and the
 * selected one for the switcher and the Activity entry, the name and address for the account menu.
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
  return (
    <AppFrame
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
      // The e-mail page itself asks for the code; the banner would only repeat it there.
      banner={location === SCREEN_PATHS.email
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
