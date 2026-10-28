import { useEffect, useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import {
  DEFAULT_SUBSCRIBER_LIST,
  type SubscriptionConfirmState,
  type UnsubscribeState,
} from "@domain/subscribers"
import {
  SUBSCRIBE_FAILURES,
  SubscribeForm,
  SubscriptionConfirmScreen,
  UnsubscribeScreen,
} from "@ui/subscribe-screen.tsx"
import { useSiteText } from "@ui/site-text.ts"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { subscribersApi, type TokenStep } from "../state/subscribers.ts"

/** Wires `SubscribeForm` to `subscribersApi.subscribe`, for the default list. */
export function SubscribeView() {
  const { t } = useSiteText()
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async () => {
    setError(null)
    setPending(true)
    const result = await subscribersApi.subscribe(email, DEFAULT_SUBSCRIBER_LIST)
    setPending(false)
    if (!result.ok) {
      setError(result.error || t(SUBSCRIBE_FAILURES.subscribe))
      return
    }
    setSent(true)
  }

  return (
    <SubscribeForm
      email={email}
      onEmailChange={setEmail}
      list={DEFAULT_SUBSCRIBER_LIST}
      sent={sent}
      error={error}
      pending={pending}
      onSubmit={submit}
    />
  )
}

/**
 * The list and token of the link that opened the page, read once. While the page is open its
 * requests send no Referer, as for a password reset link: nginx sends the same policy, but a page
 * the service worker serves from its cache comes without it.
 */
function useTokenLink() {
  const [link] = useState(() => new URLSearchParams(location.search))
  useEffect(() => {
    const meta = document.createElement("meta")
    meta.name = "referrer"
    meta.content = "no-referrer"
    document.head.append(meta)
    return () => meta.remove()
  }, [])
  return { list: link.get("list") ?? "", token: link.get("token") ?? "" }
}

/**
 * Runs one token step: the preview on mount, then the click. Once the step is done the token
 * leaves the address bar and history, so a shared screen or a back button holds no live link.
 */
function useTokenStep<S extends string>(
  list: string,
  token: string,
  preview: (list: string, token: string) => Promise<TokenStep<S | "error">>,
  act: (list: string, token: string) => Promise<TokenStep<S | "error">>,
  broken: S,
) {
  const [, navigate] = useLocation()
  const [step, setStep] = useState<TokenStep<S | "error"> | null>(
    list && token ? null : { state: broken },
  )
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (list && token) void preview(list, token).then(setStep)
  }, [])
  const submit = async () => {
    setPending(true)
    const next = await act(list, token)
    setPending(false)
    setStep((current) => ({ ...next, email: next.email ?? current?.email }))
    if (next.state === "done") navigate(location.pathname, { replace: true })
  }
  return { step, pending, submit, navigate }
}

/** Wires `SubscriptionConfirmScreen` to the confirm link's preview and confirm. */
export function SubscriptionConfirmView() {
  const { list, token } = useTokenLink()
  const { step, pending, submit, navigate } = useTokenStep<SubscriptionConfirmState>(
    list,
    token,
    subscribersApi.previewConfirm,
    subscribersApi.confirm,
    "invalid",
  )
  if (!step) return <LoadingSpinner size="lg" label="Checking the link…" class="min-h-[50vh]" />
  return (
    <SubscriptionConfirmScreen
      state={step.state}
      email={step.email}
      list={list}
      token={token}
      error={null}
      pending={pending}
      onSubmit={submit}
      navigate={navigate}
    />
  )
}

/** Wires `UnsubscribeScreen` to the unsubscribe link's preview and removal. */
export function UnsubscribeView() {
  const { list, token } = useTokenLink()
  const { step, pending, submit, navigate } = useTokenStep<UnsubscribeState>(
    list,
    token,
    subscribersApi.previewUnsubscribe,
    subscribersApi.unsubscribe,
    "not-recognised",
  )
  if (!step) return <LoadingSpinner size="lg" label="Checking the link…" class="min-h-[50vh]" />
  return (
    <UnsubscribeScreen
      state={step.state}
      email={step.email}
      list={list}
      token={token}
      error={null}
      pending={pending}
      onSubmit={submit}
      navigate={navigate}
    />
  )
}
