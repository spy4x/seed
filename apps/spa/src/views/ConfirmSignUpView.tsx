import { useEffect, useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import type { PendingSignUp } from "@domain/identity"
import { AUTH_PATHS } from "@ui/auth-screen.tsx"
import { CONFIRM_SIGN_UP_FAILURE, ConfirmSignUpScreen } from "@ui/confirm-sign-up-screen.tsx"
import { afterSignIn, SCREEN_PATHS } from "@ui/progressive.tsx"
import { confirmProviderSignUp } from "../state/auth.ts"
import { cancelSignUp, readPendingSignUp } from "../state/sign-in-methods.ts"

/**
 * Wires `ConfirmSignUpScreen`: reads the provider sign-up that waits, and answers it. Going back
 * forgets it and opens sign-in; creating the account reloads onto the profile, as sign-up does.
 */
export function ConfirmSignUpView() {
  const [, navigate] = useLocation()
  const [pending, setPending] = useState<PendingSignUp | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let shown = true
    void readPendingSignUp().then((found) => shown && setPending(found))
    return () => {
      shown = false
    }
  }, [])

  const back = async () => {
    setBusy(true)
    await cancelSignUp()
    setBusy(false)
    navigate(SCREEN_PATHS.signIn)
  }

  const create = async () => {
    setError(null)
    setBusy(true)
    const result = await confirmProviderSignUp().catch(() => ({
      ok: false,
      mfaRequired: false,
      error: undefined,
    }))
    setBusy(false)
    if (!result.ok) {
      setError(result.error || CONFIRM_SIGN_UP_FAILURE)
      return
    }
    location.href = result.mfaRequired ? AUTH_PATHS["one-time-code"] : afterSignIn(null)
  }

  return (
    <ConfirmSignUpScreen
      pending={pending}
      busy={busy}
      error={error}
      onBack={() => void back()}
      onCreate={() => void create()}
      navigate={navigate}
    />
  )
}
