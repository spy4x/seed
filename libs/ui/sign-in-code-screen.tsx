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
 * The messages of the sign-in code page that the API does not word itself, by their
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
  /** The catalog key of the heading; the library's "Check your inbox" when left out. */
  heading?: string
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
  /** The `data-e2e` of the step's outer column, for a page's own tests. */
  e2e?: string
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
    heading,
    minutes,
    checking,
    error,
    onCode,
    readyAt,
    resending,
    onResend,
    after,
    e2e,
    ...rest
  }: CodeStepProps,
): JSX.Element {
  const step = useRef<HTMLDivElement>(null)
  const t = useAppText()
  useEffect(() => {
    // The step focuses its field as it mounts, but the app's route announcer then focuses the new
    // page's heading in the same flush: a step reached by navigation takes the focus back after it.
    queueMicrotask(() =>
      step.current?.querySelector<HTMLElement>(`[data-e2e=mailed-code-step-code]`)?.focus()
    )
  }, [])
  return (
    <div class="flex w-full flex-col gap-6" ref={step} data-e2e={e2e}>
      <MailedCodeStep
        sentence={<CodeSentence messageKey={sentence} email={email} />}
        minutes={minutes}
        onSubmit={onCode}
        onResend={onResend}
        onChangeEmail={rest.onDifferentAddress}
        busy={checking}
        error={error}
        pattern={MAILED_CODE_PATTERN}
        labels={{ invalid: t.t(`CodeStep.invalid`), ...(heading ? { title: t.t(heading) } : {}) }}
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
  /** Signed in, outside a proof the profile asked for: the page says so and asks for nothing. */
  signedIn?: boolean
  /**
   * The profile asked for proof: the code goes to the account's own address, shown as text
   * and never as a field, and the right code returns to `next` with fresh proof. `null` while the
   * address is being read.
   */
  fixedEmail?: string | null
}

/**
 * `/sign-in/code`: asks for the address a sign-in code goes to, then for the code,
 * which works only in this browser. The answer is the same whether or not an account uses the
 * address, so the screen never says which; the code creates the account if none does.
 */
export function SignInCodeScreen(props: SignInCodeScreenProps): JSX.Element {
  const { email, onEmailChange, sentTo, dead, fieldError, error, pending, onSubmit } = props
  const { guest = false, next = null, navigate, onBackToSignIn, signedIn = false } = props
  const fixedEmail = props.fixedEmail
  const proving = fixedEmail !== undefined
  const field = useFocusOnError(fieldError)
  const t = useAppText()
  const confirm = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Focus starts in the field, with an address handed back selected so typing replaces it. A
    // proof has no field: focus starts on its one button, once the address is known.
    if (sentTo !== null) return
    queueMicrotask(() => {
      if (proving) return confirm.current?.querySelector<HTMLElement>(`button`)?.focus()
      field.current?.focus()
      field.current?.select()
    })
  }, [sentTo, proving && fixedEmail !== null])

  // A proof goes back to the profile page that asked for it; anything else, to sign-in.
  const back = (e2e: string, text?: string) =>
    proving
      ? (
        <Link
          href={next ?? SCREEN_PATHS.profile}
          navigate={navigate}
          class="pc-link font-medium"
          data-e2e={e2e}
        >
          {text ?? t.t(`AuthScreen.openProfile`)}
        </Link>
      )
      : (
        <Link
          href={withNext(SCREEN_PATHS.signIn, next)}
          navigate={navigate}
          onClick={onBackToSignIn}
          class="pc-link font-medium"
          data-e2e={e2e}
        >
          {text ?? t.t(`ConfirmSignUpScreen.backToSignIn`)}
        </Link>
      )

  if (signedIn) {
    return (
      <AuthCard
        title={t.t(`AuthScreen.signedInTitle`)}
        description={t.t(`AuthScreen.signedInText`)}
        e2e="sign-in-code-signed-in"
      >
        <Button href={SCREEN_PATHS.profile} navigate={navigate} class="w-full">
          {t.t(`AuthScreen.openProfile`)}
        </Button>
      </AuthCard>
    )
  }

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
        sentence={`CodeStep.sent`}
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
  if (proving) {
    return (
      <AuthCard
        title={t.t(`SignInCodeScreen.confirmTitle`)}
        description={fixedEmail === null
          ? t.t(`SignUpCodeScreen.loading`)
          : <CodeSentence messageKey={`SignInCodeScreen.confirmDescription`} email={fixedEmail} />}
        e2e="sign-in-code-confirm"
        after={back("sign-in-code-back")}
      >
        <ScreenForm pending={pending} onSubmit={onSubmit}>
          <div ref={confirm} class="flex flex-col gap-4">
            <Button
              type="submit"
              data-e2e="sign-in-code-submit"
              busy={pending}
              busyLabel={t.t(`AuthScreen.sending`)}
              disabled={fixedEmail === null}
            >
              {t.t(`SignInCodeScreen.submit`)}
            </Button>
            <ErrorState message={error} focusOnAppear dataE2E="sign-in-code-error" />
          </div>
        </ScreenForm>
      </AuthCard>
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
