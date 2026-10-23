import { useEffect, useState } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import {
  LinkOpenScreen,
  type LinkOpenState,
  LinkRequestScreen,
  SIGN_IN_LINK_COOLDOWN_SECONDS,
  SIGN_IN_LINK_MESSAGES,
} from "@ui/sign-in-link-screen.tsx"
import { SIGN_UP_OFFLINE } from "@ui/sign-up-code-screen.tsx"
import { GUEST_PATHS } from "@ui/guest-screens.tsx"
import { afterSignIn, readNext, SCREEN_PATHS, withNext } from "@ui/progressive.tsx"
import { redeemSignInLink, requestSignInLink, type SignInLinkRequestAnswer } from "../state/auth.ts"
import { handOffAddress, takeHandedOffAddress } from "../state/address-handoff.ts"
import { forgetSentLink, readSentLink, rememberSentLink } from "../state/sign-in-link.ts"
import { lastSignIn } from "../state/last-sign-in.ts"
import { sessionState } from "../state/session.ts"
import { isGuestSession } from "../state/guest.ts"
import { emailStore } from "../state/email.ts"

/** The message of a refused request for a link, or the offline one when it never left. */
export function linkRequestFailure(answer: SignInLinkRequestAnswer): string {
  if (answer.ok) return ""
  return answer.offline ? SIGN_UP_OFFLINE : answer.error || SIGN_IN_LINK_MESSAGES.sendFailed
}

/**
 * Wires `LinkRequestScreen` (#391). The address a link went to and when are kept for the tab
 * (`sessionStorage`), so a reload stays on "Check your inbox" with its wait; "Use a different
 * address" forgets them. An address handed over by the sign-in page fills the field, and "Back to
 * sign in" hands the typed one back (#406).
 */
export function LinkRequestView() {
  const [, navigate] = useLocation()
  const next = readNext(new URLSearchParams(useSearch()))
  const [sent, setSent] = useState(readSentLink)
  const [email, setEmail] = useState(() => takeHandedOffAddress() ?? sent?.email ?? "")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [resending, setResending] = useState(false)

  const send = async (address: string) => {
    const answer = await requestSignInLink(address, next)
    if (!answer.ok) return answer
    const kept = { email: address, sentAt: Date.now() }
    rememberSentLink(kept)
    setSent(kept)
    return answer
  }

  const submit = async () => {
    setFieldError(null)
    setError(null)
    setPending(true)
    const answer = await send(email.trim())
    setPending(false)
    if (answer.ok) return
    if (answer.field) setFieldError(answer.error || SIGN_IN_LINK_MESSAGES.sendFailed)
    else setError(linkRequestFailure(answer))
  }

  const resend = async () => {
    if (!sent) return
    setError(null)
    setResending(true)
    const answer = await send(sent.email)
    setResending(false)
    if (!answer.ok) setError(linkRequestFailure(answer))
  }

  return (
    <LinkRequestScreen
      email={email}
      onEmailChange={setEmail}
      sentTo={sent?.email ?? null}
      fieldError={fieldError}
      error={error}
      pending={pending}
      onSubmit={() => void submit()}
      readyAt={sent ? sent.sentAt + SIGN_IN_LINK_COOLDOWN_SECONDS * 1000 : undefined}
      resending={resending}
      onResend={() => void resend()}
      onDifferentAddress={() => {
        forgetSentLink()
        setSent(null)
        setError(null)
      }}
      onBackToSignIn={() => {
        const typed = email.trim()
        if (typed) handOffAddress(typed)
      }}
      next={next}
      navigate={navigate}
    />
  )
}

/** The token a link carries in the fragment (`#token=…`), or `null`. */
export function tokenOf(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token")
  return token ? token : null
}

/**
 * Wires `LinkOpenScreen` (#391). It reads the token from the fragment once and takes it out of the
 * address bar, so it stays in no history entry; opening the page spends nothing. Continue spends
 * it and reloads onto the next page: the code page while a second factor is owed, `/keep` for a
 * guest who kept the account, or the page asked for when the link was.
 */
export function LinkOpenView() {
  const [, navigate] = useLocation()
  const [token] = useState(() => tokenOf(location.hash))
  const [state, setState] = useState<LinkOpenState>(token ? "ready" : "incomplete")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = sessionState.value
  const guest = isGuestSession(session.user)
  const signedIn = session.user !== null && !session.isMfaRequired && !guest

  useEffect(() => {
    if (location.hash) history.replaceState(history.state, "", location.pathname + location.search)
  }, [])
  useEffect(() => {
    if (signedIn) void emailStore.refresh()
  }, [signedIn])

  const redeem = async () => {
    if (!token) return
    setError(null)
    setBusy(true)
    const result = await redeemSignInLink(token)
    if (result.ok) {
      const { answer } = result
      forgetSentLink()
      // What the sign-in page says next time: the link is no linked method that the app's own
      // check after sign-in would find.
      lastSignIn.remember("link", answer.email)
      location.href = answer.secondFactorPending
        ? withNext(SCREEN_PATHS.oneTimeCode, answer.next)
        : guest && answer.created
        ? answer.next ?? GUEST_PATHS.keep
        : afterSignIn(answer.next)
      return
    }
    setBusy(false)
    if ("guestTaken" in result) navigate(GUEST_PATHS.keepTaken, { replace: true })
    else if ("refused" in result || "askedElsewhere" in result) {
      // "Send a new link" opens the form with the address this tab asked for, not the inbox state.
      const sent = readSentLink()
      if (sent) handOffAddress(sent.email)
      forgetSentLink()
      setState("refused" in result ? "refused" : "askedElsewhere")
    } else {
      setError(
        result.offline
          ? SIGN_IN_LINK_MESSAGES.unreachable
          : result.error || SIGN_IN_LINK_MESSAGES.openFailed,
      )
    }
  }

  const status = emailStore.status.value
  return (
    <LinkOpenScreen
      state={state}
      signedInAs={signedIn ? status?.email ?? "another account" : null}
      guest={guest}
      busy={busy}
      error={error}
      onContinue={() => void redeem()}
      navigate={navigate}
    />
  )
}
