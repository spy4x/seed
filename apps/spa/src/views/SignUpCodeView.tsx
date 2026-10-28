import { useEffect, useState } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import {
  type ExistingAccountAnswer,
  SIGN_UP_CODE_MINUTES,
  type WaitingPasswordSignUp,
} from "@domain/identity"
import {
  SIGN_UP_CODE_FAILURE,
  SIGN_UP_OFFLINE,
  SignUpCodeScreen,
} from "@ui/sign-up-code-screen.tsx"
import { afterSignIn, readNext, SCREEN_PATHS, withNext } from "@ui/progressive.tsx"
import {
  cancelPasswordSignUp,
  readWaitingSignUp,
  resendSignUpCode,
  type SignUpStepAnswer,
  verifySignUp,
} from "../state/auth.ts"
import { handOffAddress } from "../state/address-handoff.ts"
import { sessionState } from "../state/session.ts"
import { isGuestSession } from "../state/guest.ts"
import { GUEST_PATHS } from "@ui/guest-screens.tsx"
import { useAppText } from "@ui/i18n.ts"
import type { Translator } from "@spy4x/platform/universal/i18n"

/**
 * The message of a refused request, or the offline one when it never left the browser. `fallback`
 * is the key in `app` of the message for a refusal without words of its own.
 */
function failure(t: Translator<string>, answer: SignUpStepAnswer, fallback: string): string {
  if (answer.ok || answer.expired) return t.t(fallback)
  return answer.offline ? t.t(SIGN_UP_OFFLINE) : answer.error || t.t(fallback)
}

/**
 * Wires `SignUpCodeScreen` (#142): reads back the sign-up that waits for its code, so a reload
 * stays on the step, and answers it. The right code for a new address reloads onto the page the
 * person asked for, as sign-in does; for an address an account uses, the page says so and hands
 * the address to sign-in or the reset page in memory.
 */
export function SignUpCodeView() {
  const [, navigate] = useLocation()
  const next = readNext(new URLSearchParams(useSearch()))
  const t = useAppText()
  const [pending, setPending] = useState<WaitingPasswordSignUp | null | undefined>(undefined)
  const [exists, setExists] = useState<ExistingAccountAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [resendNotice, setResendNotice] = useState<string | null>(null)
  const [resendError, setResendError] = useState<string | null>(null)
  const session = sessionState.value
  // A guest has a session but no sign-in method yet: the code step keeps that account (#224).
  const guest = isGuestSession(session.user)

  useEffect(() => {
    let shown = true
    void readWaitingSignUp().then((found) => shown && setPending(found))
    return () => {
      shown = false
    }
  }, [])

  const submit = async (code: string) => {
    setError(null)
    setBusy(true)
    const answer = await verifySignUp(code)
    setBusy(false)
    if (answer.ok) {
      // A guest keeping the account goes back to `/keep`, which says so; anyone else reloads in.
      if (guest) navigate(next ?? GUEST_PATHS.keep, { replace: true })
      else location.href = afterSignIn(next)
      return
    }
    if ("guestTaken" in answer) {
      navigate(GUEST_PATHS.keepTaken, { replace: true })
      return
    }
    if ("accountExists" in answer) {
      setExists(answer.accountExists)
      return
    }
    if (answer.expired) {
      setPending(null)
      return
    }
    setError(failure(t, answer, SIGN_UP_CODE_FAILURE))
  }

  const resend = async () => {
    setResendNotice(null)
    setResendError(null)
    setResending(true)
    const answer = await resendSignUpCode()
    setResending(false)
    if (answer.ok) setResendNotice(t.t(`SignUpCodeScreen.resent`))
    else if (answer.expired) setPending(null)
    else setResendError(failure(t, answer, `SignUpCodeScreen.resendFailed`))
  }

  const differentAddress = async () => {
    if (pending) handOffAddress(pending.email)
    await cancelPasswordSignUp()
    navigate(withNext(SCREEN_PATHS.signUp, next))
  }

  const handTo = (path: string) => () => {
    if (exists) handOffAddress(exists.email)
    navigate(withNext(path, next))
  }

  return (
    <SignUpCodeScreen
      isSignedIn={session.user !== null && !session.isMfaRequired && !guest}
      pending={pending}
      exists={exists}
      minutes={SIGN_UP_CODE_MINUTES}
      busy={busy}
      error={error}
      resending={resending}
      resendNotice={resendNotice}
      resendError={resendError}
      onSubmit={(code) => void submit(code)}
      onResend={() => void resend()}
      onDifferentAddress={() => void differentAddress()}
      onSignInInstead={handTo(SCREEN_PATHS.signIn)}
      onForgotPassword={handTo(SCREEN_PATHS.forgotPassword)}
      next={next}
      navigate={navigate}
    />
  )
}
