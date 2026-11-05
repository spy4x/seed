import { useEffect, useRef, useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { PASSWORD_RESET_CODE_MINUTES } from "@domain/identity"
import {
  ForgotPasswordScreen,
  PASSWORD_RESET_FAILURES,
  RememberedIt,
  ResetPasswordScreen,
} from "@ui/password-reset-screen.tsx"
import { CodeStep, DeadCode, SIGN_IN_CODE_MESSAGES } from "@ui/sign-in-code-screen.tsx"
import {
  bootstrapSession,
  cancelReset,
  readWaitingReset,
  requestPasswordReset,
  resendResetCode,
  resetPassword,
  verifyResetCode,
} from "../state/auth.ts"
import { takeHandedOffAddress } from "../state/address-handoff.ts"
import { codeFailure, readyAtOf } from "./SignInCodeView.tsx"
import { useAppText } from "@ui/i18n.ts"

/** Where the reset stands: the address, its code, a dead code, the new password, or done. */
type ResetStep = "address" | "code" | "dead" | "choose" | "done"

/**
 * `/forgot-password`: the address, the mailed code, then the new password, on one route.
 * The server's cookie says whether a code waits for this browser, so a reload stays on the code
 * step. The right code gives a token that this page keeps in memory only, never in its address, and
 * sends with the new password. A token that ran out sends the person back to the address, kept.
 */
export function ForgotPasswordView() {
  const [, navigate] = useLocation()
  const t = useAppText()
  // The address "Forgot your password?" handed over after a sign-up found its account.
  const [email, setEmail] = useState(() => takeHandedOffAddress() ?? "")
  const [step, setStep] = useState<ResetStep>("address")
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [resending, setResending] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const token = useRef<string | null>(null)

  useEffect(() => {
    void readWaitingReset().then((waiting) => {
      if (!waiting) return
      setEmail(waiting)
      setStep((now) => now === "address" ? "code" : now)
    })
  }, [])

  /** A code went to the address now: the code step opens, and an old complaint goes. */
  const markSent = () => {
    setSentAt(Date.now())
    setError(null)
    setStep("code")
  }

  const startOver = () => {
    token.current = null
    setNewPassword("")
    setError(null)
    setStep("address")
  }

  const submit = async () => {
    setError(null)
    setPending(true)
    const answer = await requestPasswordReset(email.trim())
    // The step names the address as the server keeps it, trimmed and in lower case.
    const kept = answer.ok ? await readWaitingReset() : null
    setPending(false)
    if (answer.ok) {
      if (kept) setEmail(kept)
      return markSent()
    }
    setError(codeFailure(t, answer, PASSWORD_RESET_FAILURES.forgot))
  }

  const resend = async () => {
    setResending(true)
    // A dead code's request may be gone: a new request for the same address starts again.
    const answer = step === "dead"
      ? await requestPasswordReset(email.trim())
      : await resendResetCode()
    setResending(false)
    if (answer.ok) return markSent()
    if ("dead" in answer && answer.dead) return setStep("dead")
    setError(codeFailure(t, answer, PASSWORD_RESET_FAILURES.forgot))
  }

  const check = async (code: string) => {
    setError(null)
    setPending(true)
    const result = await verifyResetCode(code)
    setPending(false)
    if (result.ok) {
      token.current = result.token
      setStep("choose")
    } else if (result.dead) setStep("dead")
    else setError(codeFailure(t, result, SIGN_IN_CODE_MESSAGES.checkFailed))
  }

  const save = async () => {
    if (token.current === null) return startOver()
    setError(null)
    setPending(true)
    const result = await resetPassword(token.current, newPassword)
    setPending(false)
    if (result.ok) {
      token.current = null
      setStep("done")
      // The reset signed out every session, this browser's too: forget the user it showed.
      await bootstrapSession()
      return
    }
    if (result.refused) {
      startOver()
      setError(t.t(`PasswordResetScreen.tookTooLong`))
      return
    }
    setError(codeFailure(t, result, PASSWORD_RESET_FAILURES.reset))
  }

  const differentAddress = () => {
    void cancelReset()
    startOver()
  }

  if (step === "code") {
    return (
      <CodeStep
        email={email.trim()}
        sentence={`PasswordResetScreen.sent`}
        minutes={PASSWORD_RESET_CODE_MINUTES}
        checking={pending}
        error={error}
        onCode={(code) => void check(code)}
        readyAt={readyAtOf(sentAt === null ? null : { email, sentAt })}
        resending={resending}
        onResend={() => void resend()}
        onDifferentAddress={differentAddress}
        after={<RememberedIt navigate={navigate} />}
      />
    )
  }
  if (step === "dead") {
    return (
      <DeadCode
        minutes={PASSWORD_RESET_CODE_MINUTES}
        resending={resending}
        onResend={() => void resend()}
        onDifferentAddress={differentAddress}
        after={<RememberedIt navigate={navigate} />}
      />
    )
  }
  if (step === "choose" || step === "done") {
    return (
      <ResetPasswordScreen
        email={email.trim()}
        newPassword={newPassword}
        onNewPasswordChange={setNewPassword}
        done={step === "done"}
        error={error}
        pending={pending}
        onSubmit={() => void save()}
        onStartOver={differentAddress}
        navigate={navigate}
      />
    )
  }
  return (
    <ForgotPasswordScreen
      email={email}
      onEmailChange={setEmail}
      error={error}
      pending={pending}
      onSubmit={() => void submit()}
      navigate={navigate}
    />
  )
}
