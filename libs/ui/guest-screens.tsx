// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Field } from "@spy4x/preact-ui/field"
import { useFormat } from "@spy4x/preact-ui/format"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { type GuestSwitchState, OAUTH_PROVIDER_NAMES, type OAuthProviderId } from "@domain/identity"
import { AuthCard } from "./auth-screen.tsx"
import { type Navigate, SCREEN_PATHS, ScreenForm, withNext } from "./progressive.tsx"
import { FORM_WIDTH, useWaited } from "./tag-editor-screen.tsx"

/** The pages of guest accounts (#224). */
export const GUEST_PATHS = {
  /** One click into the app: the page starts a guest account with a `POST` and moves on. */
  try: "/try",
  /** Adds the first sign-in method to a guest account. */
  keep: "/keep",
  /** The sign-in method belongs to another account: what happens to the guest's work. */
  keepTaken: "/keep/taken",
} as const

/** The one name of the action, on every button, link, banner and reminder. */
export const KEEP_LABEL = "Keep your account"

/** The line under "Try it now", wherever it is offered. */
export const TRY_LINE = "No account needed. Add a sign-in method later to keep your work."

/** The line under the guest entry on the sign-in page, so nobody mistakes it for their account. */
export const TRY_FROM_SIGN_IN_LINE =
  "This opens a new, empty account in this browser. It does not sign you in to an existing one."

/** The same line on the public demo, where a new account starts with sample data. */
export const TRY_FROM_SIGN_IN_DEMO_LINE =
  "This opens a new account with sample data. It does not sign you in to an existing one."

/** The line under "Try it now" on sign-up: by going on, the person agrees to the legal pages. */
export const TRY_TERMS_LINE = "By continuing you agree to the terms and privacy notice."

/** What `/try` shows while and after it starts a guest account. */
export type TryState =
  | { kind: "working" }
  /** Too many new accounts from this network: `message` says how long to wait. */
  | { kind: "rate-limited"; message: string }
  /** Offline, or the server failed. */
  | { kind: "failed" }
  /** A full account is open in this browser: no guest is made. */
  | { kind: "signed-in" }
  /** Guest accounts are turned off here. */
  | { kind: "off" }

export interface TryScreenProps {
  state: TryState
  onRetry: () => void
  navigate?: Navigate
}

/**
 * `/try`: the page the website's "Try the live demo" and the sign-up page's "Try it now" open. The
 * app starts the guest account as the page loads and moves on to the app; this screen draws the
 * wait (after 300 ms, so a quick start shows nothing) and every way it can end short of that.
 */
export function TryScreen({ state, onRetry, navigate }: TryScreenProps): JSX.Element | null {
  const waited = useWaited(state.kind === "working")
  const signUp = (variant: "primary" | "ghost") => (
    <Button
      href={SCREEN_PATHS.signUp}
      navigate={navigate}
      variant={variant}
      class="w-full"
      data-e2e="try-sign-up"
    >
      {variant === "primary" ? "Create an account" : "Create an account instead"}
    </Button>
  )
  switch (state.kind) {
    case "working":
      if (!waited) return null
      return (
        <AuthCard title="Try the app" e2e="try-working">
          <p role="status" class="flex items-center gap-3 text-sm">
            <LoadingSpinner size="sm" />
            Opening the app…
          </p>
        </AuthCard>
      )
    case "rate-limited":
      return (
        <AuthCard
          title="Too many new accounts from your network"
          description={state.message}
          e2e="try-rate-limited"
        >
          {signUp("primary")}
        </AuthCard>
      )
    case "failed":
      return (
        <AuthCard
          title="The app could not be opened"
          description="Check your connection and try again."
          e2e="try-failed"
        >
          <Stack gap="sm">
            <Button type="button" class="w-full" onClick={onRetry} data-e2e="try-again">
              Try again
            </Button>
            {signUp("ghost")}
          </Stack>
        </AuthCard>
      )
    case "signed-in":
      return (
        <AuthCard
          title="You are already signed in"
          description="Your account is open in this browser. Sign out first to try the app as a guest."
          e2e="try-signed-in"
        >
          <Button href={SCREEN_PATHS.profile} navigate={navigate} class="w-full">
            Open the app
          </Button>
        </AuthCard>
      )
    case "off":
      return (
        <AuthCard
          title="Create an account to start"
          description="Trying the app without an account is turned off here."
          e2e="try-off"
        >
          {signUp("primary")}
        </AuthCard>
      )
  }
}

