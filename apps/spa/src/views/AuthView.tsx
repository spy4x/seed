import { useEffect, useState } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import type { AuthCredentials } from "@spy4x/preact-system/auth-form"
import {
  AUTH_PATHS,
  authFailureMessage,
  AuthScreen,
  type AuthScreenKind,
} from "@ui/auth-screen.tsx"
import { afterSignIn, readNext, withNext } from "@ui/progressive.tsx"
import {
  OAUTH_NOTICE_PARAM,
  OAUTH_NOTICES,
  oauthNotice,
  type OAuthProviderId,
} from "@domain/identity"
import { checkTotp, signIn, signUp } from "../state/auth.ts"
import { listProviders } from "../state/sign-in-methods.ts"
import { lastSignIn, lastSignInHint } from "../state/last-sign-in.ts"
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
      onSignUp={({ login, password }: AuthCredentials) => attempt(() => signUp(login, password))}
      onOneTimeCode={(code) => attempt(() => checkTotp(code))}
    />
  )
}
