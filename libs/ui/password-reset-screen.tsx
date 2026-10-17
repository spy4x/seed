import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { useFocusOnError } from "@spy4x/preact-ui/use-focus-on-error"
import { Link } from "@spy4x/preact-ui/link"
import { AuthCard } from "./auth-screen.tsx"
import { type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The messages shown when a step failed without a message of its own. */
export const PASSWORD_RESET_FAILURES = {
  forgot: "Could not send the link",
  reset: "Could not change the password",
} as const

/** A card with a heading, a sentence and the one way onward. */
function Message(
  { title, text, href, link, navigate, e2e }: {
    title: string
    text: string
    href: string
    link: string
    navigate?: Navigate
    e2e: string
  },
): JSX.Element {
  return (
    <AuthCard title={title} e2e={e2e}>
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
  /** The API's answer was accepted: the screen says to check the inbox instead of asking again. */
  sent: boolean
  /** What the API said, when it accepted the request. */
  sentMessage?: string
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
  { email, onEmailChange, sent, sentMessage, error, pending, onSubmit, navigate }:
    ForgotPasswordScreenProps,
): JSX.Element {
  const field = useFocusOnError(error)
  if (sent) {
    return (
      <Message
        title="Check your inbox"
        text={sentMessage ??
          "If an account uses this address, a link to reset its password is on its way."}
        href={SCREEN_PATHS.signIn}
        link="Back to sign in"
        navigate={navigate}
        e2e="forgot-password-sent"
      />
    )
  }
  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter the e-mail address you signed up with. We mail you a link to choose a new password; it works once, for 30 minutes."
      after={<>Remembered it? {signInLink(navigate)}</>}
    >
      <ScreenForm pending={pending} onSubmit={onSubmit}>
        <Stack>
          <Field id="forgot-password-email" label="E-mail" error={error} required>
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
            busyLabel="Sending…"
          >
            Send the link
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
  if (done) {
    return (
      <Message
        title="Password changed"
        text="Every session of your account is signed out. Sign in with your new password."
        href={SCREEN_PATHS.signIn}
        link="Sign in"
        navigate={navigate}
        e2e="reset-password-done"
      />
    )
  }
  if (!email || !code) {
    return (
      <Message
        title="This link is incomplete"
        text="Open the link from the mail again, or ask for a new one."
        href={SCREEN_PATHS.forgotPassword}
        link="Ask for a new link"
        navigate={navigate}
        e2e="reset-password-incomplete"
      />
    )
  }
  return (
    <AuthCard
      title="Choose a new password"
      description={
        <>
          For{" "}
          <strong class="wrap-anywhere">{email}</strong>. Saving it signs your account out
          everywhere.
        </>
      }
      after={
        <>
          Link expired?{" "}
          <Link href={SCREEN_PATHS.forgotPassword} navigate={navigate} class="pc-link font-medium">
            Ask for a new one
          </Link>
        </>
      }
    >
      <ScreenForm pending={pending} onSubmit={onSubmit}>
        <Stack>
          <Field
            id="reset-password-new"
            label="New password"
            hint="8 to 50 characters."
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
            busyLabel="Saving…"
          >
            Save the new password
          </Button>
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}

function signInLink(navigate?: Navigate): JSX.Element {
  return (
    <Link href={SCREEN_PATHS.signIn} navigate={navigate} class="pc-link font-medium">
      Back to sign in
    </Link>
  )
}
