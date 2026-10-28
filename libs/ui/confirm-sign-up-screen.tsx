import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Button } from "@spy4x/preact-ui/button"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { OAUTH_PROVIDER_NAMES, type PendingSignUp } from "@domain/identity"
import { Rich } from "@spy4x/preact-ui/i18n"
import { AuthCard } from "./auth-screen.tsx"
import { useAppText } from "./i18n.ts"
import { type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The message shown when creating the account failed without one of its own, by its key. */
export const CONFIRM_SIGN_UP_FAILURE = `ConfirmSignUpScreen.failed`

export interface ConfirmSignUpScreenProps {
  /**
   * The provider sign-in that waits for an answer; `null` when none waits (it was answered, or
   * took longer than ten minutes), and `undefined` while that is not known yet.
   */
  pending: PendingSignUp | null | undefined
  /** An answer is in flight: both buttons wait and a second answer is refused. */
  busy: boolean
  /** Why the account could not be created; shown under the buttons, and focus moves to it. */
  error: string | null
  /** "I already have an account": nothing is created, and the app returns to sign-in. */
  onBack: () => void
  /** "Create a new account": the app creates it and signs the person in. */
  onCreate: () => void
  navigate?: Navigate
}

/**
 * Asked after a provider sign-in that no account here is known by, before anything is created
 * (#142). A person who already has an account usually lands here by picking another method than
 * last time, and one more press would leave them with two accounts. So going back is the main
 * action and comes first; creating the account is the second one.
 */
export function ConfirmSignUpScreen(
  { pending, busy, error, onBack, onCreate, navigate }: ConfirmSignUpScreenProps,
): JSX.Element {
  const message = useRef<HTMLDivElement>(null)
  const t = useAppText()
  useEffect(() => {
    if (error) message.current?.focus()
  }, [error])

  if (pending === undefined) {
    return (
      <AuthCard title={t.t(`ConfirmSignUpScreen.title`)} e2e="confirm-sign-up">
        <p class="text-sm text-muted">{t.t(`SignUpCodeScreen.loading`)}</p>
      </AuthCard>
    )
  }

  if (pending === null) {
    return (
      <AuthCard
        title={t.t(`ConfirmSignUpScreen.goneTitle`)}
        description={t.t(`ConfirmSignUpScreen.gone`)}
        e2e="confirm-sign-up-gone"
      >
        <Button href={SCREEN_PATHS.signIn} navigate={navigate} class="w-full">
          {t.t(`ConfirmSignUpScreen.backToSignIn`)}
        </Button>
      </AuthCard>
    )
  }

  const provider = OAUTH_PROVIDER_NAMES[pending.provider]
  // The provider's face of the person, so they spot the wrong account before reading it. Shown
  // when the provider shared a name or an address; the sentence ends on a colon to point at it.
  const identity = pending.name || pending.email
    ? (
      <div class="flex items-center gap-3" data-e2e="confirm-sign-up-identity">
        {/* Decorative: the name beside it names the person. No name and no picture: an icon. */}
        <Avatar
          name={pending.name ?? undefined}
          src={pending.avatarUrl ?? undefined}
          alt=""
          size="lg"
          class="shrink-0"
        />
        <div class="flex min-w-0 flex-col">
          {pending.name && (
            <span
              class="font-medium wrap-anywhere"
              translate={false}
              data-e2e="confirm-sign-up-name"
            >
              {pending.name}
            </span>
          )}
          {pending.email && (
            <span
              class="text-sm text-muted wrap-anywhere"
              translate={false}
              data-e2e="confirm-sign-up-email"
            >
              {pending.email}
            </span>
          )}
        </div>
      </div>
    )
    : null

  return (
    <AuthCard
      title={t.t(`ConfirmSignUpScreen.title`)}
      description={t.t(
        identity ? `ConfirmSignUpScreen.unknownColon` : `ConfirmSignUpScreen.unknown`,
        { provider },
      )}
      e2e="confirm-sign-up"
    >
      {identity}
      <p class="text-sm">
        {t.t(`ConfirmSignUpScreen.goBack`, { provider })}
      </p>
      {pending.unconfirmedAccount && (
        <p class="text-sm" role="note" data-e2e="confirm-sign-up-unconfirmed">
          <Rich
            parts={t.parts(`ConfirmSignUpScreen.unconfirmed`)}
            tags={{ strong: (text) => <strong>{text}</strong> }}
          />
        </p>
      )}
      <div class="flex flex-col gap-3">
        <Button
          type="button"
          class="w-full"
          disabled={busy}
          data-e2e="confirm-sign-up-back"
          onClick={onBack}
        >
          {t.t(`ConfirmSignUpScreen.back`)}
        </Button>
        <ScreenForm pending={busy} onSubmit={() => onCreate()}>
          <Button
            type="submit"
            variant="secondary"
            busy={busy}
            busyLabel={t.t(`ConfirmSignUpScreen.creating`)}
            data-e2e="confirm-sign-up-create"
          >
            {t.t(`ConfirmSignUpScreen.create`)}
          </Button>
        </ScreenForm>
      </div>
      <div ref={message} tabIndex={-1} data-e2e="confirm-sign-up-error">
        <ErrorState message={error} />
      </div>
    </AuthCard>
  )
}
