import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { type AuthCredentials, AuthForm, type AuthMode } from "@spy4x/preact-system/auth-form"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { Link } from "@spy4x/preact-ui/link"
import { Notice } from "@spy4x/preact-ui/notice"
import { OAUTH_PROVIDER_NAMES, type OAuthProviderId, type SignInMethod } from "@domain/identity"
import { isInvitationPath, type Navigate, SCREEN_PATHS, withNext } from "./progressive.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import { useAppText } from "./i18n.ts"
import { NoAccountYet, TryItNow, type TryLegalLinks, WordDivider } from "./guest-screens.tsx"

/** The public demo's one line on sign-in and sign-up (docs/demo.md), by its key in `app`. */
const DEMO_NOTE = `AuthScreen.demoNote`

/** The same line while guest accounts are on (#224): it names both ways in. */
const DEMO_GUEST_NOTE = `AuthScreen.demoGuestNote`

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

/** What the login field is called on each credential screen, by its key in `app`. */
const LOGIN_LABELS: Record<AuthScreenKind, string> = {
  "sign-in": `AuthScreen.loginOrUsername`,
  "sign-up": `AuthScreen.email`,
  "one-time-code": `AuthScreen.loginOrUsername`,
}

/** Each screen's title, sentence and failure, by their keys in `app`. */
const COPY: Record<AuthScreenKind, { title: string; description: string; failure: string }> = {
  "sign-in": {
    title: `AuthScreen.signInTitle`,
    description: `AuthScreen.signInDescription`,
    failure: `AuthScreen.signInFailed`,
  },
  "sign-up": {
    title: `AuthScreen.signUpTitle`,
    description: `AuthScreen.signUpDescription`,
    failure: `AuthScreen.signUpFailed`,
  },
  "one-time-code": {
    title: `AuthScreen.codeTitle`,
    description: `AuthScreen.codeDescription`,
    failure: `AuthScreen.codeFailed`,
  },
}

/**
 * What sign-up and sign-in say while `next` is an invitation: the person followed an invitation
 * link signed out, most often without an account yet.
 */
const INVITED_COPY: Record<AuthMode, { title: string; description: string }> = {
  "sign-in": { title: `AuthScreen.invitedTitle`, description: `AuthScreen.invitedSignIn` },
  "sign-up": { title: `AuthScreen.invitedTitle`, description: `AuthScreen.invitedSignUp` },
}

/**
 * The key in `app` of the message to show when an attempt on `screen` failed without a message of
 * its own; the view translates it.
 */
export function authFailureKey(screen: AuthScreenKind): string {
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
   * The page to return to after sign-in, already checked by the app (`checkedNext`). The links to
   * the other auth pages and to each provider keep it; the form renders no field for it.
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
  /**
   * `true` while the public demo is on (docs/demo.md): one line above the card on sign-in and
   * sign-up says so.
   */
  demo?: boolean
  /**
   * The website's terms and privacy notice, which the line under "Try it now" links to (#224).
   * Left out, as without a website, the line names them without links.
   */
  legal?: TryLegalLinks | null
  /**
   * Signs in with a passkey (#222): "Sign in with a passkey" is the first of the other ways in on
   * the sign-in screen. Left out, as in a browser without passkeys, there is no such button.
   */
  onPasskey?: () => void
  /** The passkey sign-in waits for the device: its button says so. */
  passkeyBusy?: boolean
  /**
   * Guest accounts are on (#224): sign-up opens with "Try it now", the page's one accent button,
   * and sign-in ends with "No account yet?" under the card. Left out: neither is shown.
   */
  guest?: boolean
  /**
   * The browser offers passkeys in the login field's autofill: the field gets the `webauthn`
   * token, and the app runs the request that waits for a pick.
   */
  passkeyAutofill?: boolean
  /**
   * Sends a sign-in link (#391): "Email me a sign-in link" on sign-in, "Email me a sign-up link" on
   * sign-up, in the other ways in. Called with what the login field holds, as typed: the app sends
   * the link when it is an address and opens the link page otherwise. Left out: no such button.
   */
  onEmailLink?: (login: string) => void
  /** The link is being sent: its button says so. */
  linkBusy?: boolean
  /** The login field's starting value, such as an address another page handed back. */
  defaultLogin?: string
}

/** What the sign-in screen says about the last sign-in on this browser. */
export interface LastSignInHint {
  /** A linked method, or `link` for a sign-in link (#391), which is never a linked method. */
  method: SignInMethod["kind"] | "link"
  /** The address, already masked (`j***@example.com`), or `null` when none was kept. */
  email: string | null
}

