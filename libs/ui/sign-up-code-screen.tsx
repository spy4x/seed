import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import {
  type ExistingAccountAnswer,
  OAUTH_PROVIDER_NAMES,
  type WaitingPasswordSignUp,
} from "@domain/identity"
import { Rich } from "@spy4x/preact-ui/i18n"
import { AuthCard, providerStartPath } from "./auth-screen.tsx"
import { useAppText } from "./i18n.ts"
import { type Navigate, SCREEN_PATHS, withNext } from "./progressive.tsx"
import { CodeStep } from "./sign-in-code-screen.tsx"

/** The message shown when checking the code failed without one of its own, by its key in `app`. */
export const SIGN_UP_CODE_FAILURE = `SignUpCodeScreen.checkFailed`

/** The message shown when the browser is offline and a request could not leave it, by its key. */
export const SIGN_UP_OFFLINE = `SignUpCodeScreen.offline`

export interface SignUpCodeScreenProps {
  /** Signed in with every factor done: the page says so instead of asking for a code. */
  isSignedIn: boolean
  /**
   * The sign-up that waits for its code; `null` when none waits (it took too long, or its code
   * was guessed at too often), and `undefined` while that is not known yet.
   */
  pending: WaitingPasswordSignUp | null | undefined
  /** The right code found an account that already uses the address. Nothing was created. */
  exists: ExistingAccountAnswer | null
  /** How long a code works, in minutes. */
  minutes: number
  /** The code is being checked: the form waits and a second submit is refused. */
  busy: boolean
  /** Why the code was refused; shown under the field, which takes focus with its text selected. */
  error: string | null
  /** A new code is being asked for. */
  resending: boolean
  /** Why a new code was refused. */
  resendError: string | null
  /** When a new code may be asked for, in milliseconds since the epoch. */
  readyAt?: number
  onSubmit: (code: string) => void
  onResend: () => void
  /** "Use a different address": the app forgets this sign-up and returns to the form. */
  onDifferentAddress: () => void
  /** "Sign in instead": the app opens sign-in, handing it the address in memory. */
  onSignInInstead: () => void
  /** "Forgot your password?": the app opens the reset page, handing it the address in memory. */
  onForgotPassword: () => void
  /** The page to return to after sign-in, already checked by the app. Every link keeps it. */
  next?: string | null
  navigate?: Navigate
}

/**
 * The step between the sign-up form and the app: "Check your inbox" asks for the code mailed
 * to the address, the same for every address. The right code either signs the new account in,
 * which the app does, or ends here at "You already have an account", which hands the person the
 * account's own way in. With no sign-up waiting, "This sign-up expired" starts again.
 */
export function SignUpCodeScreen(props: SignUpCodeScreenProps): JSX.Element {
  const { isSignedIn, pending, exists, minutes, next = null, navigate } = props
  const t = useAppText()

  if (isSignedIn && !exists) {
    return (
      <AuthCard
        title={t.t(`AuthScreen.signedInTitle`)}
        description={t.t(`AuthScreen.signedInText`)}
      >
        <Button href={SCREEN_PATHS.profile} navigate={navigate} class="w-full">
          {t.t(`AuthScreen.openProfile`)}
        </Button>
      </AuthCard>
    )
  }
  if (exists) return <AccountExists {...props} account={exists} />
  if (pending === undefined) {
    return (
      <AuthCard title={t.t(`SignUpCodeScreen.title`)} e2e="sign-up-code">
        <p class="text-sm text-muted">{t.t(`SignUpCodeScreen.loading`)}</p>
      </AuthCard>
    )
  }
  if (pending === null) return <Expired minutes={minutes} next={next} navigate={navigate} />
  return <CheckInbox {...props} pending={pending} />
}

/**
 * The code step, the same `CodeStep` as sign-in and reset: the code field, a new code once
 * the wait ends, and the way back to another address.
 */
