import { useEffect, useState } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import {
  MAILED_CODE_COOLDOWN_SECONDS,
  SIGN_IN_CODE_MESSAGES,
  SignInCodeScreen,
} from "@ui/sign-in-code-screen.tsx"
import { SIGN_UP_OFFLINE } from "@ui/sign-up-code-screen.tsx"
import { GUEST_PATHS } from "@ui/guest-screens.tsx"
import { afterSignIn, homePath, readNext, SCREEN_PATHS, withNext } from "@ui/progressive.tsx"
import {
  cancelSignInCode,
  type CodeRequestAnswer,
  type CodeStepAnswer,
  readWaitingSignInCode,
  requestSignInCode,
  resendSignInCode,
  verifySignInCode,
} from "../state/auth.ts"
import { handOffAddress, takeHandedOffAddress } from "../state/address-handoff.ts"
import {
  forgetSentCode,
  readSentCode,
  rememberSentCode,
  type SentCode,
  sentCodeFor,
} from "../state/sign-in-code.ts"
import { lastSignIn } from "../state/last-sign-in.ts"
import { sessionState } from "../state/session.ts"
import { isGuestSession } from "../state/guest.ts"
import { emailStore } from "../state/email.ts"
import { notesOn } from "../modules.ts"
import { useAppText } from "@ui/i18n.ts"
import type { Translator } from "@spy4x/platform/universal/i18n"

/**
 * The message of a refused request of a code step, or the offline one when it never left, in the
 * language of `t`; `fallback` is the key said when the API named no reason.
 */
export function codeFailure(
  t: Translator<string>,
  answer: CodeRequestAnswer | CodeStepAnswer,
  fallback: string = SIGN_IN_CODE_MESSAGES.sendFailed,
): string {
  if (answer.ok) return ""
  if ("offline" in answer && answer.offline) return t.t(SIGN_UP_OFFLINE)
  return ("error" in answer && answer.error) || t.t(fallback)
}

/** When a new code may be asked for after `sent`, or `undefined` when nothing was sent here. */
export function readyAtOf(sent: SentCode | null): number | undefined {
  return sent ? sent.sentAt + MAILED_CODE_COOLDOWN_SECONDS * 1000 : undefined
}

/**
 * Whether `next` is a page of the profile, where the danger zone's proof button sends a signed-in
 * person for a code to their own address.
 */
export function isProofReturn(next: string): boolean {
  const path = new URL(next, `http://app.invalid`).pathname
  return path === SCREEN_PATHS.profile || path.startsWith(`${SCREEN_PATHS.profile}/`)
}

/**
 * Wires `SignInCodeScreen`. The server's cookie says whether a code waits for this
 * browser, so a reload stays on the code step; the tab keeps when the code went out
 * (`sessionStorage`) for the wait before a new one. An address handed over by the sign-in page
 * fills the field, and "Back to sign in" hands the typed one back. The right code reloads
 * onto the next page: the authenticator's code page while a second factor is owed, `/keep` for a
 * guest who kept the account, or the page asked for when the code was. Signed in, the page shows
 * "You're signed in", unless the profile asked for proof: then the code goes to the account's own
 * proven address, and the right code returns to the profile with a session that counts as fresh.
 */
export function SignInCodeView() {
  const [, navigate] = useLocation()
  const next = readNext(new URLSearchParams(useSearch()), homePath(notesOn()))
  const t = useAppText()
  const [sent, setSent] = useState(readSentCode)
  const [email, setEmail] = useState(() => takeHandedOffAddress() ?? sent?.email ?? "")
  const [dead, setDead] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const session = sessionState.value
  const guest = isGuestSession(session.user)
  const signedIn = session.user !== null && !session.isMfaRequired && !guest
  // The profile's proof button: a code to the account's own proven address, back to `next`.
  const proving = signedIn && next !== null && isProofReturn(next)
  const status = emailStore.status.value
  const fixedEmail = !proving
    ? undefined
    : status === null && !emailStore.loadFailed.value
    ? null
    : status?.proven && status.email
    ? status.email
    : undefined

  useEffect(() => {
    if (proving && emailStore.status.value === null) void emailStore.refresh()
  }, [proving])

  useEffect(() => {
    // The tab's memory may be stale or missing: the server decides whether a code waits here.
    void readWaitingSignInCode().then((waiting) => {
      if (waiting === undefined) return
      if (waiting === null) return forget()
      setSent((kept) => sentCodeFor(kept, waiting))
    })
  }, [])

  const forget = () => {
    forgetSentCode()
    setSent(null)
  }

  /** Marks a code as sent to `address` now: the step opens, and an old complaint goes. */
  const markSent = (address: string) => {
    const kept = { email: address, sentAt: Date.now() }
    rememberSentCode(kept)
    setSent(kept)
    setDead(false)
    setCodeError(null)
  }

  const submit = async () => {
    setFieldError(null)
    setError(null)
    setPending(true)
    const address = fixedEmail ?? email.trim()
    const answer = await requestSignInCode(address, next)
    // The step names the address as the server keeps it, trimmed and in lower case.
    const kept = answer.ok ? await readWaitingSignInCode() : null
    setPending(false)
    if (answer.ok) return markSent(kept || address)
    if (answer.field) setFieldError(answer.error || t.t(SIGN_IN_CODE_MESSAGES.sendFailed))
    else setError(codeFailure(t, answer))
  }

  const resend = async () => {
    if (!sent) return
    setResending(true)
    // A dead code's request may be gone: a new request for the same address starts again.
    const answer = dead ? await requestSignInCode(sent.email, next) : await resendSignInCode()
    setResending(false)
    if (answer.ok) return markSent(sent.email)
    if ("dead" in answer && answer.dead) return setDead(true)
    setCodeError(codeFailure(t, answer))
  }

  const check = async (code: string) => {
    setCodeError(null)
    setChecking(true)
    const result = await verifySignInCode(code)
    if (result.ok) {
      const { answer } = result
      forgetSentCode()
      // What the sign-in page says next time: the code is no linked method that the app's own
      // check after sign-in would find.
      lastSignIn.remember("link", answer.email)
      location.href = answer.secondFactorPending
        ? withNext(SCREEN_PATHS.oneTimeCode, answer.next)
        : guest && answer.created
        ? answer.next ?? GUEST_PATHS.keep
        : afterSignIn(answer.next)
      return
    }
    setChecking(false)
    if ("guestTaken" in result) navigate(GUEST_PATHS.keepTaken, { replace: true })
    else if (result.dead) setDead(true)
    else setCodeError(codeFailure(t, result, SIGN_IN_CODE_MESSAGES.checkFailed))
  }

  return (
    <SignInCodeScreen
      email={email}
      onEmailChange={setEmail}
      sentTo={sent?.email ?? null}
      dead={dead}
      fieldError={fieldError}
      error={error}
      pending={pending}
      onSubmit={() => void submit()}
      guest={guest}
      codeError={codeError}
      checking={checking}
      onCode={(code) => void check(code)}
      readyAt={readyAtOf(sent)}
      resending={resending}
      onResend={() => void resend()}
      onDifferentAddress={() => {
        if (sent) setEmail(sent.email)
        void cancelSignInCode()
        forget()
        setDead(false)
        setCodeError(null)
        setError(null)
      }}
      onBackToSignIn={() => {
        const typed = email.trim()
        if (typed) handOffAddress(typed)
      }}
      next={next}
      navigate={navigate}
      signedIn={signedIn && fixedEmail === undefined}
      fixedEmail={fixedEmail}
    />
  )
}
