import "./app.css"
import { useEffect, useState } from "preact/hooks"
import { InstallPrompt } from "@spy4x/preact-system/install-prompt"
import { SWUpdater } from "@spy4x/preact-system/sw-updater"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { Toastr } from "@spy4x/preact-ui/toastr"
import { Route, Switch, useLocation, useSearch } from "wouter-preact"
import { canSignOut, sessionState } from "./state/session.ts"
import { bootstrapSession, settleOwedSignOut } from "./state/auth.ts"
import { groupsStore } from "./state/groups.ts"
import { notesStore } from "./state/notes.ts"
import { selectionStore } from "./state/selection.ts"
import { profileStore } from "./state/profile.ts"
import { membersStore } from "./state/members.ts"
import { createChangeCheck, createPull } from "./state/pull.ts"
import { emailStore } from "./state/email.ts"
import {
  connectionDisplay,
  flushOutbox,
  forgetModules,
  forgetUser,
  recallUser,
  rememberUser,
  startModules,
  stopChanges,
} from "./modules.ts"
import { toasts } from "./state/toasts.ts"
import { install } from "./install.ts"
import { AuthView } from "./views/AuthView.tsx"
import { EmailView } from "./views/EmailView.tsx"
import { ForgotPasswordView, ResetPasswordView } from "./views/PasswordResetView.tsx"
import { GroupsView } from "./views/GroupsView.tsx"
import { SubscribeView, SubscriptionConfirmView, UnsubscribeView } from "./views/SubscribeViews.tsx"
import { GroupSettingsView } from "./views/GroupSettingsView.tsx"
import { NotificationsView } from "./views/NotificationsView.tsx"
import { GroupActivityView } from "./views/GroupActivityView.tsx"
import { InvitationView } from "./views/InvitationView.tsx"
import { notificationsStore } from "./state/notifications.ts"
import { invitationsStore } from "./state/invitations.ts"
import { PricingView } from "./views/BillingViews.tsx"
import { billingStore } from "./state/billing.ts"
import { NoteEditorView } from "./views/NoteEditorView.tsx"
import { NotesView } from "./views/NotesView.tsx"
import { ProfileView } from "./views/ProfileView.tsx"
import { AppShell, PublicFrame } from "./views/AppShell.tsx"
import { signInRedirect } from "./views/sign-in-gate.ts"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"

/**
 * An old `/groups/:groupId/notes…` link. It selects nothing: a link must not change the selection,
 * or another site could switch a person's group by linking here. When that group is already the
 * selected one it opens the notes at their new address; otherwise it opens the groups page, which
 * has an "Open notes" button for each group. It waits for the selection to be known.
 */
function OpenIfSelected({ groupId, noteId }: { groupId: string; noteId?: string }) {
  const [, navigate] = useLocation()
  const selected = selectionStore.groupId.value
  useEffect(() => {
    if (selected === null) return
    navigate(
      selected !== groupId
        ? SCREEN_PATHS.groups
        : noteId
        ? NOTE_PATHS.note(noteId)
        : NOTE_PATHS.list,
      { replace: true },
    )
  }, [selected, groupId, noteId])
  return <LoadingSpinner size="lg" label="Opening the notes..." class="min-h-[50vh]" />
}

function Routes() {
  return (
    <Switch>
      <Route path="/sign-up">{() => <AuthView key="sign-up" screen="sign-up" />}</Route>
      <Route path="/sign-in">{() => <AuthView key="sign-in" screen="sign-in" />}</Route>
      <Route path="/totp">{() => <AuthView key="one-time-code" screen="one-time-code" />}</Route>
      <Route path="/forgot-password" component={ForgotPasswordView} />
      <Route path="/reset-password" component={ResetPasswordView} />
      <Route path="/email" component={EmailView} />
      <Route path="/subscribe" component={SubscribeView} />
      <Route path="/subscribe/confirm" component={SubscriptionConfirmView} />
      <Route path="/unsubscribe" component={UnsubscribeView} />
      <Route path="/groups" component={GroupsView} />
      <Route path="/groups/:groupId">
        {(params) => <GroupSettingsView groupId={params.groupId} />}
      </Route>
      <Route path="/groups/:groupId/activity">
        {(params) => <GroupActivityView groupId={params.groupId} />}
      </Route>
      <Route path="/groups/:groupId/pricing">
        {(params) => <PricingView groupId={params.groupId} />}
      </Route>
      <Route path="/groups/:groupId/notes">
        {(params) => <OpenIfSelected groupId={params.groupId} />}
      </Route>
      <Route path="/groups/:groupId/notes/:noteId">
        {(params) => <OpenIfSelected groupId={params.groupId} noteId={params.noteId} />}
      </Route>
      <Route path="/invite/:token">
        {(params) => <InvitationView key={params.token} token={params.token} />}
      </Route>
      <Route path="/notifications" component={NotificationsView} />
      <Route path="/notes" component={NotesView} />
      <Route path="/notes/new">{() => <NoteEditorView key="new" />}</Route>
      <Route path="/notes/:noteId">
        {(params) => <NoteEditorView key={params.noteId} noteId={params.noteId} />}
      </Route>
      <Route path="/" component={ProfileView} />
    </Switch>
  )
}

