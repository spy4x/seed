import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { type EmailStatus, emailToVerify } from "@domain/identity"
import { PageHeader, TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
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
 * The notice a signed-in page shows while an address waits for its code. Nothing when there is
 * none. Its action opens the page where the code goes.
 */
export function EmailBanner(
  { status, navigate }: { status: EmailStatus | null; navigate?: Navigate },
): JSX.Element | null {
  const email = status && emailToVerify(status)
  if (!email) return null
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
      Verify <strong class="wrap-anywhere">{email}</strong> with the code we mail there.
    </Notice>
  )
}

/**
 * Stands in for the e-mail page when its state could not be read: the message, and a way to try
 * again. With `onRetry` the app reads the state again; without it, the button is a link that loads
 * the page again.
 */
export function EmailUnavailable(
  { onRetry, navigate }: { onRetry?: () => void; navigate?: Navigate },
): JSX.Element {
  return (
    <Stack data-e2e="email-unavailable">
      <ErrorState message={EMAIL_FAILURES.load} />
      <div class="text-center">
        {onRetry
          ? (
            <Button type="button" data-e2e="email-retry" onClick={onRetry}>
              Try again
            </Button>
          )
          : (
            <Button href={SCREEN_PATHS.email} navigate={navigate} data-e2e="email-retry">
              Try again
            </Button>
          )}
      </div>
    </Stack>
  )
}

/** What the person typed into the screen's forms. */
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

export interface EmailScreenProps {
  status: EmailStatus
  values: EmailValues
  onValueChange: (field: keyof EmailValues, value: string) => void
  errors: EmailMessages
  /** What the API said when it accepted a request: a code is on its way, say. */
  notices: Pick<EmailMessages, "send" | "change">
  pending: Record<keyof EmailMessages, boolean>
  onVerify?: () => void
  onSend?: () => void
  onChange?: () => void
  /**
   * Set for an account with no password: the change dialog asks for no password, and confirms
   * with a provider sign-in a moment ago instead. Until there is one it shows the way to it.
   */
  providerProof?: ProviderProof | null
  navigate?: Navigate
}

/**
 * The person's e-mail address: a row with the address and its state, the code that proves it while
 * one waits, and a change of address in a dialog that opens only when asked. A change closes the
 * dialog and moves focus to the code for the new address. Closing the dialog without a change asks
 * the app to drop the typed password. An account with no password signs in with its provider
 * again in place of the password.
 */
export function EmailScreen(
  {
    status,
    values,
    onValueChange,
    errors,
    notices,
    pending,
    onVerify,
    onSend,
    onChange,
    providerProof,
    navigate,
  }: EmailScreenProps,
): JSX.Element {
  const target = emailToVerify(status)
  const codeField = useFocusOnError(errors.verify)
  const emailField = useFocusOnError(errors.change)
  // The change dialog closes once its request went through, even one that asks again for the
  // address already waiting, where nothing else on the page changes. Focus then moves on to the
  // code, after the dialog has handed it back to its opener.
  const [changing, setChanging] = useState(false)
  const focusCode = useRef(false)
  useSucceeded(pending.change, Boolean(errors.change), () => {
    focusCode.current = changing
    setChanging(false)
  })
  useEffect(() => {
    if (changing || !focusCode.current) return
    focusCode.current = false
    codeField.current?.focus()
  }, [changing])
  // Closing the dialog drops the typed password, so opening it again never shows it.
  const closeChange = () => {
    setChanging(false)
    if (values.password) onValueChange("password", "")
  }

  // A change just asked for, or a code just used: focus moves on to the step that follows.
  const shown = useRef(target)
  useEffect(() => {
    if (shown.current === target) return
    shown.current = target
    if (target) codeField.current?.focus()
  }, [target])

  const hasEmail = status.email !== null
  const providerNames = providerProof?.providers
    .map((provider) => OAUTH_PROVIDER_NAMES[provider]).join(" or ")
  return (
    <Stack gap="xl">
      <PageHeader
        title="E-mail address"
        back={{ href: SCREEN_PATHS.profile, label: "Back to profile" }}
        navigate={navigate}
      />

      <SettingList>
        <SettingRow
          label="Address"
          value={
            <span class="flex flex-wrap items-center gap-2">
              <span class="wrap-anywhere" data-e2e="email-current">
                {hasEmail
                  ? status.email
                  : providerProof
                  ? "None yet."
                  : "None yet. You sign in with your username."}
              </span>
              {hasEmail && <EmailState proven={status.proven} />}
            </span>
          }
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class={TOUCH_TARGET}
              data-e2e="email-change-open"
              onClick={() => setChanging(true)}
            >
              {hasEmail ? "Change" : "Add"} <span class="sr-only">e-mail address</span>
            </Button>
          }
        />
      </SettingList>

      {target && (
        <SettingGroup
          title="Enter the code"
          description={
            <>
              Enter the code from the mail to{" "}
              <strong class="wrap-anywhere">{target}</strong>. It works once, for 10 minutes; if
              none arrived, ask for a new one.{status.pending &&
                " Your address changes once you enter it."}
            </>
          }
          dataE2E="email-verify-card"
        >
          {/* One card, like every section of the profile: the code, then a new one on request. */}
          <Card>
            {/* The rows of the cards around it start at the same inset. */}
            <CardBody class="sm:p-6">
              <Stack gap="lg">
                {notices.change && (
                  <p class="text-sm" role="status" data-e2e="email-change-notice">
                    {notices.change}
                  </p>
                )}
                <ScreenForm
                  pending={pending.verify}
                  onSubmit={onVerify}
                >
                  <Stack class="max-w-sm">
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
                    <Cluster>
                      <Button
                        type="submit"
                        class="w-full sm:w-auto"
                        data-e2e="email-verify"
                        busy={pending.verify}
                        busyLabel="Checking…"
                      >
                        Verify
                      </Button>
                    </Cluster>
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
            </CardBody>
          </Card>
        </SettingGroup>
      )}

      <Modal
        open={changing}
        onClose={closeChange}
        title={hasEmail ? "Change e-mail address" : "Add an e-mail address"}
        cancelLabel="Close"
        dataE2E="email-change-dialog"
      >
        {providerProof && !providerProof.fresh
          ? (
            <Stack>
              <ProviderProofNotice proof={providerProof} next={SCREEN_PATHS.email} />
              <Cluster justify="end">
                <Button type="button" variant="ghost" onClick={closeChange}>Close</Button>
              </Cluster>
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
                  ? <ProviderProofNotice proof={providerProof} next={SCREEN_PATHS.email} />
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
                <Cluster justify="end">
                  <Button type="button" variant="ghost" onClick={closeChange}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    data-e2e="email-change"
                    busy={pending.change}
                    busyLabel="Sending…"
                  >
                    Send code
                  </Button>
                </Cluster>
              </Stack>
            </ScreenForm>
          )}
      </Modal>
    </Stack>
  )
}

/** Whether the address is proven, as a quiet badge beside it. */
function EmailState({ proven }: { proven: boolean }): JSX.Element {
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