/** Focuses the page's first heading, making it focusable first; nothing when there is none. */
function focusPageHeading(page: Document): void {
  const heading = page.querySelector<HTMLElement>("main h1") ?? page.querySelector("h1")
  if (!heading) return
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1
  heading.focus()
}

/** The website's legal pages, as full addresses: the website is on a host of its own. */
export interface TryLegalLinks {
  terms: string
  privacy: string
}

/** The line under "Try it now", with the legal pages as links when the website is known. */
function TryTermsLine({ legal }: { legal: TryLegalLinks | null }): JSX.Element {
  if (!legal) return <p class="text-xs text-muted">{TRY_TERMS_LINE}</p>
  return (
    <p class="text-xs text-muted" data-e2e="try-terms">
      By continuing you agree to the{" "}
      <a href={legal.terms} class="underline hover:text-foreground">terms</a> and{" "}
      <a href={legal.privacy} class="underline hover:text-foreground">privacy notice</a>.
    </p>
  )
}

/** The "Try it now" block at the top of the sign-up card: the page's one accent button. */
export function TryItNow(
  { navigate, next = null, legal = null }: {
    navigate?: Navigate
    next?: string | null
    legal?: TryLegalLinks | null
  },
): JSX.Element {
  return (
    <div class="flex flex-col gap-2" data-e2e="try-it-now">
      <Button href={withNext(GUEST_PATHS.try, next)} navigate={navigate} class="w-full">
        Try it now
      </Button>
      <p class="text-sm text-muted">{TRY_LINE}</p>
      <TryTermsLine legal={legal} />
    </div>
  )
}

/** A divider with words in it, such as "or create an account". */
export function WordDivider({ children }: { children: string }): JSX.Element {
  return (
    <p class="flex items-center gap-3 text-sm text-muted">
      <span aria-hidden="true" class="flex-1 border-t border-subtle" />
      {children}
      <span aria-hidden="true" class="flex-1 border-t border-subtle" />
    </p>
  )
}

/**
 * The block under the sign-in card for a person with no account: an outline button to the guest
 * entry and its line. Outside the card, so a returning person's Tab path finishes every way into
 * their own account first.
 */
export function NoAccountYet(
  { demo, navigate, next = null }: { demo: boolean; navigate?: Navigate; next?: string | null },
): JSX.Element {
  return (
    <section
      class="flex flex-col items-center gap-2 border-t border-subtle pt-6 text-center"
      aria-labelledby="no-account-yet"
      data-e2e="no-account-yet"
    >
      <p id="no-account-yet" class="text-sm font-medium">No account yet?</p>
      <Button
        href={withNext(GUEST_PATHS.try, next)}
        navigate={navigate}
        variant="outline"
        class="w-full"
        data-e2e="try-from-sign-in"
      >
        Try it without an account
      </Button>
      <p class="text-sm text-muted">{demo ? TRY_FROM_SIGN_IN_DEMO_LINE : TRY_FROM_SIGN_IN_LINE}</p>
    </section>
  )
}

/** The sentence a demo guest reads in the banner: when the wipe comes, in their own time. */
export function demoWipeLine(wipeTime: string): string {
  // A no-break space keeps "2:00 PM" on one line.
  const time = wipeTime.replace(/\s/g, "\u00a0")
  return `This is a guest account on a public demo. Everything here is wiped every night at ${time}, with or without a sign-in method. Add one to see how keeping an account works.`
}

/** The banner's sentence for a guest account outside the demo. */
export const GUEST_BANNER_TEXT =
  "This account lives only in this browser. If this browser's data is cleared, the account is gone. Add a sign-in method to keep it."

