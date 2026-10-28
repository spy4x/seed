// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Button } from "@spy4x/preact-ui/button"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { OAUTH_PROVIDER_NAMES, type PendingSignUp } from "@domain/identity"
import { AuthCard } from "./auth-screen.tsx"
import { type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The message shown when creating the account failed without a message of its own. */
export const CONFIRM_SIGN_UP_FAILURE = "Creating your account failed"

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
  useEffect(() => {
    if (error) message.current?.focus()
  }, [error])

  if (pending === undefined) {
    return (
      <AuthCard title="Create a new account?" e2e="confirm-sign-up">
        <p class="text-sm text-muted">Loading…</p>
      </AuthCard>
    )
  }

  if (pending === null) {
    return (
      <AuthCard
        title="Nothing to confirm"
        description="This took longer than ten minutes, or was already answered. Nothing was created."
        e2e="confirm-sign-up-gone"
      >
        <Button href={SCREEN_PATHS.signIn} navigate={navigate} class="w-full">
          Back to sign in
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
            <span class="font-medium wrap-anywhere" data-e2e="confirm-sign-up-name">
              {pending.name}
            </span>
          )}
          {pending.email && (
            <span class="text-sm text-muted wrap-anywhere" data-e2e="confirm-sign-up-email">
              {pending.email}
            </span>
          )}
        </div>
      </div>
    )
    : null

  return (
    <AuthCard
      title="Create a new account?"
      description={`No account here signs in with this ${provider} account${identity ? ":" : "."}`}
      e2e="confirm-sign-up"
    >
      {identity}
      <p class="text-sm">
        If you already have an account, go back and sign in the way you did before. You can then
        link {provider} on your profile. Nothing has been created yet.
      </p>
      {pending.unconfirmedAccount && (
        <p class="text-sm" role="note" data-e2e="confirm-sign-up-unconfirmed">
          <strong>An account here already uses this address, but never confirmed it.</strong>{" "}
          Creating a new account locks that one: its password stops working and its devices are
          signed out. To keep it, go back, sign in with its password and confirm the address with
          the code we e-mail you.
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
          I already have an account: go back to sign in
        </Button>
        <ScreenForm pending={busy} onSubmit={() => onCreate()}>
          <Button
            type="submit"
            variant="secondary"
            busy={busy}
            busyLabel="Creating your account…"
            data-e2e="confirm-sign-up-create"
          >
            Create a new account
          </Button>
        </ScreenForm>
      </div>
      <div ref={message} tabIndex={-1} data-e2e="confirm-sign-up-error">
        <ErrorState message={error} />
      </div>
    </AuthCard>
  )
}
