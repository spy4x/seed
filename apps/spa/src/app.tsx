import "./app.css"
import type { ComponentChildren } from "preact"
import { useEffect, useState } from "preact/hooks"
import { SWUpdater } from "@spy4x/preact-system/sw-updater"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { Toastr } from "@spy4x/preact-ui/toastr"
import { Route, type StringRouteParams, Switch, useLocation, useSearch } from "wouter-preact"
import { useRouteAnnouncer } from "@spy4x/preact-system/route-announcer"
import { canSignOut, sessionState } from "./state/session.ts"
import { bootstrapSession, settleOwedSignOut } from "./state/auth.ts"
import { rememberSignIn } from "./state/last-sign-in.ts"
import { groupsStore } from "./state/groups.ts"
import { notesStore } from "./state/notes.ts"
import { tagsStore } from "./state/tags.ts"
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
import { AuthView } from "./views/AuthView.tsx"
import { ConfirmSignUpView } from "./views/ConfirmSignUpView.tsx"
import { EmailView } from "./views/EmailView.tsx"
import { ForgotPasswordView, ResetPasswordView } from "./views/PasswordResetView.tsx"
import { GroupsView } from "./views/GroupsView.tsx"
import { SubscribeView, SubscriptionConfirmView, UnsubscribeView } from "./views/SubscribeViews.tsx"
import { GroupEditorView } from "./views/GroupEditorView.tsx"
import { NotificationsView } from "./views/NotificationsView.tsx"
import { GroupActivityView } from "./views/GroupActivityView.tsx"
import { InstallOffer } from "./views/InstallOffer.tsx"
import { InvitationView } from "./views/InvitationView.tsx"
import { notificationsStore } from "./state/notifications.ts"
import { invitationsStore } from "./state/invitations.ts"
import { onboardingStore } from "./state/onboarding.ts"
import { PricingView } from "./views/BillingViews.tsx"
import { billingStore } from "./state/billing.ts"
import { NoteEditorView } from "./views/NoteEditorView.tsx"
import { NotesView } from "./views/NotesView.tsx"
import { TagsView } from "./views/TagsView.tsx"
import { TagEditorView } from "./views/TagEditorView.tsx"
import { ProfileView } from "./views/ProfileView.tsx"
import { AppShell, PublicFrame } from "./views/AppShell.tsx"
import { signInRedirect } from "./views/sign-in-gate.ts"
import { SPA_ROUTE_PATHS, type SpaRoutePath } from "./views/spa-paths.ts"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"

/**
 * An old `/groups/:groupId/notes…` link. It selects nothing: a link must not change the selection,
 * or another site could switch a person's group by linking here. When that group is already the
 * selected one it opens the notes at their new address; otherwise it opens the groups page, where
 * each group's page offers "Switch to this group". It waits for the selection to be known.
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

/**
 * What each route of the table draws. The type asks for every route of `SPA_ROUTES` and no other,
 * so a page cannot be routed without saying who may open it.
 */
const PAGES: {
  [Path in SpaRoutePath]: (params: StringRouteParams<Path>) => ComponentChildren
} = {
  "/sign-up": () => <AuthView key="sign-up" screen="sign-up" />,
  "/sign-up/confirm": () => <ConfirmSignUpView />,
  "/sign-in": () => <AuthView key="sign-in" screen="sign-in" />,
  "/totp": () => <AuthView key="one-time-code" screen="one-time-code" />,
  "/forgot-password": () => <ForgotPasswordView />,
  "/reset-password": () => <ResetPasswordView />,
  "/email": () => <EmailView />,
  "/subscribe": () => <SubscribeView />,
  "/subscribe/confirm": () => <SubscriptionConfirmView />,
  "/unsubscribe": () => <UnsubscribeView />,
  "/groups": () => <GroupsView />,
  "/groups/new": () => <GroupEditorView key="new" />,
  "/groups/:groupId": (params) => <GroupEditorView key={params.groupId} groupId={params.groupId} />,
  "/groups/:groupId/activity": (params) => <GroupActivityView groupId={params.groupId} />,
  "/groups/:groupId/pricing": (params) => <PricingView groupId={params.groupId} />,
  "/groups/:groupId/notes": (params) => <OpenIfSelected groupId={params.groupId} />,
  "/groups/:groupId/notes/:noteId": (params) => (
    <OpenIfSelected groupId={params.groupId} noteId={params.noteId} />
  ),
  "/invite/:token": (params) => <InvitationView key={params.token} token={params.token} />,
  "/notifications": () => <NotificationsView />,
  "/tags": () => <TagsView />,
  "/tags/new": () => <TagEditorView key="new" />,
  "/tags/:tagId": (params) => <TagEditorView key={params.tagId} tagId={params.tagId} />,
  "/notes": () => <NotesView />,
  "/notes/new": () => <NoteEditorView key="new" />,
  "/notes/:noteId": (params) => <NoteEditorView key={params.noteId} noteId={params.noteId} />,
  "/": () => <ProfileView />,
}

/** One `<Route>` per row of the route table, in its order. */
function Routes() {
  return (
    <Switch>
      {SPA_ROUTE_PATHS.map((path) => (
        <Route key={path} path={path}>
          {PAGES[path] as (params: Record<string, string>) => ComponentChildren}
        </Route>
      ))}
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
  // A route change swaps the page without a load: the hook moves focus to the `<h1>` the new page
  // shows first, as a load would put the reader at its top. Focus still ends on the document body
  // where that heading is replaced afterwards: opening a note and saving a new one (the loading
  // heading goes when the note arrives), and signing out (the shell is swapped). The app has no
  // page titles yet, so the tab's title stays.
  const [path] = useLocation()
  useRouteAnnouncer({ path })
  if (session.user && !session.isMfaRequired) {
    return (
      <AppShell user={session.user} wsStatus={connectionDisplay(session)}>
        <InstallOffer />
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
    bootstrapSession(recallUser)
      // A start that found no session deletes what the device kept for the remembered user before
      // the sign-in page shows: the next person on this device must not find it.
      .then(() => sessionState.value.user ? undefined : forgetUser())
      .finally(() => setReady(true))
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
    else if (isReady && !user) void forgetUser()
  }, [sessionState.value.user, sessionState.value.isReady, sessionState.value.isMfaRequired])

  // The sign-in page of this browser later says which method the person used (#142).
  useEffect(() => void rememberSignIn(sessionState.value), [
    sessionState.value.user?.id,
    sessionState.value.isMfaRequired,
  ])

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
      tagsStore.reset()
      profileStore.reset()
      selectionStore.reset()
      emailStore.reset()
      billingStore.reset()
      invitationsStore.reset()
      notificationsStore.reset()
      onboardingStore.reset()
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
      tags: tagsStore,
      members: membersStore,
      notifications: notificationsStore,
      onboarding: onboardingStore,
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