/**
 * The guest banner (#224), in the frame's banner slot: what a guest account is, and the way to
 * keep it. `wipeAt` is the demo's next nightly wipe, on the demo only; the banner shows it in the
 * person's own time and clock.
 */
export function GuestBanner(
  { wipeAt, onDismiss, navigate }: {
    wipeAt: Date | null
    onDismiss: () => void
    navigate?: Navigate
  },
): JSX.Element {
  const format = useFormat()
  const box = useRef<HTMLDivElement>(null)
  const dismiss = () => {
    const page = box.current?.ownerDocument
    onDismiss()
    // The banner leaves with the focus in it: the page's heading takes it, not the page body.
    if (page) setTimeout(() => focusPageHeading(page), 0)
  }
  return (
    <div ref={box} class="contents">
      <Notice
        live={false}
        data-e2e="guest-banner"
        onDismiss={dismiss}
        dismissLabel="Hide this message"
        action={
          <Button
            href={GUEST_PATHS.keep}
            navigate={navigate}
            variant="outline"
            size="sm"
            data-e2e="guest-banner-keep"
          >
            {KEEP_LABEL}
          </Button>
        }
      >
        {wipeAt ? demoWipeLine(format.time(wipeAt)) : GUEST_BANNER_TEXT}
      </Notice>
    </div>
  )
}

/** A way to keep the account, as `KeepScreen` names it while it runs. */
export type KeepMethod = OAuthProviderId | "passkey" | "email"

/** What each method is called in "You can now sign in with …". */
const KEPT_WITH: Record<KeepMethod, string> = {
  ...OAUTH_PROVIDER_NAMES,
  passkey: "a passkey",
  email: "your e-mail address",
}

export interface KeepScreenProps {
  /** The account is still a guest; `false` once it is kept, and the page says so. */
  isGuest: boolean
  /** The providers this server offers, in the order sign-up shows them. */
  providers: readonly OAuthProviderId[]
  /** The browser can make a passkey: "Add a passkey" is offered. */
  passkeys: boolean
  /** The method that is running, or `null`. Every way waits while one runs. */
  busy: KeepMethod | null
  /** Why the last attempt failed; shown under the ways, with focus. */
  error: string | null
  /** A field the e-mail path refused. */
  fieldErrors?: { email?: string | null; password?: string | null }
  /** The method that just kept the account; the page then says so and offers Done. */
  kept: KeepMethod | null
  onProvider: (provider: OAuthProviderId) => void
  onPasskey: () => void
  onEmail: (email: string, password: string) => void
  /** "Done": back to the page the person came from. */
  onDone: () => void
  navigate?: Navigate
}

/**
 * `/keep` (#224): adds the first sign-in method to a guest account, so it opens on any device. The
 * ways come in the order sign-up shows them: each provider, a passkey, then an e-mail address
 * with a password, whose code step follows on the sign-up code page. No password is asked first:
 * a guest has none, and this session is the account's only way in.
 */
