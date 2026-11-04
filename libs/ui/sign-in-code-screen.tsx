import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { useFocusOnError } from "@spy4x/preact-ui/use-focus-on-error"
import { MailedCodeStep } from "@spy4x/preact-system/mailed-code-step"
import { MAILED_CODE_PATTERN, SIGN_IN_CODE_MINUTES } from "@domain/identity"
import { Rich } from "@spy4x/preact-ui/i18n"
import { AuthCard } from "./auth-screen.tsx"
import { useAppText } from "./i18n.ts"
import { type Navigate, SCREEN_PATHS, ScreenForm, withNext } from "./progressive.tsx"

/**
 * The messages of the sign-in code page (#391, #752) that the API does not word itself, by their
 * keys in `app`.
 */
export const SIGN_IN_CODE_MESSAGES = {
  /** Sending the code failed for a reason the API did not name. */
  sendFailed: `SignInCodeScreen.sendFailed`,
  /** Checking the code failed for a reason the API did not name. */
  checkFailed: `SignUpCodeScreen.checkFailed`,
} as const

/** How long after a code was sent a new one may be asked for, in seconds. */
export const MAILED_CODE_COOLDOWN_SECONDS = 60

/** `text` as an address set in bold, kept in its own direction and never translated. */
function boldAddress(text: string): JSX.Element {
  return (
    <strong class="wrap-anywhere font-medium" translate={false}>
      <bdi>{text}</bdi>
    </strong>
  )
}

/** The sentence of a code step: the catalog's `key` with the address in bold. */
export function CodeSentence({ messageKey, email }: { messageKey: string; email: string }) {
  const t = useAppText()
  return <Rich parts={t.parts(messageKey, { email })} tags={{ email: boldAddress }} />
}

export interface CodeStepProps {
  /** The address the code went to. */
  email: string
  /** The catalog key of the sentence under the heading, given `{email}`. */
  sentence: string
  /** How many minutes a code works. */
  minutes: number
  /** The code is being checked. */
  checking: boolean
  /** Why the last code, or the last new code, was refused. Cleared when a new code went out. */
  error: string | null
  onCode: (code: string) => void
  /** When a new code may be sent, in milliseconds since the epoch. */
  readyAt?: number
  resending: boolean
  onResend: () => void
  /** "Use a different one": the app forgets the request and returns to the address. */
  onDifferentAddress: () => void
  /** A line of its own under the step, such as "Back to sign in". */
  after?: ComponentChildren
}

/**
 * The code step of sign-in and password reset: preact-system's `MailedCodeStep` as a page, with the
 * 8-character base64url code's pattern, so a pasted code submits by itself and a malformed one is
 * refused before any guess is counted.
 */
export function CodeStep(
  {
    email,
    sentence,
    minutes,
    checking,
    error,
    onCode,
    readyAt,
    resending,
    onResend,
    after,
    ...rest
  }: CodeStepProps,
): JSX.Element {
  return (
    <div class="flex w-full flex-col gap-6">
      <MailedCodeStep
        sentence={<CodeSentence messageKey={sentence} email={email} />}
        minutes={minutes}
        onSubmit={onCode}
        onResend={onResend}
        onChangeEmail={rest.onDifferentAddress}
        busy={checking}
        error={error}
        pattern={MAILED_CODE_PATTERN}
        readyAt={readyAt}
        resending={resending}
        headingLevel={1}
      />
      {after && <p class="text-center text-sm text-muted">{after}</p>}
    </div>
  )
}

/**
 * "This code no longer works": it expired, was used or took too many tries. Its one primary action
 * sends a new code to the same address; a different address is the way back.
 */
export function DeadCode(
  { minutes, resending, onResend, onDifferentAddress, after }: {
    minutes: number
    resending: boolean
    onResend: () => void
    onDifferentAddress: () => void
    after?: ComponentChildren
  },
): JSX.Element {
  const primary = useRef<HTMLDivElement>(null)
  const t = useAppText()
  useEffect(() => {
    // After the app's route announcer, which focuses the page's heading in the same flush.
    queueMicrotask(() => primary.current?.querySelector<HTMLElement>("button")?.focus())
  }, [])
  return (
    <AuthCard
      title={t.t(`CodeStep.deadTitle`)}
      description={t.t(`CodeStep.dead`, { count: minutes })}
      e2e="code-dead"
      after={
        <span class="flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            class={TOUCH_TARGET}
            data-e2e="code-dead-different-address"
            onClick={onDifferentAddress}
          >
            {t.t(`CodeStep.differentEmail`)}
          </Button>
          {after}
        </span>
      }
    >
      <div ref={primary}>
        <Button
          type="button"
          class="w-full"
          busy={resending}
          busyLabel={t.t(`AuthScreen.sending`)}
          data-e2e="code-dead-new"
          onClick={onResend}
        >
          {t.t(`SignUpCodeScreen.resend`)}
        </Button>
      </div>
    </AuthCard>
  )
}

