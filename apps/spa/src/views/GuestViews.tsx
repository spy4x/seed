import { useEffect, useRef, useState } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import { supportsPasskeys } from "@spy4x/platform/browser/passkey"
import {
  type GuestSwitchState,
  OAUTH_NOTICE_PARAM,
  OAUTH_NOTICES,
  OAUTH_PROVIDER_NAMES,
  oauthNotice,
  type OAuthProviderId,
} from "@domain/identity"
import {
  GUEST_PATHS,
  GuestTakenScreen,
  type KeepMethod,
  KeepScreen,
  TryScreen,
  type TryState,
} from "@ui/guest-screens.tsx"
import { readNext, SCREEN_PATHS, withNext } from "@ui/progressive.tsx"
import { SIGN_UP_OFFLINE } from "@ui/sign-up-code-screen.tsx"
import { bootstrapSession, signUp } from "../state/auth.ts"
import {
  cancelGuestSwitch,
  isGuestSession,
  readGuestSwitch,
  rememberKeep,
  startGuest,
  switchFromGuest,
  takeKeep,
} from "../state/guest.ts"
import { createSignInMethodsStore, listProviders } from "../state/sign-in-methods.ts"
import { sessionState } from "../state/session.ts"

/** Where a new guest lands: the notes, where the starter note waits. */
const GUEST_HOME = "/notes"

/**
 * `/try` (#224): starts a guest account with a `POST` as the page opens, then replaces itself
 * with the app, so Back never lands here again. A browser that already has a guest goes straight
 * in; one with a full account is told so and nothing is made.
 */
export function TryView() {
  const [, navigate] = useLocation()
  const next = readNext(new URLSearchParams(useSearch()))
  const [state, setState] = useState<TryState>({ kind: "working" })
  const started = useRef(false)
  const run = async () => {
    setState({ kind: "working" })
    const answer = await startGuest()
    // A reload, as every sign-in does, so the app starts its modules for the new account; replacing
    // this page keeps Back from landing on `/try` again.
    if (answer.kind === "started" || answer.kind === "already-guest") {
      location.replace(next ?? GUEST_HOME)
      return
    }
    setState(answer.kind === "rate-limited" ? answer : { kind: answer.kind })
  }
  useEffect(() => {
    const user = sessionState.value.user
    if (user && !isGuestSession(user)) return setState({ kind: "signed-in" })
    if (user) return location.replace(next ?? GUEST_HOME)
    // Once, even when a development build runs effects twice.
    if (started.current) return
    started.current = true
    void run()
  }, [])
  return <TryScreen state={state} onRetry={() => void run()} navigate={navigate} />
}

/** "your e-mail address", "Google": what the kept method was, for the success line. */
function keptMethod(method: string | undefined): KeepMethod | null {
  if (method === "google" || method === "github" || method === "passkey" || method === "email") {
    return method
  }
  return null
}

/**
 * `/keep` (#224): a guest adds the first sign-in method, and the account stays the same with
 * everything in it. A provider leaves the app and comes back with `?oauth=kept`; the e-mail path
 * goes through the sign-up code page and comes back with `?kept=email`. Done returns to the page
 * the person came from.
 */
