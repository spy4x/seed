import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { ResendButton } from "@spy4x/preact-ui/resend-button"
import { Stack } from "@spy4x/preact-ui/layout"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { useFocusOnError } from "@spy4x/preact-ui/use-focus-on-error"
import { SIGN_IN_LINK_MINUTES } from "@domain/identity"
import { AuthCard } from "./auth-screen.tsx"
import { type Navigate, SCREEN_PATHS, ScreenForm, withNext } from "./progressive.tsx"

/** The messages of the sign-in link pages (#391) that the API does not word itself. */
export const SIGN_IN_LINK_MESSAGES = {
  /** Sending the link failed for a reason the API did not name. */
  sendFailed: "Could not send the link. Try again in a moment.",
  /** The link page could not reach the API. The link is not spent. */
  unreachable: "Could not reach the server. Check your connection and press Continue again.",
  /** The link page's request failed for a reason the API did not name. */
  openFailed: "Signing in failed. Press Continue to try again, or ask for a new link.",
} as const

/** How long after a link was sent a new one may be asked for, in seconds. */
export const SIGN_IN_LINK_COOLDOWN_SECONDS = 60

export interface LinkRequestScreenProps {
  /** The address typed so far. */
  email: string
  onEmailChange: (email: string) => void
  /** The address the link went to: the screen says "Check your inbox". `null`: the form. */
  sentTo: string | null
  /** Why the address was refused; shown under the field, which takes focus. */
  fieldError: string | null
  /** Why sending failed for another reason: too many links, offline, or the server. */
  error: string | null
  pending: boolean
  onSubmit: () => void
  /**
   * When a new link may be asked for, in milliseconds since the epoch; until then the line counts
   * down. Left out or past: "Send a new link" shows.
   */
  readyAt?: number
  /** A new link is being sent. Once it went out, the new `readyAt` says so to the person. */
  resending: boolean
  onResend: () => void
  /** "Use a different address": the app returns to the form, keeping the address. */
  onDifferentAddress: () => void
  /** "Back to sign in" was pressed: the app hands the typed address to the sign-in form. */
  onBackToSignIn?: () => void
  /** The page to return to after sign-in, already checked by the app. */
  next?: string | null
  navigate?: Navigate
}

/**
 * `/sign-in/link` (#391): asks for the address a sign-in link goes to, then says to check the
 * inbox, with a new link once a minute has passed. The answer is the same whether or not an
 * account uses the address, so the screen never says which; the link creates the account if none
 * does.
 */
