import type { JSX } from "preact"
import { useEffect } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { useFocusOnError } from "@spy4x/preact-ui/use-focus-on-error"
import { Link } from "@spy4x/preact-ui/link"
import { Rich } from "@spy4x/preact-ui/i18n"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { PASSWORD_RESET_CODE_MINUTES } from "@domain/identity"
import { AuthCard } from "./auth-screen.tsx"
import { useAppText } from "./i18n.ts"
import { type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The messages shown when a step failed without one of its own, by their keys in `app`. */
export const PASSWORD_RESET_FAILURES = {
  forgot: `PasswordResetScreen.forgotFailed`,
  reset: `PasswordResetScreen.resetFailed`,
} as const

/** A card with a heading, a sentence and the one way onward. */
function Message(
  { title, text, href, link, navigate, e2e, focusTitle = false }: {
    title: string
    text: string
    href: string
    link: string
    navigate?: Navigate
    e2e: string
    /** The title takes focus as the message appears, so a keyboard user lands on it. */
    focusTitle?: boolean
  },
): JSX.Element {
  return (
    <AuthCard title={title} e2e={e2e} focusTitle={focusTitle}>
      <p class="text-sm text-muted" role="status">{text}</p>
      <Button href={href} navigate={navigate} variant="secondary" class="w-full">
        {link}
      </Button>
    </AuthCard>
  )
}

export interface ForgotPasswordScreenProps {
  /** The address typed so far. */
  email: string
  onEmailChange: (email: string) => void
  error: string | null
  pending: boolean
  onSubmit?: () => void
  navigate?: Navigate
}

/**
 * Asks for the address a reset code goes to (#752). The app takes the submit over with `onSubmit`;
 * the form names no route of its own. The answer is the same whether or not an account uses the
 * address, so the code step that follows never says which.
 */
export function ForgotPasswordScreen(
  { email, onEmailChange, error, pending, onSubmit, navigate }: ForgotPasswordScreenProps,
): JSX.Element {
  const field = useFocusOnError(error)
  const t = useAppText()
  return (
    <AuthCard
      title={t.t(`AuthScreen.forgotPassword`)}
      description={t.t(`PasswordResetScreen.forgotDescription`, {
        count: PASSWORD_RESET_CODE_MINUTES,
      })}
      e2e="forgot-password"
      after={<RememberedIt navigate={navigate} />}
    >
      <ScreenForm pending={pending} onSubmit={onSubmit}>
        <Stack>
          <Field
            id="forgot-password-email"
            label={t.t(`AuthScreen.email`)}
            error={error}
            required
          >
            <Input
              ref={field}
              data-e2e="forgot-password-email"
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
            data-e2e="forgot-password-submit"
            busy={pending}
            busyLabel={t.t(`AuthScreen.sending`)}
          >
            {t.t(`PasswordResetScreen.send`)}
          </Button>
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}

/** "Remembered it? Back to sign in", under every step of the reset. */
export function RememberedIt({ navigate }: { navigate?: Navigate }): JSX.Element {
  const t = useAppText()
  return (
    <Rich
      parts={t.parts(`PasswordResetScreen.remembered`)}
      tags={{ link: (text) => signInLink(text, navigate) }}
    />
  )
}

export interface ResetPasswordScreenProps {
  /** The address the reset code went to. */
  email: string
  /** The new password typed so far. */
  newPassword: string
  onNewPasswordChange: (newPassword: string) => void
  /** The password was changed: the screen points to sign-in. */
  done: boolean
  error: string | null
  pending: boolean
  onSubmit?: () => void
  /** "Took too long? Ask for a new code": the app returns to the address, keeping it. */
  onStartOver: () => void
  navigate?: Navigate
}

/**
 * Sets a new password once the reset code was right (#752). The form shows the new password only;
 * the app sends it with the token the code gave, which never appears in the page's address.
 */
export function ResetPasswordScreen(
  {
    email,
    newPassword,
    onNewPasswordChange,
    done,
    error,
    pending,
    onSubmit,
    onStartOver,
    navigate,
  }: ResetPasswordScreenProps,
): JSX.Element {
  const field = useFocusOnError(error)
  const t = useAppText()
  useEffect(() => {
    // The step opens after the code: typing the new password comes next.
    if (!done) queueMicrotask(() => field.current?.focus())
  }, [done])
  if (done) {
    return (
      <Message
        title={t.t(`PasswordResetScreen.doneTitle`)}
        text={t.t(`PasswordResetScreen.done`)}
        href={SCREEN_PATHS.signIn}
        link={t.t(`PasswordResetScreen.signIn`)}
        navigate={navigate}
        e2e="reset-password-done"
        focusTitle
      />
    )
  }
  return (
    <AuthCard
      title={t.t(`PasswordResetScreen.chooseTitle`)}
      description={
        <Rich
          parts={t.parts(`PasswordResetScreen.choose`, { email })}
          tags={{
            email: (text) => (
              <strong class="wrap-anywhere" translate={false}>
                <bdi>{text}</bdi>
              </strong>
            ),
          }}
        />
      }
      e2e="reset-password"
      after={
        <Rich
          parts={t.parts(`PasswordResetScreen.expired`)}
          tags={{
            link: (text) => (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class={TOUCH_TARGET}
                data-e2e="reset-password-start-over"
                onClick={onStartOver}
              >
                {text}
              </Button>
            ),
          }}
        />
      }
    >
      <ScreenForm pending={pending} onSubmit={onSubmit}>
        <Stack>
          <Field
            id="reset-password-new"
            label={t.t(`PasswordResetScreen.newPassword`)}
            hint={t.t(`PasswordResetScreen.newPasswordHint`, { min: 8, max: 50 })}
            error={error}
            required
          >
            <Input
              ref={field}
              data-e2e="reset-password-new"
              name="newPassword"
              type="password"
              autocomplete="new-password"
              value={newPassword}
              onInput={(e) => onNewPasswordChange(e.currentTarget.value)}
              required
            />
          </Field>
          <Button
            type="submit"
            data-e2e="reset-password-submit"
            busy={pending}
            busyLabel={t.t(`PasswordResetScreen.saving`)}
          >
            {t.t(`PasswordResetScreen.save`)}
          </Button>
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}

function signInLink(text: string, navigate?: Navigate): JSX.Element {
  return (
    <Link href={SCREEN_PATHS.signIn} navigate={navigate} class="pc-link font-medium">
      {text}
    </Link>
  )
}
