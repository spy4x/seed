import { useEffect, useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import {
  EMAIL_FAILURES,
  type EmailMessages,
  EmailScreen,
  EmailUnavailable,
  type EmailValues,
} from "@ui/email-screen.tsx"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { providerProofOf } from "@ui/provider-proof.tsx"
import { emailStore } from "../state/email.ts"
import { createSignInMethodsStore } from "../state/sign-in-methods.ts"
import { isProviderProofFresh } from "./provider-proof-fresh.ts"
import { sessionState } from "../state/session.ts"
import { toasts } from "../state/toasts.ts"

const NO_MESSAGES: EmailMessages = { verify: null, send: null, change: null }

/** Wires `EmailScreen` to the e-mail store. Holds what the person typed, what is in flight and what failed. */
export function EmailView() {
  const [, navigate] = useLocation()
  const status = emailStore.status.value
  const [values, setValues] = useState<EmailValues>({ code: "", email: "", password: "" })
  const [errors, setErrors] = useState<EmailMessages>(NO_MESSAGES)
  const [notices, setNotices] = useState<Pick<EmailMessages, "send" | "change">>({
    send: null,
    change: null,
  })
  const [pending, setPending] = useState({ verify: false, send: false, change: false })
  // An account with no password confirms a change with a provider sign-in, not a password.
  const [methods] = useState(() => createSignInMethodsStore())

  const session = sessionState.value
  const signedIn = session.user !== null && !session.isMfaRequired

  // Signed out, here or in another tab, the app's sign-in gate takes over and returns here after.
  useEffect(() => {
    if (!signedIn) return
    void emailStore.refresh()
    void methods.load()
  }, [signedIn])

  if (!status) {
    if (emailStore.loadFailed.value) {
      return <EmailUnavailable onRetry={() => void emailStore.refresh()} />
    }
    return <LoadingSpinner size="lg" label="Loading…" class="min-h-[50vh]" />
  }

  /** Runs one form's call: clears its messages, marks it busy, then shows what came back. */
  const run = async (
    form: keyof EmailMessages,
    call: () => ReturnType<typeof emailStore.send>,
    onDone: (message: string) => void,
  ) => {
    setErrors((current) => ({ ...current, [form]: null }))
    setPending((current) => ({ ...current, [form]: true }))
    const outcome = await call()
    setPending((current) => ({ ...current, [form]: false }))
    if (!outcome.ok) {
      setErrors((current) => ({ ...current, [form]: outcome.error || EMAIL_FAILURES[form] }))
      return
    }
    onDone(outcome.message)
  }

  const providerProof = providerProofOf(
    methods.methods.value,
    isProviderProofFresh(methods.providerProofUntil.value),
  )

  return (
    <EmailScreen
      status={status}
      values={values}
      onValueChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
      errors={errors}
      notices={notices}
      pending={pending}
      onVerify={() =>
        run("verify", () => emailStore.verify(values.code), () => {
          setValues((current) => ({ ...current, code: "" }))
          setNotices({ send: null, change: null })
          toasts.success({
            title: "Verified",
            body: "Your e-mail address is verified.",
            dataE2E: "email-verified",
          })
        })}
      onSend={() =>
        run("send", () => emailStore.send(), (message) => {
          setNotices((current) => ({ ...current, send: message }))
        })}
      onChange={() =>
        run("change", () =>
          emailStore.change(
            values.email,
            providerProof ? undefined : values.password,
          ), (message) => {
          setValues({ code: "", email: "", password: "" })
          setNotices({ send: null, change: message })
        })}
      providerProof={providerProof}
      navigate={navigate}
    />
  )
}