export function LinkRequestScreen(props: LinkRequestScreenProps): JSX.Element {
  const { email, onEmailChange, sentTo, fieldError, error, pending, onSubmit, next = null } = props
  const field = useFocusOnError(fieldError)
  useEffect(() => {
    // Focus starts in the field, with an address handed back selected so typing replaces it.
    if (sentTo !== null) return
    queueMicrotask(() => {
      field.current?.focus()
      field.current?.select()
    })
  }, [sentTo])
  if (sentTo !== null) return <CheckInbox {...props} sentTo={sentTo} />
  return (
    <AuthCard
      title="Sign in with a link"
      description="We e-mail you a link that signs you in. If no account uses the address yet, the link creates one."
      e2e="sign-in-link"
      after={
        <>
          Rather use a password?{" "}
          <Link
            href={withNext(SCREEN_PATHS.signIn, next)}
            navigate={props.navigate}
            onClick={props.onBackToSignIn}
            class="pc-link font-medium"
            data-e2e="sign-in-link-back"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <ScreenForm pending={pending} onSubmit={onSubmit}>
        <Stack>
          <Field id="sign-in-link-email" label="E-mail" error={fieldError} required>
            <Input
              ref={field}
              data-e2e="sign-in-link-email"
              name="email"
              type="email"
              autocomplete="email"
              value={email}
              onInput={(e) => onEmailChange(e.currentTarget.value)}
              required
            />
          </Field>
          <Button type="submit" data-e2e="sign-in-link-submit" busy={pending} busyLabel="Sending…">
            Email me a link
          </Button>
          <ErrorState message={error} focusOnAppear dataE2E="sign-in-link-error" />
        </Stack>
      </ScreenForm>
    </AuthCard>
  )
}

/** "Check your inbox": no primary action, since the next step is in the mail app. */
function CheckInbox(
  { sentTo, error, readyAt, resending, onResend, onDifferentAddress }:
    & LinkRequestScreenProps
    & { sentTo: string },
): JSX.Element {
  return (
    <AuthCard
      title="Check your inbox"
      focusTitle
      description={
        <>
          We sent a sign-in link to{" "}
          <strong class="wrap-anywhere font-medium">{sentTo}</strong>. It works once, for{" "}
          {SIGN_IN_LINK_MINUTES} minutes.
        </>
      }
      e2e="sign-in-link-sent"
      after={
        <>
          Wrong address?{" "}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class={TOUCH_TARGET}
            data-e2e="sign-in-link-different-address"
            onClick={onDifferentAddress}
          >
            Use a different address
          </Button>
        </>
      }
    >
      <p class="text-sm">Open it on this device to sign in here.</p>
      <div class="flex flex-col gap-3">
        <ResendButton
          onResend={onResend}
          busy={resending}
          readyAt={readyAt}
          label="Send a new link"
          waitingText={(seconds) =>
            `Not there? Check your spam folder. You can send a new link in ${seconds} ${
              seconds === 1 ? "second" : "seconds"
            }.`}
          sentText="A new link is on its way. Earlier links still work until one is used."
        />
        <ErrorState message={error} focusOnAppear dataE2E="sign-in-link-error" />
      </div>
    </AuthCard>
  )
}

/** What the link page shows. */
export type LinkOpenState =
  /** A token is in the address: one press of Continue spends it. */
  | "ready"
  /** The API refused the token: used, expired, or never sent. */
  | "refused"
  /** A guest opened a link another browser asked for: it is spent, and the guest stays as before. */
  | "askedElsewhere"
  /** The address carries no token. */
  | "incomplete"

/** The words of each state of the link page that offers only a new link. */
const LINK_DEAD_ENDS = {
  refused: {
    e2e: "sign-in-link-refused",
    title: "This link no longer works",
    description:
      `Sign-in links work once, for ${SIGN_IN_LINK_MINUTES} minutes. Ask for a new one and use the newest mail.`,
  },
  askedElsewhere: {
    e2e: "sign-in-link-elsewhere",
    title: "This link was asked for in another browser",
    description:
      "It did not sign you in, and your guest account is as it was. Ask for a new link in this browser to sign in here.",
  },
  incomplete: {
    e2e: "sign-in-link-incomplete",
    title: "This link is incomplete",
    description: "Open the link from the mail again, or ask for a new one.",
  },
} as const

export interface LinkOpenScreenProps {
  state: LinkOpenState
  /** The address of the account this browser is signed in to, or `null` when signed out. */
  signedInAs: string | null
  /** A guest account is open in this browser. */
  guest?: boolean
  busy: boolean
  /** Why the last press failed; the link is not spent. */
  error: string | null
  onContinue: () => void
  /** The page to return to after sign-in, already checked by the app. */
  next?: string | null
  navigate?: Navigate
}

/**
 * `/sign-in/link/open` (#391), the page a sign-in link opens. Opening it spends nothing: a mail
 * scanner that opens links would otherwise use the link up before the person does. Continue spends
 * it, signing in, or signing up when no account uses the address.
 */
export function LinkOpenScreen(
  { state, signedInAs, guest = false, busy, error, onContinue, next = null, navigate }:
    LinkOpenScreenProps,
): JSX.Element {
  const primary = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // After the app's route announcer, which focuses the page's heading in the same flush.
    queueMicrotask(() => primary.current?.querySelector<HTMLElement>("a, button")?.focus())
  }, [state])

  if (state !== "ready") {
    const { e2e, title, description } = LINK_DEAD_ENDS[state]
    return (
      <AuthCard
        title={title}
        description={description}
        e2e={e2e}
        after={state === "refused"
          ? (
            <Link href={SCREEN_PATHS.signIn} navigate={navigate} class="pc-link font-medium">
              Back to sign in
            </Link>
          )
          : state === "askedElsewhere" && (
            <Link href={SCREEN_PATHS.home} navigate={navigate} class="pc-link font-medium">
              Back to the app
            </Link>
          )}
      >
        <div ref={primary}>
          <Button
            href={withNext(SCREEN_PATHS.signInLink, next)}
            navigate={navigate}
            class="w-full"
            data-e2e="sign-in-link-new"
          >
            Send a new link
          </Button>
        </div>
      </AuthCard>
    )
  }
  return (
    <AuthCard
      title="Finish signing in"
      description="Continue to sign in on this device. If the address is new, this creates your account."
      e2e="sign-in-link-open"
    >
      {signedInAs !== null && (
        <p class="text-sm" data-e2e="sign-in-link-signed-in-as">
          You are signed in as{" "}
          <strong class="wrap-anywhere font-medium">{signedInAs}</strong>. Continuing signs you in
          with the link's account instead.
        </p>
      )}
      {guest && (
        <p class="text-sm" data-e2e="sign-in-link-guest">
          You are using the app as a guest. If you asked for this link in this browser, continuing
          keeps this guest account under the link's address, or asks you first if that address
          already has an account.
        </p>
      )}
      <ScreenForm pending={busy} onSubmit={onContinue}>
        <div ref={primary} class="flex flex-col gap-3">
          <Button
            type="submit"
            busy={busy}
            busyLabel="Signing in…"
            data-e2e="sign-in-link-continue"
          >
            Continue
          </Button>
          {signedInAs !== null && (
            <Button
              href={SCREEN_PATHS.home}
              navigate={navigate}
              variant="secondary"
              class="w-full"
              data-e2e="sign-in-link-stay"
            >
              Stay signed in
            </Button>
          )}
        </div>
      </ScreenForm>
      <ErrorState message={error} focusOnAppear dataE2E="sign-in-link-open-error" />
    </AuthCard>
  )
}
