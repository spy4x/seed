import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { type AuthCredentials, AuthForm, type AuthMode } from "@spy4x/preact-system/auth-form"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { Link } from "@spy4x/preact-ui/link"
import { OAUTH_PROVIDER_NAMES, type OAuthProviderId, type SignInMethod } from "@domain/identity"
import { type Navigate, SCREEN_PATHS, withNext } from "./progressive.tsx"

/** The three screens `AuthScreen` draws: the two credential modes, and the second factor. */
export type AuthScreenKind = AuthMode | "one-time-code"

/** The page of each auth screen. */
export const AUTH_PATHS: Record<AuthScreenKind, string> = {
  "sign-in": SCREEN_PATHS.signIn,
  "sign-up": SCREEN_PATHS.signUp,
  "one-time-code": SCREEN_PATHS.oneTimeCode,
}

/**
 * Each screen names its fields as its API schema does: sign-in takes `login` (an address, or an
 * older account's username), sign-up takes `email`, and the second factor takes `otp`.
 */
const FIELD_NAMES: Record<AuthScreenKind, { login: string; code: string }> = {
  "sign-in": { login: "login", code: "otp" },
  "sign-up": { login: "email", code: "otp" },
  "one-time-code": { login: "login", code: "otp" },
}

/** What the login field is called on each credential screen. */
const LOGIN_LABELS: Record<AuthScreenKind, string> = {
  "sign-in": "E-mail or username",
  "sign-up": "E-mail",
  "one-time-code": "E-mail or username",
}

const COPY: Record<AuthScreenKind, { title: string; description: string; failure: string }> = {
  "sign-in": {
    title: "Welcome back",
    description: "Sign in with your e-mail address or username.",
    failure: "Sign in failed",
  },
  "sign-up": {
    title: "Create your account",
    description: "All it takes is an e-mail address and a password.",
    failure: "Sign up failed",
  },
  "one-time-code": {
    title: "Enter your code",
    description: "Open your authenticator app and enter the six digits it shows.",
    failure: "Invalid token",
  },
}

/** The message to show when an attempt on `screen` failed without a message of its own. */
export function authFailureMessage(screen: AuthScreenKind): string {
  return COPY[screen].failure
}

/**
 * Where the browser goes to sign in with `provider`: the API's start route, which sends it on to
 * the provider. `next` is the page to return to, which the API checks again.
 */
export function providerStartPath(provider: OAuthProviderId, next: string | null = null): string {
  return withNext(`/api/auth/${provider}/start`, next)
}

export interface AuthScreenProps {
  screen: AuthScreenKind
  /** Signed in with every factor done: the credential screens say so instead of asking again. */
  isSignedIn: boolean
  /** The session owes its one-time code: the one-time-code screen asks for it. */
  isMfaRequired: boolean
  busy: boolean
  error: string | null
  onSignIn?: (credentials: AuthCredentials) => void
  onSignUp?: (credentials: AuthCredentials) => void
  onOneTimeCode?: (code: string) => void
  navigate?: Navigate
  /**
   * The page to return to after sign-in, already checked by the app (`checkedNext`). The form
   * posts it as the hidden `next` field, and the links to the other auth pages keep it.
   */
  next?: string | null
  /**
   * The providers a person can sign in with (Google, GitHub), as the API lists them. Each gets a
   * "Continue with" link under the form on sign-in and sign-up. Left out or empty: none is shown.
   */
  providers?: readonly OAuthProviderId[]
  /**
   * How a person last signed in on this browser, shown on the sign-in screen so they pick the same
   * way again (#142). `null` or left out: nothing is shown.
   */
  lastSignIn?: LastSignInHint | null
  /** "Not you? Forget": the app drops what this browser remembered. */
  onForgetLastSignIn?: () => void
}

/** What the sign-in screen says about the last sign-in on this browser. */
export interface LastSignInHint {
  method: SignInMethod["kind"]
  /** The address, already masked (`j***@example.com`), or `null` when none was kept. */
  email: string | null
}

/** The name of a sign-in method in a sentence. */
const METHOD_NAMES: Record<SignInMethod["kind"], string> = {
  password: "your password",
  ...OAUTH_PROVIDER_NAMES,
}

/**
 * "Last time you signed in with Google (j***@example.com)", with the button that forgets it. Once
 * forgotten it says so and takes focus, since the button that had it is gone.
 */
