import { useEffect, useState } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import type { AuthCredentials } from "@spy4x/preact-system/auth-form"
import {
  AUTH_PATHS,
  authFailureMessage,
  AuthScreen,
  type AuthScreenKind,
} from "@ui/auth-screen.tsx"
import { afterSignIn, readNext, SCREEN_PATHS, withNext } from "@ui/progressive.tsx"
import { SIGN_UP_OFFLINE } from "@ui/sign-up-code-screen.tsx"
import {
  OAUTH_NOTICE_PARAM,
  OAUTH_NOTICES,
  oauthNotice,
  type OAuthProviderId,
} from "@domain/identity"
import { checkTotp, signIn, signUp } from "../state/auth.ts"
import { listProviders } from "../state/sign-in-methods.ts"
import { lastSignIn, lastSignInHint } from "../state/last-sign-in.ts"
import { takeHandedOffAddress } from "../state/address-handoff.ts"
import { sessionState } from "../state/session.ts"

/**
 * Wires `AuthScreen` to this app's `signIn`, `signUp` and `checkTotp`. The route picks `screen`; a
 * success reloads onto the next page: the code page while the code is owed, then the page the
 * person asked for (`?next=`, checked again on each page), or the profile without one.
 */
export function AuthView({ screen }: { screen: AuthScreenKind }) {
  const [, navigate] = useLocation()
  const query = new URLSearchParams(useSearch())
  const next = readNext(query)
  // A provider sign-in that failed comes back here with `?oauth=`, and the page says so.
  const [error, setError] = useState<string | null>(() => {
    const notice = oauthNotice(query.get(OAUTH_NOTICE_PARAM))
    return notice && OAUTH_NOTICES[notice]
  })
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(() => lastSignInHint())
  const [providers, setProviders] = useState<OAuthProviderId[]>([])
  // An address another page handed over (#142): "Sign in instead" after a sign-up found its
  // account, or "Use a different address" back to the sign-up form. The form's fields are its
  // own, so the address goes into the field it renders, and focus to the field after it.
  useEffect(() => {
    if (screen === "one-time-code") return
    const email = takeHandedOffAddress()
    if (email === null) return
    const field = document.querySelector<HTMLInputElement>(
      `input[name="${screen === "sign-in" ? "login" : "email"}"]`,
    )
    if (!field) return
    field.value = email
    const password = field.form?.querySelector<HTMLInputElement>(`input[type="password"]`)
    // After the app's route announcer, whose effect runs after this one in the same flush and
    // moves focus to the page's heading on every route change.
    queueMicrotask(() => (screen === "sign-in" ? password : field)?.focus())
  }, [screen])
  useEffect(() => {
    if (screen === "one-time-code") return
    let shown = true
    void listProviders().then((found) => shown && setProviders(found))
    return () => {
      shown = false
    }
  }, [screen])
  const session = sessionState.value

  /** Runs one attempt: a failure shows its message, a success reloads onto the next page. */
  const attempt = async (
    run: () => Promise<{ ok: boolean; error?: string; mfaRequired?: boolean }>,
  ) => {
    setError(null)
    setBusy(true)
    const result = await run()
    setBusy(false)
    if (!result.ok) {
      setError(result.error || authFailureMessage(screen))
      return
    }
    location.href = result.mfaRequired
      ? withNext(AUTH_PATHS["one-time-code"], next)
      : afterSignIn(next)
  }

  /** Starts a sign-up; the code mailed to the address comes next, on a page of its own. */
  const requestSignUp = async (email: string, password: string) => {
    setError(null)
    setBusy(true)
    const answer = await signUp(email, password)
    setBusy(false)
    if (answer.ok) {
      navigate(withNext(SCREEN_PATHS.signUpCode, next))
      return
    }
    setError(
      !answer.expired && answer.offline
        ? SIGN_UP_OFFLINE
        : (!answer.expired && answer.error) || authFailureMessage(screen),
    )
  }

  return (
    <AuthScreen
      screen={screen}
      isSignedIn={session.user !== null && !session.isMfaRequired}
      isMfaRequired={session.isMfaRequired}
      busy={busy}
      error={error}
      navigate={navigate}
      next={next}
      providers={providers}
      lastSignIn={last}
      onForgetLastSignIn={() => {
        lastSignIn.forget()
        setLast(null)
      }}
      onSignIn={({ login, password }: AuthCredentials) => attempt(() => signIn(login, password))}
      onSignUp={({ login, password }: AuthCredentials) => void requestSignUp(login, password)}
      onOneTimeCode={(code) => attempt(() => checkTotp(code))}
    />
  )
}