export function KeepScreen(props: KeepScreenProps): JSX.Element {
  const { isGuest, providers, passkeys, busy, error, kept, navigate } = props
  const status = useRef<HTMLDivElement>(null)
  const failure = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (kept) status.current?.focus()
  }, [kept])
  useEffect(() => {
    if (error) failure.current?.focus()
  }, [error])

  if (kept) {
    return (
      <Stack gap="xl">
        <PageHeader title="Sign-in method added" titleDataE2E="keep-title" />
        <div ref={status} tabIndex={-1} role="status" class={FORM_WIDTH} data-e2e="keep-done">
          <Stack gap="lg">
            <p>
              You can now sign in with {KEPT_WITH[kept]}{" "}
              on any device. Nothing in your account changed.
            </p>
            <Cluster>
              <Button type="button" onClick={props.onDone} data-e2e="keep-done-button">
                Done
              </Button>
            </Cluster>
          </Stack>
        </div>
      </Stack>
    )
  }
  if (!isGuest) {
    return (
      <Stack gap="xl">
        <PageHeader title="Your account is kept" titleDataE2E="keep-title" />
        <Stack gap="lg" class={FORM_WIDTH}>
          <p>It has a sign-in method, so it opens on any device.</p>
          <Cluster>
            <Button href={SCREEN_PATHS.profile} navigate={navigate} variant="outline">
              Open your profile
            </Button>
          </Cluster>
        </Stack>
      </Stack>
    )
  }
  const waiting = busy !== null
  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <PageHeader title={KEEP_LABEL} titleDataE2E="keep-title" />
        <p class="text-sm text-muted">
          Add a way to sign in, and you can open this account on any device. Your notes and groups
          stay as they are.
        </p>
      </Stack>
      <Stack gap="lg" class={FORM_WIDTH}>
        <ul class="flex flex-col gap-3" aria-label="Ways to sign in">
          {providers.map((provider) => (
            <li key={provider}>
              <Button
                type="button"
                variant="secondary"
                class="w-full"
                busy={busy === provider}
                busyLabel={`Opening ${OAUTH_PROVIDER_NAMES[provider]}…`}
                disabled={waiting}
                onClick={() => props.onProvider(provider)}
                data-e2e={`keep-${provider}`}
              >
                Continue with {OAUTH_PROVIDER_NAMES[provider]}
              </Button>
            </li>
          ))}
          {passkeys && (
            <li>
              <Button
                type="button"
                variant="secondary"
                class="w-full"
                busy={busy === "passkey"}
                busyLabel="Waiting for your device…"
                disabled={waiting}
                onClick={props.onPasskey}
                data-e2e="keep-passkey"
              >
                Add a passkey
              </Button>
            </li>
          )}
        </ul>
        {(providers.length > 0 || passkeys) && (
          <WordDivider>or use an e-mail address and password</WordDivider>
        )}
        <EmailForm {...props} />
        {error && (
          <div ref={failure} tabIndex={-1}>
            <Notice tone="danger" urgent data-e2e="keep-error">{error}</Notice>
          </div>
        )}
      </Stack>
    </Stack>
  )
}

/** The e-mail and password way: the page's one primary button. */
function EmailForm(
  { busy, fieldErrors = {}, onEmail }: Pick<KeepScreenProps, "busy" | "fieldErrors" | "onEmail">,
): JSX.Element {
  return (
    <ScreenForm
      pending={busy !== null}
      onSubmit={(data) =>
        onEmail(String(data.get("email") ?? ""), String(data.get("password") ?? ""))}
    >
      <Stack gap="md">
        <Field id="keep-email" label="E-mail address" error={fieldErrors.email} required>
          <Input
            name="email"
            type="email"
            autocomplete="email"
            required
            data-e2e="keep-email"
          />
        </Field>
        <Field
          id="keep-password"
          label="Password"
          hint="At least 8 characters."
          error={fieldErrors.password}
          required
        >
          <Input
            name="password"
            type="password"
            autocomplete="new-password"
            minLength={8}
            required
            data-e2e="keep-password"
          />
        </Field>
        <Cluster>
          <Button
            type="submit"
            busy={busy === "email"}
            busyLabel="Saving…"
            data-e2e="keep-email-submit"
          >
            {KEEP_LABEL}
          </Button>
        </Cluster>
      </Stack>
    </ScreenForm>
  )
}

/** A choice on the "already belongs to another account" page. */
export type GuestTakenChoice = "move" | "delete" | "keep"

export interface GuestTakenScreenProps {
  /** The choice that waits; `null` when none does, `undefined` while it is read. */
  state: GuestSwitchState | null | undefined
  /** A switch or a cancel is running. */
  busy: boolean
  /** Why the last answer was refused. */
  error: string | null
  /** Switch: with that account's password and code when the page asked for them. */
  onSwitch: (choice: "move" | "delete", password?: string, otp?: string) => void
  /** "Keep the guest account": nothing changes. */
  onKeep: () => void
  navigate?: Navigate
}