function LastSignIn(
  { last, onForget }: { last: LastSignInHint | null; onForget?: () => void },
): JSX.Element | null {
  const [forgotten, setForgotten] = useState(false)
  const done = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (forgotten) done.current?.focus()
  }, [forgotten])

  if (forgotten) {
    return (
      <p ref={done} tabIndex={-1} role="status" class="text-sm" data-e2e="last-sign-in-forgotten">
        Forgotten. This browser no longer remembers how you signed in.
      </p>
    )
  }
  if (!last) return null
  return (
    <p class="flex flex-wrap items-center gap-2 text-sm" data-e2e="last-sign-in">
      <span>
        Last time you signed in with {METHOD_NAMES[last.method]}
        {last.email && <>{" "}({last.email})</>}.
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-e2e="last-sign-in-forget"
        onClick={() => {
          setForgotten(true)
          onForget?.()
        }}
      >
        Not you? Forget
      </Button>
    </p>
  )
}

/**
 * The one card of a signed-out page: the page's `h1` and a sentence under it, then the form. A
 * submit button inside fills the card's width, and `after` sits centred under the card, such as
 * the link to the other auth page.
 */
export function AuthCard(
  { title, description, after, children, e2e }: {
    title: string
    description?: ComponentChildren
    after?: ComponentChildren
    children: ComponentChildren
    e2e?: string
  },
): JSX.Element {
  return (
    <div class="flex flex-col gap-6">
      <Card class="w-full" data-e2e={e2e}>
        <div class="flex flex-col gap-6 p-6 sm:p-8 [&_button[type=submit]]:w-full">
          <header class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold">{title}</h1>
            {description && <p class="text-sm text-muted">{description}</p>}
          </header>
          {children}
        </div>
      </Card>
      {after && <p class="text-center text-sm text-muted">{after}</p>}
    </div>
  )
}

/** A signed-out page that has nothing to ask: a heading, a sentence and the way onward. */
function Done(
  { title, text, navigate }: { title: string; text: string; navigate?: Navigate },
): JSX.Element {
  return (
    <AuthCard title={title} description={text}>
      <Button href={SCREEN_PATHS.profile} navigate={navigate}>Open your profile</Button>
    </AuthCard>
  )
}

/**
 * Sign-in, sign-up and the second-factor step: one `AuthForm` from `@spy4x/preact-system` in an
 * {@link AuthCard}, with the link to the other mode under the card. Without callbacks each form
 * posts to its page's route; with them the app takes the submit over.
 */
export function AuthScreen(
  {
    screen,
    isSignedIn,
    isMfaRequired,
    busy,
    error,
    onSignIn,
    onSignUp,
    onOneTimeCode,
    navigate,
    next = null,
    providers = [],
    lastSignIn = null,
    onForgetLastSignIn,
  }: AuthScreenProps,
): JSX.Element {
  const copy = COPY[screen]

  if (screen === "one-time-code" && !isMfaRequired) {
    return (
      <Done
        title="No code needed"
        text="This sign-in does not ask for a code."
        navigate={navigate}
      />
    )
  }

  if (screen !== "one-time-code" && isSignedIn) {
    return <Done title="You are signed in" text="Nothing to do here." navigate={navigate} />
  }

  const linkTo = (path: string, text: string) => (
    <Link href={withNext(path, next)} navigate={navigate} class="pc-link font-medium">
      {text}
    </Link>
  )
  const after = screen === "sign-in"
    ? <>New here? {linkTo(SCREEN_PATHS.signUp, "Create an account")}</>
    : screen === "sign-up"
    ? <>Already have an account? {linkTo(SCREEN_PATHS.signIn, "Sign in")}</>
    : <>Lost your device? {linkTo(SCREEN_PATHS.signIn, "Back to sign in")}</>

  return (
    <AuthCard title={copy.title} description={copy.description} after={after}>
      {screen === "sign-in" && <LastSignIn last={lastSignIn} onForget={onForgetLastSignIn} />}
      <AuthForm
        mode={screen === "one-time-code" ? "sign-in" : screen}
        step={screen === "one-time-code" ? "one-time-code" : "credentials"}
        busy={busy}
        error={error}
        labels={{
          login: LOGIN_LABELS[screen],
          signUp: "Create account",
          submitCode: "Continue",
          codeHint: "Six digits from your authenticator app.",
        }}
        names={FIELD_NAMES[screen]}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        onOneTimeCode={onOneTimeCode}
        footer={screen === "sign-in"
          ? (
            <p class="text-center text-sm">
              <Link href={SCREEN_PATHS.forgotPassword} navigate={navigate} class="pc-link">
                Forgot your password?
              </Link>
            </p>
          )
          : undefined}
      />
      {screen !== "one-time-code" && providers.length > 0 && (
        <ul class="flex flex-col gap-3 border-t border-subtle pt-6" aria-label="Other ways in">
          {providers.map((provider) => (
            <li key={provider}>
              {/* A plain link, with no `navigate`: the browser must leave the app for the provider. */}
              <Button
                href={providerStartPath(provider, next)}
                variant="secondary"
                class="w-full"
                data-e2e={`provider-${provider}`}
              >
                Continue with {OAUTH_PROVIDER_NAMES[provider]}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </AuthCard>
  )
}
