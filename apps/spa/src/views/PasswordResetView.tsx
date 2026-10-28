import { useEffect, useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import {
  ForgotPasswordScreen,
  PASSWORD_RESET_FAILURES,
  ResetPasswordScreen,
} from "@ui/password-reset-screen.tsx"
import { bootstrapSession, requestPasswordReset, resetPassword } from "../state/auth.ts"
import { takeHandedOffAddress } from "../state/address-handoff.ts"
import { useAppText } from "@ui/i18n.ts"

/** Wires `ForgotPasswordScreen` to `requestPasswordReset`. */
export function ForgotPasswordView() {
  const [, navigate] = useLocation()
  const t = useAppText()
  // The address "Forgot your password?" handed over after a sign-up found its account (#142).
  const [email, setEmail] = useState(() => takeHandedOffAddress() ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    setError(null)
    setPending(true)
    const result = await requestPasswordReset(email)
    setPending(false)
    if (!result.ok) {
      setError(result.error || t.t(PASSWORD_RESET_FAILURES.forgot))
      return
    }
    // The screen says it in its own words: the API's message is English only.
    setSent(true)
  }

  return (
    <ForgotPasswordScreen
      email={email}
      onEmailChange={setEmail}
      sent={sent}
      error={error}
      pending={pending}
      onSubmit={submit}
      navigate={navigate}
    />
  )
}

/** Wires `ResetPasswordScreen` to `resetPassword`, with the address and code from the link. */
export function ResetPasswordView() {
  const [, navigate] = useLocation()
  const t = useAppText()
  const [link] = useState(() => new URLSearchParams(location.search))
  const [newPassword, setNewPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const email = link.get("email") ?? ""
  const code = link.get("code") ?? ""

  // The code is in the address: while this page is open, no request sends it as the Referer. nginx
  // sends the same policy, but a page the service worker serves from its cache comes without it.
  useEffect(() => {
    const meta = document.createElement("meta")
    meta.name = "referrer"
    meta.content = "no-referrer"
    document.head.append(meta)
    return () => meta.remove()
  }, [])

  const submit = async () => {
    setError(null)
    setPending(true)
    const result = await resetPassword(email, code, newPassword)
    setPending(false)
    if (!result.ok) {
      setError(result.error || t.t(PASSWORD_RESET_FAILURES.reset))
      return
    }
    setDone(true)
    // The reset signed out every session, this browser's too: forget the user it showed.
    await bootstrapSession()
  }

  return (
    <ResetPasswordScreen
      email={email}
      code={code}
      newPassword={newPassword}
      onNewPasswordChange={setNewPassword}
      done={done}
      error={error}
      pending={pending}
      onSubmit={submit}
      navigate={navigate}
    />
  )
}