/**
 * "Google", "GitHub", a passkey, or the address, as the first line names the other account. It is
 * a sentence under the title, not the title: a page title stays on one line and truncates.
 */
function takenWho(state: GuestSwitchState): string {
  const provider = state.method in OAUTH_PROVIDER_NAMES
    ? OAUTH_PROVIDER_NAMES[state.method as OAuthProviderId]
    : null
  if (provider) return `${provider} is already linked to another account`
  return `${state.maskedEmail ?? "That address"} already has an account`
}

/** How the move option names what moves: the one group by name, or how many. */
function moveHint(state: GuestSwitchState): string {
  const what = state.groups.length === 1
    ? `move "${state.groups[0].name}" into it`
    : `move ${state.groups.length} groups from this guest account into it`
  return `Sign in to that account and ${what}. The guest account is then deleted.`
}

/** "1 note" or "3 notes". */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * `/keep/taken` (#224): the sign-in method the guest tried belongs to another account. Nothing
 * was changed, and nothing is chosen for them: switch and move the guest's groups there, switch
 * and delete the guest's data (confirmed with the real counts), or keep the guest account. For an
 * address the person still proves that account with its password, and its code when it has one.
 */
export function GuestTakenScreen(props: GuestTakenScreenProps): JSX.Element {
  const { state, busy, error, navigate } = props
  const [choice, setChoice] = useState<GuestTakenChoice | null>(null)
  const [missing, setMissing] = useState(false)
  const choiceGroup = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState<{ password?: string; otp?: string } | null>(null)
  const failure = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) failure.current?.focus()
  }, [error])

  if (state === undefined) {
    return (
      <Stack gap="xl">
        <PageHeader title="Checking…" titleDataE2E="taken-title" />
        <p role="status" class="sr-only">Loading…</p>
      </Stack>
    )
  }
  if (state === null) {
    return (
      <Stack gap="xl">
        <PageHeader title="Nothing waits here" titleDataE2E="taken-title" />
        <Stack gap="lg" class={FORM_WIDTH}>
          <p data-e2e="taken-none">
            This choice has timed out, or was already made. Your guest account was not changed.
          </p>
          <Cluster>
            <Button href={GUEST_PATHS.keep} navigate={navigate} variant="outline">
              {KEEP_LABEL}
            </Button>
          </Cluster>
        </Stack>
      </Stack>
    )
  }
  const switching = choice === "move" || choice === "delete"
  const proof = (data: FormData) => ({
    password: state.needsPassword ? String(data.get("password") ?? "") : undefined,
    otp: state.needsCode ? String(data.get("otp") ?? "") : undefined,
  })
  const submit = (data: FormData) => {
    if (choice === null) {
      setMissing(true)
      // The error is about the choice: focus goes to its first option, where the arrows move on.
      choiceGroup.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus()
      return
    }
    if (choice === "keep") return props.onKeep()
    const given = proof(data)
    if (choice === "delete") return setConfirming(given)
    props.onSwitch("move", given.password, given.otp)
  }
  const options = [
    {
      value: "move",
      label: <OptionLabel title="Switch and move my groups" hint={moveHint(state)} />,
    },
    {
      value: "delete",
      label: (
        <OptionLabel
          title="Switch and delete guest data"
          hint="Sign in to that account and delete this guest account with everything in it."
        />
      ),
    },
    {
      value: "keep",
      label: (
        <OptionLabel
          title="Keep the guest account"
          hint="Nothing changes. You can add a different sign-in method."
        />
      ),
    },
  ]
  const label = choice === "delete"
    ? "Switch and delete guest data"
    : choice === "keep"
    ? "Keep the guest account"
    : choice === "move"
    ? "Switch and move my groups"
    : "Continue"
  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <PageHeader title="Linked to another account" titleDataE2E="taken-title" />
        <p class="text-sm text-muted" data-e2e="taken-who">
          {takenWho(state)}. Your guest account was not changed. Choose what happens to what you
          made as a guest.
        </p>
      </Stack>
      <ScreenForm pending={busy} onSubmit={submit} class={FORM_WIDTH}>
        <Stack gap="lg">
          <div ref={choiceGroup}>
            <RadioGroup
              legend="What happens to this guest account"
              name="choice"
              value={choice}
              options={options}
              data-e2e="taken-choice"
              aria-describedby={missing ? "taken-choice-missing" : undefined}
              onChange={(value) => {
                setChoice(value as GuestTakenChoice)
                setMissing(false)
              }}
            />
            {missing && (
              <p id="taken-choice-missing" class="mt-2 text-sm text-danger" role="alert">
                Choose what happens to this guest's work.
              </p>
            )}
          </div>
          {switching && state.needsPassword && (
            <Field
              id="taken-password"
              label="Password"
              hint={`The password of ${state.maskedEmail ?? "that account"}.`}
              required
            >
              <Input
                name="password"
                type="password"
                autocomplete="current-password"
                required
                data-e2e="taken-password"
              />
            </Field>
          )}
          {switching && state.needsCode && (
            <Field
              id="taken-otp"
              label="Code from that account's authenticator app"
              hint="Six digits."
              required
            >
              <Input
                name="otp"
                inputMode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                data-e2e="taken-otp"
              />
            </Field>
          )}
          {error && (
            <div ref={failure} tabIndex={-1}>
              <Notice tone="danger" urgent data-e2e="taken-error">{error}</Notice>
            </div>
          )}
          <Cluster>
            <Button
              type="submit"
              variant={choice === "delete" ? "danger" : choice === "keep" ? "secondary" : "primary"}
              busy={busy}
              busyLabel="Working…"
              data-e2e="taken-submit"
            >
              {label}
            </Button>
          </Cluster>
        </Stack>
      </ScreenForm>
      {confirming && (
        <ConfirmDialog
          title="Delete this guest account?"
          tone="danger"
          confirmLabel="Delete and switch"
          cancelLabel="Cancel"
          busy={busy}
          dataE2E="taken-confirm"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const given = confirming
            setConfirming(null)
            props.onSwitch("delete", given.password, given.otp)
          }}
          message={`Its ${count(state.notes, "note", "notes")} and ${
            count(state.groups.length, "group", "groups")
          } are deleted, and you are signed in to ${
            state.maskedEmail ?? "that account"
          }. This cannot be undone.`}
        />
      )}
    </Stack>
  )
}