function CheckInbox(
  {
    pending,
    minutes,
    busy,
    error,
    resending,
    resendError,
    readyAt,
    onSubmit,
    onResend,
    onDifferentAddress,
  }: SignUpCodeScreenProps & { pending: WaitingPasswordSignUp },
): JSX.Element {
  return (
    <CodeStep
      email={pending.email}
      sentence={`CodeStep.sent`}
      minutes={minutes}
      checking={busy}
      error={error ?? resendError}
      onCode={onSubmit}
      readyAt={readyAt}
      resending={resending}
      onResend={onResend}
      onDifferentAddress={onDifferentAddress}
      e2e="sign-up-code"
    />
  )
}

/** "You already have an account": the right code, an address an account already uses. */
function AccountExists(
  { account, next = null, onSignInInstead, onForgotPassword }: SignUpCodeScreenProps & {
    account: ExistingAccountAnswer
  },
): JSX.Element {
  const primary = useRef<HTMLDivElement>(null)
  const t = useAppText()
  useEffect(() => {
    primary.current?.querySelector<HTMLElement>("a, button")?.focus()
  }, [])
  // An account with a password, or one with no other way in that this page knows of, signs in.
  const signIn = account.password || account.providers.length === 0
  const providers = new Intl.ListFormat(t.language, { type: `disjunction` })
    .format(account.providers.map((id) => OAUTH_PROVIDER_NAMES[id]))
  return (
    <AuthCard
      title={t.t(`SignUpCodeScreen.existsTitle`)}
      description={
        <Rich
          parts={t.parts(
            signIn ? `SignUpCodeScreen.exists` : `SignUpCodeScreen.existsWith`,
            { email: account.email, providers },
          )}
          tags={{
            email: (text) => (
              <strong class="wrap-anywhere font-medium" translate={false}>
                <bdi>{text}</bdi>
              </strong>
            ),
          }}
        />
      }
      e2e="sign-up-exists"
    >
      <div ref={primary} class="flex flex-col gap-3">
        {signIn
          ? (
            <Button
              type="button"
              class="w-full"
              data-e2e="sign-up-exists-sign-in"
              onClick={onSignInInstead}
            >
              {t.t(`SignUpCodeScreen.signInInstead`)}
            </Button>
          )
          : account.providers.map((provider, index) => (
            // A plain link, with no `navigate`: the browser must leave the app for the provider.
            <Button
              key={provider}
              href={providerStartPath(provider, next)}
              variant={index === 0 ? "primary" : "secondary"}
              class="w-full"
              data-e2e={`sign-up-exists-${provider}`}
            >
              {t.t(`AuthScreen.continueWith`, { provider: OAUTH_PROVIDER_NAMES[provider] })}
            </Button>
          ))}
      </div>
      {account.password && (
        <p class="text-center text-sm">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class={TOUCH_TARGET}
            data-e2e="sign-up-exists-forgot"
            onClick={onForgotPassword}
          >
            {t.t(`AuthScreen.forgotPassword`)}
          </Button>
        </p>
      )}
    </AuthCard>
  )
}

/** "This sign-up expired": no sign-up waits for a code any more. */
function Expired(
  { minutes, next, navigate }: { minutes: number; next: string | null; navigate?: Navigate },
): JSX.Element {
  const start = useRef<HTMLDivElement>(null)
  const t = useAppText()
  useEffect(() => {
    start.current?.querySelector<HTMLElement>("a")?.focus()
  }, [])
  return (
    <AuthCard
      title={t.t(`SignUpCodeScreen.expiredTitle`)}
      description={t.t(`SignUpCodeScreen.expired`, { count: minutes })}
      e2e="sign-up-expired"
    >
      <div ref={start}>
        <Button href={withNext(SCREEN_PATHS.signUp, next)} navigate={navigate} class="w-full">
          {t.t(`SignUpCodeScreen.startAgain`)}
        </Button>
      </div>
    </AuthCard>
  )
}
