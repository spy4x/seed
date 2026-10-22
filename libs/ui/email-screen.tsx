import { Fragment, type JSX } from "preact"
import { useEffect } from "preact/hooks"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { type EmailStatus, emailToVerify } from "@domain/identity"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"
import { useFocusOnError } from "@spy4x/preact-ui/use-focus-on-error"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { OAUTH_PROVIDER_NAMES } from "@domain/identity"
import { type ProviderProof, ProviderProofNotice } from "./provider-proof.tsx"

/** The messages shown when an action failed without a message of its own. */
export const EMAIL_FAILURES = {
  verify: "Could not check the code",
  send: "Could not send a new code",
  change: "Could not change the address",
  load: "Your e-mail address could not be read.",
} as const

/**
 * Whether `EmailBanner` shows anything for this state: only while an address waits for its code.
 * A frame passes the banner only then, because it keeps room for any banner it is given.
 */
export function showsEmailBanner(status: EmailStatus | null): boolean {
  return Boolean(status && emailToVerify(status))
}

/**
 * An address that a narrow screen wraps after its `@` and before its dots, never mid-word:
 * `ada@<wbr>example<wbr>.com`. A part too long for a whole line still breaks anywhere.
 */
function breakableAddress(email: string): JSX.Element[] {
  return email.split(/(?<=@)|(?=\.)/).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {part}
    </Fragment>
  ))
}

/**
 * The notice a signed-in page shows while an address waits for its code. Nothing when there is
 * none (`showsEmailBanner`). Its action opens the page where the code goes.
 */
export function EmailBanner(
  { status, navigate }: { status: EmailStatus | null; navigate?: Navigate },
): JSX.Element | null {
  if (!status || !showsEmailBanner(status)) return null
  const email = emailToVerify(status)
  return (
    <Notice
      tone="warning"
      data-e2e="email-banner"
      action={
        <Button
          href={SCREEN_PATHS.email}
          navigate={navigate}
          variant="outline"
          size="sm"
          class={TOUCH_TARGET}
        >
          Enter the code
        </Button>
      }
    >
      Verify <strong class="wrap-anywhere">{breakableAddress(email!)}</strong>{" "}
      with the code we mail there.
    </Notice>
  )
}

/** Stands in for the e-mail address when it could not be read: the message, and a way to try again. */
export function EmailUnavailable({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <Stack data-e2e="email-unavailable">
      <ErrorState message={EMAIL_FAILURES.load} />
      <div>
        <Button type="button" variant="secondary" data-e2e="email-retry" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Stack>
  )
}

/** What the person typed into the e-mail dialog. */
export interface EmailValues {
  /** The code from the mail. */
  code: string
  /** The new address. */
  email: string
  /** The current password, which an address change asks for. */
  password: string
}

/** One message per form: an error, or what the API said when it accepted the request. */
export interface EmailMessages {
  verify: string | null
  send: string | null
  change: string | null
}

/** What the e-mail dialog needs from the app: what was typed, what is in flight, what failed. */
export interface EmailChangeProps {
  values: EmailValues
  onValueChange: (field: keyof EmailValues, value: string) => void
  errors: EmailMessages
  /** What the API said when it accepted "Send a new code". */
  notices: Pick<EmailMessages, "send">
  pending: Record<keyof EmailMessages, boolean>
  onVerify?: () => void
  onSend?: () => void
  onChange?: () => void
  /** The dialog closed: the app drops what was typed and the messages. */
  onClose?: () => void
}

/** Which step of the e-mail dialog shows: the new address, or the code mailed to it. */
export type EmailStep = "address" | "code"

/**
 * The e-mail address dialog, in two steps. "address" asks for the new address and the current
 * password (an account with no password confirms with a provider sign-in a moment ago instead,
 * and until there is one the dialog shows the way to it), then "Send code". Once the request went
 * through, the same dialog asks for the code mailed to the new address, with "Send a new code";
 * the address changes once the code is entered, and the dialog then closes. It opens straight at
 * the code while an address already waits for one.
 */