/** "Last time you signed in with …" for each way in that is not a provider, by its key in `app`. */
const LAST_KEYS: Record<Exclude<LastSignInHint["method"], OAuthProviderId>, string> = {
  password: `AuthScreen.lastPassword`,
  passkey: `AuthScreen.lastPasskey`,
  link: `AuthScreen.lastLink`,
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
  const t = useAppText()
  useEffect(() => {
    if (forgotten) done.current?.focus()
  }, [forgotten])

  if (forgotten) {
    return (
      <p ref={done} tabIndex={-1} role="status" class="text-sm" data-e2e="last-sign-in-forgotten">
        {t.t(`AuthScreen.forgotten`)}
      </p>
    )
  }
  if (!last) return null
  const values = {
    email: last.email ?? ``,
    provider: OAUTH_PROVIDER_NAMES[last.method as OAuthProviderId],
  }
  const key = last.method in LAST_KEYS
    ? LAST_KEYS[last.method as keyof typeof LAST_KEYS]
    : `AuthScreen.lastProvider`
  return (
    <p class="flex flex-wrap items-center gap-2 text-sm" data-e2e="last-sign-in">
      <span>
        <Rich
          parts={t.parts(key, values)}
          tags={{ email: (text) => last.email && <bdi translate={false}>{text}</bdi> }}
        />
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
        {t.t(`AuthScreen.forget`)}
      </Button>
    </p>
  )
}

/**
 * The one card of a signed-out page: the page's `h1` and a sentence under it, then the form. A
 * submit button inside fills the card's width, and `after` sits centred under the card, such as
 * the link to the other auth page. The card fills its column (`PublicFrame`'s 28 rem); `class`
 * is only for a page that places the card in a wider column of its own.
 */
export function AuthCard(
  { title, description, below, after, children, e2e, class: className, focusTitle = false }: {
    title: string
    description?: ComponentChildren
    /** A block of its own under the card, before `after`, such as the guest entry on sign-in. */
    below?: ComponentChildren
    after?: ComponentChildren
    children: ComponentChildren
    e2e?: string
    class?: string
    /**
     * The heading takes focus when the card appears, so a screen reader reads a state that has no
     * field to focus, such as "Check your inbox".
     */
    focusTitle?: boolean
  },
): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    // After the app's route announcer, which focuses the heading of a new page in the same flush.
    if (focusTitle) queueMicrotask(() => heading.current?.focus())
  }, [focusTitle])
  return (
    <div class={`flex w-full flex-col gap-6 ${className ?? ""}`}>
      <Card class="w-full" data-e2e={e2e}>
        <div class="flex flex-col gap-6 p-6 sm:p-8 [&_button[type=submit]]:w-full">
          <header class="flex flex-col gap-1">
            <h1
              ref={heading}
              tabIndex={focusTitle ? -1 : undefined}
              class="text-xl font-semibold"
            >
              {title}
            </h1>
            {description && <p class="text-sm text-muted">{description}</p>}
          </header>
          {children}
        </div>
      </Card>
      {below}
      {after && <p class="text-center text-sm text-muted">{after}</p>}
    </div>
  )
}

/** A signed-out page that has nothing to ask: a heading, a sentence and the way onward. */
function Done(
  { title, text, navigate }: { title: string; text: string; navigate?: Navigate },
): JSX.Element {
  const t = useAppText()
  return (
    <AuthCard title={title} description={text}>
      <Button href={SCREEN_PATHS.profile} navigate={navigate} class="w-full">
        {t.t(`AuthScreen.openProfile`)}
      </Button>
    </AuthCard>
  )
}

