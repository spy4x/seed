import { useEffect, useRef, useState } from "preact/hooks"
import { supportsPasskeyAutofill, supportsPasskeys } from "@spy4x/platform/browser/passkey"
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
import {
  checkTotp,
  type PasskeySignInAnswer,
  requestSignInLink,
  signIn,
  signInWithPasskey,
  signUp,
} from "../state/auth.ts"
import { rememberSentLink } from "../state/sign-in-link.ts"
import { linkRequestFailure } from "./SignInLinkViews.tsx"
import { listProviders } from "../state/sign-in-methods.ts"
import { lastSignIn, lastSignInHint } from "../state/last-sign-in.ts"
import { takeHandedOffAddress } from "../state/address-handoff.ts"
import { sessionState } from "../state/session.ts"
import { demoMode, guestMode, siteOrigin } from "../state/demo.ts"

/** How long an autofill passkey request waits before it starts again with a fresh challenge. */
const PASSKEY_AUTOFILL_RENEW_MS = 4.5 * 60_000

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
  // account, or "Use a different address" back to the sign-up form. It fills the login field, and
  // focus goes to the field after it.
  const [handed] = useState(() => (screen === "one-time-code" ? null : takeHandedOffAddress()))
  useEffect(() => {
    if (handed === null) return
    const field = document.querySelector<HTMLInputElement>(
      `input[name="${screen === "sign-in" ? "login" : "email"}"]`,
    )
    if (!field) return
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

  // Passkeys (#222): the button when the browser has them, and the autofill request that waits
  // for a pick in the login field while the sign-in page is open. The server's challenge lives
  // five minutes, so the waiting request is started again a little before that.
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [autofill, setAutofill] = useState(false)
  const waiting = useRef<AbortController | null>(null)
  const passkeys = screen === "sign-in" && supportsPasskeys()
  const finishPasskey = (answer: PasskeySignInAnswer) => {
    if (answer.ok) {
      location.href = answer.mfaRequired
        ? withNext(AUTH_PATHS["one-time-code"], next)
        : afterSignIn(next)
      return true
    }
    if (!answer.cancelled) setError(answer.error || authFailureMessage(screen))
    return false
  }
  const waitForAutofill = () => {
    waiting.current?.abort()
    const controller = new AbortController()
    waiting.current = controller
    const renew = setTimeout(waitForAutofill, PASSKEY_AUTOFILL_RENEW_MS)
    controller.signal.addEventListener("abort", () => clearTimeout(renew))
    void signInWithPasskey({ autofill: true, signal: controller.signal })
      .then((answer) => {
        if (controller.signal.aborted) return
        clearTimeout(renew)
        // The autofill waits quietly: it says nothing unless a picked passkey was refused, and
        // then the field offers its passkeys again. A browser or device that turned the request
        // down is left alone, so the request does not start over and over.
        if (answer.ok || (!answer.cancelled && answer.picked)) {
          if (!finishPasskey(answer)) waitForAutofill()
        }
      })
  }
  useEffect(() => {
    if (!passkeys) return
    let shown = true
    void supportsPasskeyAutofill().then((offered) => {
      if (!shown || !offered) return
      setAutofill(true)
      waitForAutofill()
    })
    return () => {
      shown = false
      waiting.current?.abort()
    }
  }, [passkeys])
  /** "Sign in with a passkey": the autofill request steps aside for the device's own dialog. */
  const passkeySignIn = async () => {
    const resume = waiting.current !== null && !waiting.current.signal.aborted
    waiting.current?.abort()
    setError(null)
    setPasskeyBusy(true)
    const answer = await signInWithPasskey()
    setPasskeyBusy(false)
    if (!finishPasskey(answer) && resume) waitForAutofill()
  }

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

  /**
   * "Email me a sign-in link" (#391): with an address in the field it sends the link and opens
   * "Check your inbox"; with a username or nothing, it opens the link page with the field to fill.
   */
  const [linkBusy, setLinkBusy] = useState(false)
  const emailLink = async (login: string) => {
    if (!login.includes("@")) {
      navigate(withNext(SCREEN_PATHS.signInLink, next))
      return
    }
    setError(null)
    setLinkBusy(true)
    const answer = await requestSignInLink(login, next)
    setLinkBusy(false)
    if (!answer.ok) {
      setError(linkRequestFailure(answer))
      return
    }
    rememberSentLink({ email: login, sentAt: Date.now() })
    navigate(withNext(SCREEN_PATHS.signInLink, next))
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
      demo={demoMode.value}
      guest={guestMode.value}
      legal={siteOrigin.value
        ? { terms: `${siteOrigin.value}/terms`, privacy: `${siteOrigin.value}/privacy` }
        : null}
      onForgetLastSignIn={() => {
        lastSignIn.forget()
        setLast(null)
      }}
      onPasskey={passkeys ? () => void passkeySignIn() : undefined}
      passkeyBusy={passkeyBusy}
      passkeyAutofill={autofill}
      onEmailLink={(login) => void emailLink(login)}
      linkBusy={linkBusy}
      defaultLogin={handed ?? undefined}
      onSignIn={({ login, password }: AuthCredentials) => attempt(() => signIn(login, password))}
      onSignUp={({ login, password }: AuthCredentials) => void requestSignUp(login, password)}
      onOneTimeCode={(code) => attempt(() => checkTotp(code))}
    />
  )
}