export function EmailDialog(
  {
    step,
    onStepChange,
    status,
    values,
    onValueChange,
    errors,
    notices,
    pending,
    onVerify,
    onSend,
    onChange,
    onClose,
    providerProof,
    next,
  }: EmailChangeProps & {
    /** The open step, or `null` while the dialog is closed. */
    step: EmailStep | null
    onStepChange: (step: EmailStep | null) => void
    status: EmailStatus
    providerProof?: ProviderProof | null
    /** Where a provider sign-in started here returns to. */
    next: string
  },
): JSX.Element {
  const target = emailToVerify(status)
  const codeField = useFocusOnError(errors.verify)
  const emailField = useFocusOnError(errors.change)
  const close = () => {
    onStepChange(null)
    onClose?.()
  }
  // A request that went through moves the dialog on to the code; a code that went through closes
  // it. Focus then lands in the code field, or goes back to the button that opened the dialog.
  useSucceeded(pending.change, Boolean(errors.change), () => {
    if (step === "address") onStepChange("code")
  })
  useSucceeded(pending.verify, Boolean(errors.verify), () => {
    if (step === "code") close()
  })
  useEffect(() => {
    if (step === "code") codeField.current?.focus()
  }, [step])

  const hasEmail = status.email !== null
  const providerNames = providerProof?.providers
    .map((provider) => OAUTH_PROVIDER_NAMES[provider]).join(" or ")
  const title = step === "code"
    ? "Enter the code"
    : hasEmail
    ? "Change e-mail address"
    : "Add an e-mail address"
  return (
    <Modal
      open={step !== null}
      onClose={close}
      title={title}
      cancelLabel="Close"
      dataE2E="email-change-dialog"
    >
      {step === "code"
        ? (
          <Stack>
            <p class="text-sm text-muted" data-e2e="email-verify-card">
              Enter the code from the mail to{" "}
              <strong class="wrap-anywhere text-foreground">{target}</strong>. It works once, for 10
              minutes.{status.pending && hasEmail
                ? ` You keep signing in with ${status.email} until you enter it.`
                : ""}
            </p>
            <ScreenForm pending={pending.verify} onSubmit={onVerify}>
              <Stack>
                <Field id="email-code" label="Code" error={errors.verify} required>
                  <Input
                    ref={codeField}
                    data-e2e="email-code"
                    name="code"
                    autocomplete="one-time-code"
                    autocapitalize="off"
                    spellcheck={false}
                    value={values.code}
                    onInput={(e) => onValueChange("code", e.currentTarget.value)}
                    required
                  />
                </Field>
                <DialogActions>
                  <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
                  <Button
                    type="submit"
                    data-e2e="email-verify"
                    busy={pending.verify}
                    busyLabel="Checking…"
                  >
                    Confirm address
                  </Button>
                </DialogActions>
              </Stack>
            </ScreenForm>
            <ScreenForm pending={pending.send} onSubmit={onSend}>
              <Stack gap="sm">
                <p class="text-sm text-muted">
                  No mail?{" "}
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    class={TOUCH_TARGET}
                    data-e2e="email-send"
                    busy={pending.send}
                    busyLabel="Sending…"
                  >
                    Send a new code
                  </Button>
                </p>
                <ErrorState message={errors.send} />
                {notices.send && (
                  <p class="text-sm" role="status" data-e2e="email-send-notice">
                    {notices.send}
                  </p>
                )}
              </Stack>
            </ScreenForm>
          </Stack>
        )
        : providerProof && !providerProof.fresh
        ? (
          <Stack>
            <ProviderProofNotice proof={providerProof} next={next} />
            <DialogActions>
              <Button type="button" variant="ghost" onClick={close}>Close</Button>
            </DialogActions>
          </Stack>
        )
        : (
          <ScreenForm pending={pending.change} onSubmit={onChange}>
            <Stack>
              <p class="text-sm text-muted">
                We send a code to the new address. {providerProof
                  ? `Your address changes once you enter it. You keep signing in with ${providerNames}.`
                  : hasEmail
                  ? `You keep signing in with ${status.email} until you enter it.`
                  : "Once you enter it, you sign in with that address."}
              </p>
              <Field id="email-new" label="New e-mail address" required>
                <Input
                  ref={emailField}
                  data-e2e="email-new"
                  name="email"
                  type="email"
                  autocomplete="email"
                  value={values.email}
                  onInput={(e) => onValueChange("email", e.currentTarget.value)}
                  required
                />
              </Field>
              {providerProof
                ? <ProviderProofNotice proof={providerProof} next={next} />
                : (
                  <Field id="email-password" label="Current password" required>
                    <Input
                      data-e2e="email-password"
                      name="password"
                      type="password"
                      autocomplete="current-password"
                      value={values.password}
                      onInput={(e) => onValueChange("password", e.currentTarget.value)}
                      required
                    />
                  </Field>
                )}
              {/* The API's refusal names no field: the password, the address or the limit. */}
              <ErrorState message={errors.change} />
              <DialogActions>
                <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
                <Button
                  type="submit"
                  data-e2e="email-change"
                  busy={pending.change}
                  busyLabel="Sending…"
                >
                  Send code
                </Button>
              </DialogActions>
            </Stack>
          </ScreenForm>
        )}
    </Modal>
  )
}

/** Whether the address is proven, as a quiet badge beside it. */
export function EmailState({ proven }: { proven: boolean }): JSX.Element {
  return (
    <span data-e2e="email-state">
      <Badge
        text={proven ? "Verified" : "Not verified"}
        color={proven ? "green" : "orange"}
        type="outline"
      />
    </span>
  )
}