/** An option's title and the sentence under it, read together as its name. */
function OptionLabel({ title, hint }: { title: string; hint: string }): JSX.Element {
  return (
    <span class="flex flex-col">
      <span class="font-medium">{title}</span>
      <span class="text-sm text-muted">{hint}</span>
    </span>
  )
}

/** What the inbox and the first-steps card say for a guest (#224), with the action's words. */
export const KEEP_STEP = {
  title: KEEP_LABEL,
  text: "Add a sign-in method so you can open this account on any device.",
} as const

/**
 * Asked before a guest signs out (#224): a guest account has no sign-in method, so signing out
 * loses it. "Keep your account" is the primary way out; "Sign out anyway" does what was asked.
 */
export function GuestSignOutDialog(
  { onKeep, onSignOut, onCancel }: {
    onKeep: () => void
    onSignOut: () => void
    onCancel: () => void
  },
): JSX.Element {
  return (
    <Modal
      open
      title="Sign out of a guest account?"
      ariaDescribedBy="guest-sign-out-text"
      onClose={onCancel}
      cancelLabel="Cancel"
      dataE2E="guest-sign-out"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} data-e2e="guest-sign-out-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onSignOut}
            data-e2e="guest-sign-out-anyway"
          >
            Sign out anyway
          </Button>
          <Button type="button" onClick={onKeep} data-e2e="guest-sign-out-keep">
            {KEEP_LABEL}
          </Button>
        </>
      }
    >
      <p id="guest-sign-out-text">
        This account has no sign-in method, so you cannot sign back in. Everything in it is lost for
        you.
      </p>
    </Modal>
  )
}