export function KeepView() {
  const [, navigate] = useLocation()
  const query = new URLSearchParams(useSearch())
  const next = readNext(query)
  const [store] = useState(() => createSignInMethodsStore())
  const [providers, setProviders] = useState<OAuthProviderId[]>([])
  const [busy, setBusy] = useState<KeepMethod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kept, setKept] = useState<KeepMethod | null>(null)
  const [back, setBack] = useState<string | null>(next)

  useEffect(() => {
    let shown = true
    void listProviders().then((found) => shown && setProviders(found))
    // Back from a provider, or from the e-mail code: the account is kept, or the provider says why.
    const notice = oauthNotice(query.get(OAUTH_NOTICE_PARAM))
    const fromEmail = query.get("kept") === "email"
    if (notice || fromEmail) {
      const pending = takeKeep()
      if (pending?.next) setBack(pending.next)
      if (fromEmail || notice === "kept") {
        setKept(keptMethod(fromEmail ? "email" : pending?.method) ?? "email")
      } else if (notice) {
        const name = pending && pending.method in OAUTH_PROVIDER_NAMES
          ? OAUTH_PROVIDER_NAMES[pending.method as OAuthProviderId]
          : null
        setError(
          notice === "failed" && name
            ? `${name} did not finish. Your account was not changed. Try again, or choose another method.`
            : OAUTH_NOTICES[notice],
        )
      }
      navigate(GUEST_PATHS.keep, { replace: true })
    }
    return () => {
      shown = false
    }
  }, [])

  // A passkey added here keeps the account: the session is read again, so the banner goes.
  useEffect(() => {
    const status = store.passkeyStatus.value
    if (status?.kind === "added") {
      void bootstrapSession().then(() => setKept("passkey"))
      setBusy(null)
    } else if (status?.kind === "cancelled") {
      setBusy(null)
      setError("No passkey was added. Your account is still a guest account.")
    }
  }, [store.passkeyStatus.value])
  useEffect(() => {
    if (store.error.value !== null) {
      setBusy(null)
      setError(store.error.value || "That did not work. Try again.")
    }
  }, [store.error.value])

  const user = sessionState.value.user
  return (
    <KeepScreen
      isGuest={isGuestSession(user)}
      providers={providers}
      passkeys={supportsPasskeys()}
      busy={busy}
      error={error}
      kept={kept}
      onProvider={(provider) => {
        setError(null)
        setBusy(provider)
        rememberKeep({ method: provider, next: back })
        void store.link(provider)
      }}
      onPasskey={() => {
        setError(null)
        setBusy("passkey")
        void store.addPasskey()
      }}
      onEmail={async (email, password) => {
        setError(null)
        setBusy("email")
        const answer = await signUp(email, password)
        setBusy(null)
        if (answer.ok) {
          navigate(withNext(SCREEN_PATHS.signUpCode, withKept(back)))
          return
        }
        setError(
          !answer.expired && answer.offline
            ? SIGN_UP_OFFLINE
            : (!answer.expired && answer.error) || "That did not work. Try again.",
        )
      }}
      onDone={() => navigate(back ?? SCREEN_PATHS.profile)}
      navigate={navigate}
    />
  )
}

/** `/keep?kept=email`, carrying the page to return to, for the sign-up code page's `next`. */
export function withKept(next: string | null): string {
  const query = new URLSearchParams({ kept: "email" })
  if (next) query.set("next", next)
  return `${GUEST_PATHS.keep}?${query}`
}

/**
 * `/keep/taken` (#224): the method belonged to another account. Reads the waiting choice and
 * answers it: a switch reloads onto that account's first page with a status line, "Keep the guest
 * account" goes back to `/keep`.
 */
export function GuestTakenView() {
  const [, navigate] = useLocation()
  const [state, setState] = useState<GuestSwitchState | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let shown = true
    void readGuestSwitch().then((found) => shown && setState(found ?? null))
    return () => {
      shown = false
    }
  }, [])
  return (
    <GuestTakenScreen
      state={state}
      busy={busy}
      error={error}
      navigate={navigate}
      onKeep={async () => {
        setBusy(true)
        await cancelGuestSwitch()
        setBusy(false)
        navigate(GUEST_PATHS.keep, { replace: true })
      }}
      onSwitch={async (choice, password, otp) => {
        setError(null)
        setBusy(true)
        const answer = await switchFromGuest(choice, password, otp)
        setBusy(false)
        if (!answer.ok) return setError(answer.error)
        // Another account now: a reload starts the app for it, as a sign-in does. The Profile says
        // how many groups came along (`?moved=`).
        location.replace(`${SCREEN_PATHS.profile}?moved=${answer.result.movedGroups}`)
      }}
    />
  )
}