/**
 * Sign-in, sign-up and the second-factor step: one `AuthForm` from `@spy4x/preact-system` in an
 * {@link AuthCard}, with the link to the other mode under the card. The app takes each submit over
 * with its callback; the form names no route of its own.
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
    demo = false,
    legal = null,
    onPasskey,
    passkeyBusy = false,
    passkeyAutofill = false,
    guest = false,
    onEmailLink,
    linkBusy = false,
    defaultLogin,
  }: AuthScreenProps,
): JSX.Element {
  const t = useAppText()
  const invited = screen !== "one-time-code" && isInvitationPath(next)
  const copy = invited ? { ...COPY[screen], ...INVITED_COPY[screen as AuthMode] } : COPY[screen]
  // What the login field holds, as typed: the link button sends it.
  const login = useRef(defaultLogin ?? "")
  // An invitation is answered with an account, so no guest entry competes with the form.
  const tryFirst = guest && screen === "sign-up" && !invited

  if (screen === "one-time-code" && !isMfaRequired) {
    return (
      <Done
        title={t.t(`AuthScreen.noCodeTitle`)}
        text={t.t(`AuthScreen.noCodeText`)}
        navigate={navigate}
      />
    )
  }

  if (screen !== "one-time-code" && isSignedIn) {
    return (
      <Done
        title={t.t(`AuthScreen.signedInTitle`)}
        text={t.t(`AuthScreen.signedInText`)}
        navigate={navigate}
      />
    )
  }

  const linkTo = (path: string, key: string) => (
    <Rich
      parts={t.parts(key)}
      tags={{
        link: (text) => (
          <Link href={withNext(path, next)} navigate={navigate} class="pc-link font-medium">
            {text}
          </Link>
        ),
      }}
    />
  )
  const after = screen === "sign-in"
    ? linkTo(SCREEN_PATHS.signUp, `AuthScreen.newHere`)
    : screen === "sign-up"
    ? linkTo(SCREEN_PATHS.signIn, `AuthScreen.haveAccount`)
    : linkTo(SCREEN_PATHS.signIn, `AuthScreen.lostDevice`)

  // A passkey signs in to an account that exists: sign-up offers none.
  const passkeyButton = screen === "sign-in" && onPasskey !== undefined
  const linkButton = screen !== "one-time-code" && onEmailLink !== undefined && (
    <li>
      <Button
        type="button"
        variant="secondary"
        class="w-full"
        busy={linkBusy}
        busyLabel={t.t(`AuthScreen.sending`)}
        disabled={busy}
        onClick={() => onEmailLink(login.current.trim())}
        data-e2e={screen === "sign-in" ? "link-sign-in" : "link-sign-up"}
      >
        {t.t(screen === "sign-in" ? `AuthScreen.emailSignInLink` : `AuthScreen.emailSignUpLink`)}
      </Button>
    </li>
  )
  const card = (
    <AuthCard
      title={t.t(copy.title)}
      description={t.t(tryFirst ? `AuthScreen.tryFirst` : copy.description)}
      below={guest && screen === "sign-in" && !invited && (
        <NoAccountYet demo={demo} navigate={navigate} next={next} />
      )}
      after={after}
    >
      {screen === "sign-in" && <LastSignIn last={lastSignIn} onForget={onForgetLastSignIn} />}
      {tryFirst && (
        <>
          <TryItNow navigate={navigate} next={next} legal={legal} />
          <WordDivider>{t.t(`AuthScreen.orCreate`)}</WordDivider>
        </>
      )}
      <AuthForm
        submitVariant={tryFirst ? "secondary" : "primary"}
        mode={screen === "one-time-code" ? "sign-in" : screen}
        step={screen === "one-time-code" ? "one-time-code" : "credentials"}
        busy={busy}
        error={error}
        labels={{
          login: t.t(LOGIN_LABELS[screen]),
          signUp: t.t(`AuthScreen.createAccount`),
          submitCode: t.t(`AuthScreen.continue`),
          codeHint: t.t(`AuthScreen.codeHint`),
        }}
        names={FIELD_NAMES[screen]}
        passkeyAutofill={passkeyAutofill}
        defaultLogin={defaultLogin}
        onLoginInput={(value) => (login.current = value)}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        onOneTimeCode={onOneTimeCode}
        footer={screen === "sign-in"
          ? (
            <p class="text-center text-sm">
              <Link href={SCREEN_PATHS.forgotPassword} navigate={navigate} class="pc-link">
                {t.t(`AuthScreen.forgotPassword`)}
              </Link>
            </p>
          )
          : undefined}
      />
      {screen !== "one-time-code" && (providers.length > 0 || passkeyButton || linkButton) && (
        <ul
          class="flex flex-col gap-3 border-t border-subtle pt-6"
          aria-label={t.t(`AuthScreen.otherWays`)}
        >
          {screen === "sign-up" && linkButton}
          {passkeyButton && (
            <li>
              <Button
                type="button"
                variant="secondary"
                class="w-full"
                busy={passkeyBusy}
                busyLabel={t.t(`AuthScreen.waitingDevice`)}
                disabled={busy}
                onClick={onPasskey}
                data-e2e="passkey-sign-in"
              >
                {t.t(`AuthScreen.passkey`)}
              </Button>
            </li>
          )}
          {screen === "sign-in" && linkButton}
          {providers.map((provider) => (
            <li key={provider}>
              {/* A plain link, with no `navigate`: the browser must leave the app for the provider. */}
              <Button
                href={providerStartPath(provider, next)}
                variant="secondary"
                class="w-full"
                data-e2e={`provider-${provider}`}
              >
                {t.t(`AuthScreen.continueWith`, { provider: OAUTH_PROVIDER_NAMES[provider] })}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </AuthCard>
  )
  return (
    <div class="flex w-full flex-col gap-6">
      {demo && screen !== "one-time-code" && (
        // Standing information, read before the form: no live region announces it.
        <Notice live={false} data-e2e="demo-notice">
          {t.t(guest ? DEMO_GUEST_NOTE : DEMO_NOTE)}
        </Notice>
      )}
      {card}
    </div>
  )
}
