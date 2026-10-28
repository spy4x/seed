import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { useFocusOnError } from "@spy4x/preact-ui/use-focus-on-error"
import { Link } from "@spy4x/preact-ui/link"
import { Rich } from "@spy4x/preact-ui/i18n"
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
  /**
   * The API's answer was accepted: the screen says to check the inbox instead of asking again, in
   * its own words, which never say whether an account uses the address.
   */
  sent: boolean
  error: string | null
  pending: boolean
  onSubmit?: () => void
  navigate?: Navigate
}

/**
 * Asks for the address a reset link goes to. The app takes the submit over with `onSubmit`; the
 * form names no route of its own. The answer is the same whether or not an account
 * uses the address, so the screen never says which.
 */
export function ForgotPasswordScreen(
  { email, onEmailChange, sent, error, pending, onSubmit, navigate }: ForgotPasswordScreenProps,
): JSX.Element {
  const field = useFocusOnError(error)
  const t = useAppText()
  if (sent) {
    return (
      <Message
        title={t.t(`SignUpCodeScreen.title`)}
        text={t.t(`PasswordResetScreen.sent`)}
        href={SCREEN_PATHS.signIn}
        link={t.t(`ConfirmSignUpScreen.backToSignIn`)}
        navigate={navigate}
        e2e="forgot-password-sent"
        focusTitle
      />
    )
  }
  return (
    <AuthCard
      title={t.t(`AuthScreen.forgotPassword`)}
      description={t.t(`PasswordResetScreen.forgotDescription`, { count: 30 })}
      after={
        <Rich
          parts={t.parts(`PasswordResetScreen.remembered`)}
          tags={{ link: (text) => signInLink(text, navigate) }}
        />
      }
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

export interface ResetPasswordScreenProps {
  /** The address from the link. */
  email: string
  /** The code from the link. */
  code: string
  /** The new password typed so far. */
  newPassword: string
  onNewPasswordChange: (newPassword: string) => void
  /** The password was changed: the screen points to sign-in. */
  done: boolean
  error: string | null
  pending: boolean
  onSubmit?: () => void
  navigate?: Navigate
}

/**
 * Sets a new password with the address and code a reset link carries. The form shows the new
 * password only; the app takes the submit over with `onSubmit` and sends all three. A link without its address or code offers a new link instead.
 */
export function ResetPasswordScreen(
  { email, code, newPassword, onNewPasswordChange, done, error, pending, onSubmit, navigate }:
    ResetPasswordScreenProps,
): JSX.Element {
  const field = useFocusOnError(error)
  const t = useAppText()
  if (done) {
    return (
      <Message
        title={t.t(`PasswordResetScreen.doneTitle`)}
        text={t.t(`PasswordResetScreen.done`)}
        href={SCREEN_PATHS.signIn}
        link={t.t(`PasswordResetScreen.signIn`)}
        navigate={navigate}
        e2e="reset-password-done"
      />
    )
  }
  if (!email || !code) {
    return (
      <Message
        title={t.t(`SignInLinkScreen.incompleteTitle`)}
        text={t.t(`SignInLinkScreen.incomplete`)}
        href={SCREEN_PATHS.forgotPassword}
        link={t.t(`PasswordResetScreen.askNew`)}
        navigate={navigate}
        e2e="reset-password-incomplete"
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
      after={
        <Rich
          parts={t.parts(`PasswordResetScreen.expired`)}
          tags={{
            link: (text) => (
              <Link
                href={SCREEN_PATHS.forgotPassword}
                navigate={navigate}
                class="pc-link font-medium"
              >
                {text}
              </Link>
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