/**
 * Sends a visit to a page for signed-in people to sign-in while the session is not signed in, and
 * sign-in returns there afterwards. It runs again when the person signs out in another tab.
 */
function SignInGate() {
  const [location, navigate] = useLocation()
  const search = useSearch()
  const { user, isMfaRequired } = sessionState.value
  useEffect(() => {
    const target = signInRedirect(location, search, { user, isMfaRequired })
    if (target) navigate(target, { replace: true })
  }, [location, search, user, isMfaRequired])
  return null
}

/** A fully signed-in user gets the library `Shell`; everyone else the plain public frame. */
function Frame() {
  const session = sessionState.value
  if (session.user && !session.isMfaRequired) {
    return (
      <AppShell user={session.user} wsStatus={connectionDisplay(session)}>
        <InstallPrompt
          mode={install.visible.value ? install.mode.value : "unavailable"}
          onInstall={() => install.install()}
          onDismiss={() => install.dismiss()}
          class="mx-auto mb-4 w-full max-w-3xl"
        />
        <Routes />
      </AppShell>
    )
  }
  return (
    <PublicFrame canSignOut={canSignOut(session)}>
      <SignInGate />
      <Routes />
    </PublicFrame>
  )
}

export function App() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    bootstrapSession(recallUser).finally(() => setReady(true))
  }, [])

  useEffect(() => {
    // A sign-out made offline reaches the server as soon as the browser is online again.
    const settle = () => void settleOwedSignOut()
    addEventListener("online", settle)
    return () => removeEventListener("online", settle)
  }, [])

  useEffect(() => {
    // The user is remembered for the next start with no network, and forgotten on sign-out.
    const { user, isReady, isMfaRequired } = sessionState.value
    if (user && !isMfaRequired) rememberUser(user)
    else if (isReady && !user) forgetUser()
  }, [sessionState.value.user, sessionState.value.isReady, sessionState.value.isMfaRequired])

  // A change made in another tab while this socket was down is read when it opens again.
  useEffect(() => profileStore.onSocketStatus(sessionState.value.wsStatus), [
    sessionState.value.wsStatus,
  ])

  useEffect(() => {
    const userId = sessionState.value.user?.id
    if (userId === undefined || sessionState.value.isMfaRequired) {
      // Signed out, or the second factor is still owed: drop the socket, the cursors and the data.
      forgetModules()
      groupsStore.reset()
      membersStore.reset()
      notesStore.reset()
      profileStore.reset()
      selectionStore.reset()
      emailStore.reset()
      billingStore.reset()
      invitationsStore.reset()
      notificationsStore.reset()
      return
    }
    // The REST read is the pull: it runs at start-up, after every reconnect and for every push
    // that is news, so a missed frame costs one read and never leaves the list wrong. A note
    // change moves its group's sequence, so the open group's notes are read again too.
    const reads = {
      userId,
      flushOutbox,
      profile: profileStore,
      selection: selectionStore,
      groups: groupsStore,
      notes: notesStore,
      members: membersStore,
      notifications: notificationsStore,
    }
    selectionStore.start(userId)
    // The banner asks for a code while the address waits for one.
    void emailStore.refresh()
    // The calls port, the device copy, and what triggers the pull: the socket's hints, or without
    // the socket the page's own events and a timer (`modules.ts`).
    startModules(userId, { pull: createPull(reads), check: createChangeCheck(reads) })
    return () => stopChanges()
  }, [
    sessionState.value.user?.id,
    sessionState.value.isMfaRequired,
  ])

  return (
    <>
      {!ready || !sessionState.value.isReady
        ? (
          <main>
            <LoadingSpinner size="lg" label="Loading..." class="min-h-dvh bg-canvas" />
          </main>
        )
        : <Frame />}
      <Toastr
        toasts={toasts.list.value}
        onDismiss={toasts.remove}
        dataE2E="toasts"
      />
      <SWUpdater />
    </>
  )
}
