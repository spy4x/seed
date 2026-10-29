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
import { useSiteText } from "./site-text.ts"

/**
 * The messages shown when a step failed without a message of its own, by their key in the `site`
 * catalog.
 */
export const SUBSCRIBE_FAILURES = {
  subscribe: "SubscribeFailure.subscribe",
  confirm: "SubscribeFailure.confirm",
  unsubscribe: "SubscribeFailure.unsubscribe",
} as const

/**
 * Turns one of the newsletter's own addresses into the page's: the website puts its language's
 * prefix in front (`/subscribe` → `/de/subscribe`), so a form answers in the language it was sent
 * from. Without it the addresses stay as they are.
 */
export type LocalizePath = (path: string) => string

const samePath: LocalizePath = (path) => path

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
  localize?: LocalizePath
  /** The page's language, posted as a hidden field: the mails are written in it. */
  language?: string
}

/**
 * Asks for the address to send news to. Without `onSubmit` the form posts
 * `{ email, list, language }` to its route; with it the app takes the submit over. The answer is the same for an address already on
 * the list, so the form never says which.
 */
export function SubscribeForm(
  { email, onEmailChange, list, sent, error, pending, onSubmit, localize = samePath, language }:
    SubscribeFormProps,
): JSX.Element {
  const { t } = useSiteText()
  const field = useFocusOnError<HTMLInputElement>(error)
  const status = useFocusOnChange<HTMLParagraphElement>(sent ? "sent" : "form")
  if (sent) {
    return (
      <Outcome
        title={t("SubscribeForm.sentTitle")}
        text={t("SubscribeForm.sentText")}
        statusRef={status}
        e2e="subscribe-sent"
        class={SUBSCRIBE_WIDTH}
      />
    )
  }
  return (
    <AuthCard
      title={t("SubscribeForm.title")}
      description={t("SubscribeForm.intro")}
      class={SUBSCRIBE_WIDTH}
    >
      <ScreenForm action={localize(FORM_ACTIONS.subscribe)} pending={pending} onSubmit={onSubmit}>
        <Stack>
          <input type="hidden" name="list" value={list} />
          <input type="hidden" name="language" value={language ?? ""} />
          <Field id="subscribe-email" label={t("SubscribeForm.email")} error={error} required>
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
            busyLabel={t("SubscribeForm.sending")}
          >
            {t("SubscribeForm.submit")}
          </Button>
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}

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
  localize?: LocalizePath
  /**
   * One link onward once the address is confirmed, such as back to a product's catalog. Left out,
   * the confirmation ends the page.
   */
  onward?: { href: string; label: string }
  /** The page's language, posted as a hidden field: the subscriber's mails are written in it. */
  language?: string
}

/**
 * The page a confirm link opens. It asks for a click before anything is stored, so a mail scanner
 * that follows the link subscribes no one. The form posts `{ list, token, language }` to its route; with
 * `onSubmit` the app takes the submit over.
 */
export function SubscriptionConfirmScreen(
  {
    state,
    email,
    list,
    token,
    error,
    pending,
    onSubmit,
    navigate,
    localize = samePath,
    onward,
    language,
  }: SubscriptionConfirmScreenProps,
): JSX.Element {
  const { t } = useSiteText()
  const status = useFocusOnChange<HTMLParagraphElement>(state)
  const askAgain = {
    href: localize(SCREEN_PATHS.subscribe),
    label: t("SubscriptionConfirm.askAgain"),
  }
  if (state === "done") {
    return (
      <Outcome
        title={t("SubscriptionConfirm.doneTitle")}
        text={t("SubscriptionConfirm.doneText")}
        link={onward}
        navigate={navigate}
        statusRef={status}
        e2e="subscription-confirm-done"
      />
    )
  }
  if (state === "expired") {
    return (
      <Outcome
        title={t("SubscriptionConfirm.expiredTitle")}
        text={t("SubscriptionConfirm.expiredText")}
        link={askAgain}
        navigate={navigate}
        statusRef={status}
        e2e="subscription-confirm-expired"
      />
    )
  }
  if (state === "invalid" || !list || !token) {
    return (
      <Outcome
        title={t("SubscriptionConfirm.invalidTitle")}
        text={t("SubscriptionConfirm.invalidText")}
        link={askAgain}
        navigate={navigate}
        statusRef={status}
        e2e="subscription-confirm-invalid"
      />
    )
  }
  return (
    <AuthCard
      title={t("SubscriptionConfirm.title")}
      description={email
        ? t("SubscriptionConfirm.question", { email })
        : t("SubscriptionConfirm.questionNoEmail")}
      e2e="subscription-confirm"
    >
      <ScreenForm
        action={localize(FORM_ACTIONS.subscribeConfirm)}
        pending={pending}
        onSubmit={onSubmit}
      >
        <Stack>
          <input type="hidden" name="list" value={list} />
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="language" value={language ?? ""} />
          <FormError
            error={error ?? (state === "error" ? t(SUBSCRIBE_FAILURES.confirm) : null)}
            e2e="subscription-confirm-error"
          />
          <Button
            type="submit"
            data-e2e="subscription-confirm-submit"
            busy={pending}
            busyLabel={t("SubscriptionConfirm.confirming")}
          >
            {t("SubscriptionConfirm.submit")}
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
  localize?: LocalizePath
}

/**
 * The page an unsubscribe link opens: one click removes the address. The form posts
 * `{ list, token }` to its route; with `onSubmit` the app takes the submit over. A mail client's
 * one-click unsubscribe never sees this page: it posts to the API directly.
 */
export function UnsubscribeScreen(
  {
    state,
    email,
    list,
    token,
    error,
    pending,
    onSubmit,
    navigate,
    localize = samePath,
  }: UnsubscribeScreenProps,
): JSX.Element {
  const { t } = useSiteText()
  const status = useFocusOnChange<HTMLParagraphElement>(state)
  if (state === "done") {
    return (
      <Outcome
        title={t("Unsubscribe.doneTitle")}
        text={t("Unsubscribe.doneText")}
        link={{ href: localize(SCREEN_PATHS.subscribe), label: t("Unsubscribe.again") }}
        navigate={navigate}
        statusRef={status}
        e2e="unsubscribe-done"
      />
    )
  }
  if (state === "not-recognised" || !list || !token) {
    return (
      <Outcome
        title={t("SubscriptionConfirm.invalidTitle")}
        text={t("Unsubscribe.invalidText")}
        statusRef={status}
        e2e="unsubscribe-not-recognised"
      />
    )
  }
  return (
    <AuthCard
      title={t("Unsubscribe.title")}
      description={email ? t("Unsubscribe.question", { email }) : t("Unsubscribe.questionNoEmail")}
      e2e="unsubscribe"
    >
      <ScreenForm action={localize(FORM_ACTIONS.unsubscribe)} pending={pending} onSubmit={onSubmit}>
        <Stack>
          <input type="hidden" name="list" value={list} />
          <input type="hidden" name="token" value={token} />
          <FormError
            error={error ?? (state === "error" ? t(SUBSCRIBE_FAILURES.unsubscribe) : null)}
            e2e="unsubscribe-error"
          />
          <Button
            type="submit"
            data-e2e="unsubscribe-submit"
            busy={pending}
            busyLabel={t("Unsubscribe.unsubscribing")}
          >
            {t("Unsubscribe.submit")}
          </Button>
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}