export interface SignInCodeScreenProps {
  /** The address typed so far. */
  email: string
  onEmailChange: (email: string) => void
  /** The address the code went to: the screen asks for the code. `null`: the address form. */
  sentTo: string | null
  /** The code no longer works: the screen offers a new one. */
  dead: boolean
  /** Why the address was refused; shown under the field, which takes focus. */
  fieldError: string | null
  /** Why sending failed for another reason: too many codes, offline, or the server. */
  error: string | null
  pending: boolean
  onSubmit: () => void
  /** A guest account is open in this browser: the form says what signing in does to it. */
  guest?: boolean
  /** Why the code, or a new one, was refused. */
  codeError: string | null
  checking: boolean
  onCode: (code: string) => void
  /** When a new code may be asked for, in milliseconds since the epoch. */
  readyAt?: number
  /** A new code is being sent. */
  resending: boolean
  onResend: () => void
  /** "Use a different one": the app returns to the form, keeping the address. */
  onDifferentAddress: () => void
  /** "Back to sign in" was pressed: the app hands the typed address to the sign-in form. */
  onBackToSignIn?: () => void
  /** The page to return to after sign-in, already checked by the app. */
  next?: string | null
  navigate?: Navigate
}

/**
 * `/sign-in/code` (#391, #752): asks for the address a sign-in code goes to, then for the code,
 * which works only in this browser. The answer is the same whether or not an account uses the
 * address, so the screen never says which; the code creates the account if none does.
 */
export function SignInCodeScreen(props: SignInCodeScreenProps): JSX.Element {
  const { email, onEmailChange, sentTo, dead, fieldError, error, pending, onSubmit } = props
  const { guest = false, next = null, navigate, onBackToSignIn } = props
  const field = useFocusOnError(fieldError)
  const t = useAppText()
  useEffect(() => {
    // Focus starts in the field, with an address handed back selected so typing replaces it.
    if (sentTo !== null) return
    queueMicrotask(() => {
      field.current?.focus()
      field.current?.select()
    })
  }, [sentTo])

  const back = (e2e: string, text = t.t(`ConfirmSignUpScreen.backToSignIn`)) => (
    <Link
      href={withNext(SCREEN_PATHS.signIn, next)}
      navigate={navigate}
      onClick={onBackToSignIn}
      class="pc-link font-medium"
      data-e2e={e2e}
    >
      {text}
    </Link>
  )

  if (sentTo !== null && dead) {
    return (
      <DeadCode
        minutes={SIGN_IN_CODE_MINUTES}
        resending={props.resending}
        onResend={props.onResend}
        onDifferentAddress={props.onDifferentAddress}
        after={back("sign-in-code-dead-back")}
      />
    )
  }
  if (sentTo !== null) {
    return (
      <CodeStep
        email={sentTo}
        sentence={`SignInCodeScreen.sent`}
        minutes={SIGN_IN_CODE_MINUTES}
        checking={props.checking}
        error={props.codeError}
        onCode={props.onCode}
        readyAt={props.readyAt}
        resending={props.resending}
        onResend={props.onResend}
        onDifferentAddress={props.onDifferentAddress}
        after={back("sign-in-code-step-back")}
      />
    )
  }
  return (
    <AuthCard
      title={t.t(`SignInCodeScreen.title`)}
      description={t.t(`SignInCodeScreen.description`)}
      e2e="sign-in-code"
      after={
        <Rich
          parts={t.parts(`SignInCodeScreen.ratherPassword`)}
          tags={{ link: (text) => back("sign-in-code-back", text) }}
        />
      }
    >
      <ScreenForm pending={pending} onSubmit={onSubmit}>
        <Stack>
          <Field
            id="sign-in-code-email"
            label={t.t(`AuthScreen.email`)}
            error={fieldError}
            required
          >
            <Input
              ref={field}
              data-e2e="sign-in-code-email"
              name="email"
              type="email"
              autocomplete="email"
              value={email}
              onInput={(e) => onEmailChange(e.currentTarget.value)}
              required
            />
          </Field>
          {guest && (
            <p class="text-sm" data-e2e="sign-in-code-guest">{t.t(`SignInCodeScreen.guest`)}</p>
          )}
          <Button
            type="submit"
            data-e2e="sign-in-code-submit"
            busy={pending}
            busyLabel={t.t(`AuthScreen.sending`)}
          >
            {t.t(`SignInCodeScreen.submit`)}
          </Button>
          <ErrorState message={error} focusOnAppear dataE2E="sign-in-code-error" />
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}
