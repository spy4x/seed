import type { JSX, Ref } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { useFocusOnChange } from "@spy4x/preact-ui/use-focus-on-change"
import { useFocusOnError } from "@spy4x/preact-ui/use-focus-on-error"
import type { SubscriptionConfirmState, UnsubscribeState } from "@domain/subscribers"
import { AuthCard } from "./auth-screen.tsx"
import { FORM_ACTIONS, type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The messages shown when a step failed without a message of its own. */
export const SUBSCRIBE_FAILURES = {
  subscribe: "Could not send the link",
  confirm: "Could not confirm the subscription. Try again in a minute.",
  unsubscribe: "Could not unsubscribe. Try again in a minute.",
} as const

/**
 * A card with a heading and a sentence, and optionally one link onward. The sentence takes focus
 * through `statusRef` when the card replaces a form on the same page, so a screen reader reads the
 * outcome. `class` is only for the subscribe page, which the website places in a wide column.
 */
function Outcome(
  { title, text, link, navigate, statusRef, e2e, class: className }: {
    title: string
    text: string
    link?: { href: string; label: string }
    navigate?: Navigate
    statusRef?: Ref<HTMLParagraphElement>
    e2e: string
    class?: string
  },
): JSX.Element {
  return (
    <AuthCard title={title} e2e={e2e} class={className}>
      <p
        class="text-sm text-muted outline-none"
        role="status"
        tabIndex={-1}
        ref={statusRef}
        data-e2e={`${e2e}-status`}
      >
        {text}
      </p>
      {link && (
        <Button href={link.href} navigate={navigate} variant="secondary" class="w-full">
          {link.label}
        </Button>
      )}
    </AuthCard>
  )
}

/**
 * The website (`apps/mpa`) puts the subscribe form beside its introduction in a wide band, so the
 * form keeps the 28 rem of a signed-out column itself; in the app's `PublicFrame` it changes
 * nothing. Inputs never stretch across a wide column.
 */
const SUBSCRIBE_WIDTH = "max-w-md"

const SUBSCRIBE_INTRO =
  "Enter your address. We send a link to confirm it first, and every mail has a link to unsubscribe."

/** An error under a form that the API tied to no field. It takes focus when it appears. */
function FormError({ error, e2e }: { error: string | null; e2e: string }): JSX.Element | null {
  const message = useFocusOnError<HTMLParagraphElement>(error)
  if (!error) return null
  return (
    <p
      class="text-sm text-danger outline-none"
      role="alert"
      tabIndex={-1}
      ref={message}
      data-e2e={e2e}
    >
      {error}
    </p>
  )
}

export interface SubscribeFormProps {
  /** The address typed so far. */
  email: string
  onEmailChange: (email: string) => void
  /** The list to join, posted as a hidden field. */
  list: string
  /** The API accepted the request: the form says to check the inbox instead of asking again. */
  sent: boolean
  error: string | null
  pending: boolean
  onSubmit?: () => void
}

/**
 * Asks for the address to send news to. Without `onSubmit` the form posts `{ email, list }` to its
 * route; with it the app takes the submit over. The answer is the same for an address already on
 * the list, so the form never says which.
 */
export function SubscribeForm(
  { email, onEmailChange, list, sent, error, pending, onSubmit }: SubscribeFormProps,
): JSX.Element {
  const field = useFocusOnError<HTMLInputElement>(error)
  const status = useFocusOnChange<HTMLParagraphElement>(sent ? "sent" : "form")
  if (sent) {
    return (
      <Outcome
        title="Check your inbox"
        text="A link to confirm your subscription is on its way. It works for three days."
        statusRef={status}
        e2e="subscribe-sent"
        class={SUBSCRIBE_WIDTH}
      />
    )
  }
  return (
    <AuthCard
      title="Get the news by e-mail"
      description={SUBSCRIBE_INTRO}
      class={SUBSCRIBE_WIDTH}
    >
      <ScreenForm action={FORM_ACTIONS.subscribe} pending={pending} onSubmit={onSubmit}>
        <Stack>
          <input type="hidden" name="list" value={list} />
          <Field id="subscribe-email" label="E-mail" error={error} required>
            <Input
              ref={field}
              data-e2e="subscribe-email"
              name="email"
              type="email"
              autocomplete="email"
              value={email}
              onInput={(e) => onEmailChange(e.currentTarget.value)}
              required
            />
          </Field>
          <Button
            type="submit"
            data-e2e="subscribe-submit"
            busy={pending}
            busyLabel="Sending…"
          >
            Subscribe
          </Button>
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}

const ASK_AGAIN = { href: SCREEN_PATHS.subscribe, label: "Ask for a new link" }

export interface SubscriptionConfirmScreenProps {
  state: SubscriptionConfirmState
  /** The address the link carries, shown while it asks for the click. */
  email?: string
  /** The list and token from the link, posted back as hidden fields. */
  list: string
  token: string
  /** A message for the confirm step; `state: "error"` without one shows a default. */
  error: string | null
  pending: boolean
  onSubmit?: () => void
  navigate?: Navigate
}

/**
 * The page a confirm link opens. It asks for a click before anything is stored, so a mail scanner
 * that follows the link subscribes no one. The form posts `{ list, token }` to its route; with
 * `onSubmit` the app takes the submit over.
 */
export function SubscriptionConfirmScreen(
  { state, email, list, token, error, pending, onSubmit, navigate }: SubscriptionConfirmScreenProps,
): JSX.Element {
  const status = useFocusOnChange<HTMLParagraphElement>(state)
  if (state === "done") {
    return (
      <Outcome
        title="You are subscribed"
        text="Thank you. A welcome mail is on its way, with a link to unsubscribe."
        statusRef={status}
        e2e="subscription-confirm-done"
      />
    )
  }
  if (state === "expired") {
    return (
      <Outcome
        title="This link has expired"
        text="A confirm link works for three days. Ask for a new one."
        link={ASK_AGAIN}
        navigate={navigate}
        statusRef={status}
        e2e="subscription-confirm-expired"
      />
    )
  }
  if (state === "invalid" || !list || !token) {
    return (
      <Outcome
        title="This link does not work"
        text="Open the link from the mail again, or ask for a new one."
        link={ASK_AGAIN}
        navigate={navigate}
        statusRef={status}
        e2e="subscription-confirm-invalid"
      />
    )
  }
  return (
    <AuthCard
      title="Confirm your subscription"
      description={email ? `Send the news to ${email}?` : "Send the news to your address?"}
      e2e="subscription-confirm"
    >
      <ScreenForm action={FORM_ACTIONS.subscribeConfirm} pending={pending} onSubmit={onSubmit}>
        <Stack>
          <input type="hidden" name="list" value={list} />
          <input type="hidden" name="token" value={token} />
          <FormError
            error={error ?? (state === "error" ? SUBSCRIBE_FAILURES.confirm : null)}
            e2e="subscription-confirm-error"
          />
          <Button
            type="submit"
            data-e2e="subscription-confirm-submit"
            busy={pending}
            busyLabel="Confirming…"
          >
            Confirm
          </Button>
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}

export interface UnsubscribeScreenProps {
  state: UnsubscribeState
  /** The address the link names, shown while it asks for the click. */
  email?: string
  /** The list and token from the link, posted back as hidden fields. */
  list: string
  token: string
  /** A message for the confirm step; `state: "error"` without one shows a default. */
  error: string | null
  pending: boolean
  onSubmit?: () => void
  navigate?: Navigate
}

/**
 * The page an unsubscribe link opens: one click removes the address. The form posts
 * `{ list, token }` to its route; with `onSubmit` the app takes the submit over. A mail client's
 * one-click unsubscribe never sees this page: it posts to the API directly.
 */
export function UnsubscribeScreen(
  { state, email, list, token, error, pending, onSubmit, navigate }: UnsubscribeScreenProps,
): JSX.Element {
  const status = useFocusOnChange<HTMLParagraphElement>(state)
  if (state === "done") {
    return (
      <Outcome
        title="You are unsubscribed"
        text="No more news goes to this address."
        link={{ href: SCREEN_PATHS.subscribe, label: "Subscribe again" }}
        navigate={navigate}
        statusRef={status}
        e2e="unsubscribe-done"
      />
    )
  }
  if (state === "not-recognised" || !list || !token) {
    return (
      <Outcome
        title="This link does not work"
        text="The address may already be unsubscribed. Open the link from the latest mail."
        statusRef={status}
        e2e="unsubscribe-not-recognised"
      />
    )
  }
  return (
    <AuthCard
      title="Unsubscribe"
      description={email
        ? `Stop sending the news to ${email}?`
        : "Stop sending the news to your address?"}
      e2e="unsubscribe"
    >
      <ScreenForm action={FORM_ACTIONS.unsubscribe} pending={pending} onSubmit={onSubmit}>
        <Stack>
          <input type="hidden" name="list" value={list} />
          <input type="hidden" name="token" value={token} />
          <FormError
            error={error ?? (state === "error" ? SUBSCRIBE_FAILURES.unsubscribe : null)}
            e2e="unsubscribe-error"
          />
          <Button
            type="submit"
            data-e2e="unsubscribe-submit"
            busy={pending}
            busyLabel="Unsubscribing…"
          >
            Unsubscribe
          </Button>
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}
