// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { encodeBase64 } from "@std/encoding"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { UserMFAStatus } from "@domain/identity"
import { profilePath, ScreenForm } from "./progressive.tsx"
import type {
  ProfileErrors,
  ProfilePending,
  ProfileValues,
  TotpEnrolment,
} from "./profile-screen.tsx"
import { type ProviderProof, ProviderProofNotice } from "./provider-proof.tsx"
import { SignedInDevices, type SignedInDevicesProps } from "./signed-in-devices.tsx"
import { SignInMethods, type SignInMethodsProps } from "./sign-in-methods.tsx"
import { TwoFactorProof, twoFactorProof, TwoFactorStep, twoFactorStep } from "./two-factor.ts"

/** The fields of this section in the order it shows them: focus goes to the first with an error. */
const FIELD_ORDER = [
  "currentPassword",
  "newPassword",
  "passwordOtp",
  "totpPassword",
  "otp",
  "twoFactorProof",
] as const satisfies readonly (keyof ProfileValues)[]

/** Where a provider sign-in started from this section returns to. */
const HERE = profilePath("security")

/** What {@link SecuritySection} takes. */
export interface SecuritySectionProps {
  mfa: UserMFAStatus
  values: ProfileValues
  onValueChange: (field: keyof ProfileValues, value: string) => void
  errors: ProfileErrors
  pending: ProfilePending
  enrolment: TotpEnrolment | null
  /**
   * The ways in of an account with no password ("Google", "a passkey"), or `null` for an account
   * with one, or while the sign-in methods are not known.
   */
  providerOnly: string | null
  /** What an account with no password confirms a first password and two-factor with. */
  providerProof: ProviderProof | null
  onChangePassword?: () => void
  onSetPassword?: () => void
  onCancelPassword?: () => void
  signOutOthers: boolean
  onSignOutOthersChange?: (signOutOthers: boolean) => void
  /** "Ways to sign in", the password's row included. Without it the password has a row alone. */
  methods?: SignInMethodsProps
  /** "Signed-in devices", last. Without it the section has none. */
  devices?: SignedInDevicesProps
  onStartTotp?: () => void
  onCancelStartTotp?: () => void
  onFinishTotp?: () => void
  onCancelTotp?: () => void
  onDisableTotp?: (proof: TwoFactorProof) => void
  onCancelDisableTotp?: () => void
}

/**
 * The profile's "Sign-in and security" section: the ways to sign in, the password among them with
 * "Change" (or "Set" for an account with none), two-factor sign-in, and the signed-in devices. Each
 * change opens a dialog that asks for the password first, or for an account with no password a
 * sign-in with its provider a moment ago; turning two-factor off asks for the password or, without
 * one, a code from the authenticator app.
 */
export function SecuritySection(props: SecuritySectionProps): JSX.Element {
  const {
    mfa,
    values,
    onValueChange,
    errors,
    pending,
    enrolment,
    providerOnly,
    providerProof,
    signOutOthers,
    onSignOutOthersChange,
    methods,
    devices,
  } = props
  const step = twoFactorStep(mfa, enrolment !== null)
  const proof = twoFactorProof(providerOnly !== null)
  const fieldRefs = {
    currentPassword: useRef<HTMLInputElement>(null),
    newPassword: useRef<HTMLInputElement>(null),
    passwordOtp: useRef<HTMLInputElement>(null),
    totpPassword: useRef<HTMLInputElement>(null),
    otp: useRef<HTMLInputElement>(null),
    twoFactorProof: useRef<HTMLInputElement>(null),
  }
  const enableButton = useRef<HTMLButtonElement>(null)
  const disableButton = useRef<HTMLButtonElement>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const [confirmingEnable, setConfirmingEnable] = useState(false)
  const [confirmingDisable, setConfirmingDisable] = useState(false)
  const cancelPassword = () => {
    setChangingPassword(false)
    props.onCancelPassword?.()
  }
  const cancelEnable = () => {
    setConfirmingEnable(false)
    props.onCancelStartTotp?.()
  }
  const cancelDisable = () => {
    setConfirmingDisable(false)
    props.onCancelDisableTotp?.()
  }

  useSucceeded(
    pending.password,
    Boolean(errors.password || errors.fields.currentPassword || errors.fields.newPassword),
    () => setChangingPassword(false),
  )
  useSucceeded(
    pending.totp,
    Boolean(errors.totp || errors.fields.twoFactorProof || errors.fields.totpPassword),
    () => {
      setConfirmingEnable(false)
      setConfirmingDisable(false)
    },
  )

  // A failed submit lands the person on the field to fix.
  useEffect(() => {
    const first = FIELD_ORDER.find((field) => errors.fields[field])
    if (first) fieldRefs[first].current?.focus()
  }, [errors.fields])

  // Two-factor shows one control per step; when the step changes, focus moves to the new control
  // instead of being lost with the old one. The first render moves nothing.
  const shownStep = useRef(step)
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    if (step === TwoFactorStep.Enable) enableButton.current?.focus()
    if (step === TwoFactorStep.Confirm) fieldRefs.otp.current?.focus()
    if (step === TwoFactorStep.Disable) disableButton.current?.focus()
  }, [step])

  const qrSrc = enrolment?.qrcode ? svgToDataUrl(enrolment.qrcode) : null
  const passwordAction = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      class={TOUCH_TARGET}
      data-e2e="password-open"
      onClick={() => setChangingPassword(true)}
    >
      {providerProof ? "Set" : "Change"} <span class="sr-only">password</span>
    </Button>
  )
  const noPassword = <span data-e2e="password-none">None. You sign in with {providerOnly}.</span>

  return (
    <>
      {methods
        ? (
          <SignInMethods
            {...methods}
            providerProof={providerProof}
            password={{ action: passwordAction, none: noPassword }}
          />
        )
        : (
          <SettingList>
            <SettingRow
              label="Password"
              dataE2E="sign-in-method-password"
              value={providerOnly === null
                ? "Asked for when you sign in on a new device."
                : noPassword}
              action={passwordAction}
            />
          </SettingList>
        )}

      <SettingGroup
        title="Two-factor sign-in"
        description="Sign-in also asks for a code from an authenticator app, so a leaked password is not enough."
        dataE2E="two-factor"
      >
        <SettingList>
          <SettingRow
            label="Authenticator app"
            dataE2E="totp-row"
            value={step === TwoFactorStep.Disable
              ? (
                <span class="flex flex-wrap items-center gap-2">
                  <Badge text="On" color="green" type="outline" />
                  Sign-in asks for a code, unless you use a passkey.
                </span>
              )
              : "Off"}
            action={step === TwoFactorStep.Disable
              ? (
                <Button
                  ref={disableButton}
                  type="button"
                  variant="ghost"
                  size="sm"
                  class={TOUCH_TARGET}
                  data-e2e="totp-disable"
                  disabled={pending.totp}
                  onClick={() => setConfirmingDisable(true)}
                >
                  Turn off <span class="sr-only">two-factor sign-in</span>
                </Button>
              )
              : (
                <Button
                  ref={enableButton}
                  type="button"
                  variant="secondary"
                  size="sm"
                  class={TOUCH_TARGET}
                  data-e2e="totp-start"
                  disabled={pending.totp}
                  onClick={() => setConfirmingEnable(true)}
                >
                  Turn on <span class="sr-only">two-factor sign-in</span>
                </Button>
              )}
          />
        </SettingList>
        {step !== TwoFactorStep.Confirm && !confirmingEnable && !confirmingDisable && (
          <ErrorState message={errors.totp} />
        )}
      </SettingGroup>

      {devices && <SignedInDevices {...devices} />}

      <Modal
        open={changingPassword}
        onClose={cancelPassword}
        title={providerProof ? "Set a password" : "Change password"}
        cancelLabel="Close"
        dataE2E="password-dialog"
      >
        {providerProof && !providerProof.fresh
          ? (
            <Stack>
              <ProviderProofNotice proof={providerProof} next={HERE} />
              <DialogActions>
                <Button type="button" variant="ghost" onClick={cancelPassword}>Close</Button>
              </DialogActions>
            </Stack>
          )
          : (
            <ScreenForm
              pending={pending.password}
              onSubmit={providerProof ? props.onSetPassword : props.onChangePassword}
            >
              <Stack>
                {providerProof
                  ? (
                    <>
                      <p class="text-sm text-muted">
                        With a password you can also sign in with your e-mail address.
                      </p>
                      <ProviderProofNotice proof={providerProof} next={HERE} />
                    </>
                  )
                  : (
                    <Field
                      id="password-current"
                      label="Current password"
                      error={errors.fields.currentPassword}
                      required
                    >
                      <Input
                        ref={fieldRefs.currentPassword}
                        data-e2e="password-current"
                        name="password"
                        type="password"
                        autocomplete="current-password"
                        value={values.currentPassword}
                        onInput={(e) => onValueChange("currentPassword", e.currentTarget.value)}
                        required
                      />
                    </Field>
                  )}
                <Field
                  id="password-new"
                  label="New password"
                  error={errors.fields.newPassword}
                  required
                >
                  <Input
                    ref={fieldRefs.newPassword}
                    data-e2e="password-new"
                    name="newPassword"
                    type="password"
                    autocomplete="new-password"
                    value={values.newPassword}
                    onInput={(e) => onValueChange("newPassword", e.currentTarget.value)}
                    required
                  />
                </Field>
                {providerProof && mfa === UserMFAStatus.CONFIGURED && (
                  // The password could turn two-factor off, so it costs the code too.
                  <Field
                    id="password-otp"
                    label="Code from your authenticator app"
                    error={errors.fields.passwordOtp}
                    required
                  >
                    <Input
                      ref={fieldRefs.passwordOtp}
                      data-e2e="password-otp"
                      name="otp"
                      inputMode="numeric"
                      autocomplete="one-time-code"
                      value={values.passwordOtp}
                      onInput={(e) => onValueChange("passwordOtp", e.currentTarget.value)}
                      required
                    />
                  </Field>
                )}
                {onSignOutOthersChange && !providerProof && (
                  // The row is the 44 px target: the whole label ticks the box.
                  <div class="flex min-h-11 items-center">
                    <Checkbox
                      name="signOutOthers"
                      value="true"
                      data-e2e="password-sign-out-others"
                      checked={signOutOthers}
                      onChange={(e) => onSignOutOthersChange(e.currentTarget.checked)}
                    >
                      Sign out of all other devices
                    </Checkbox>
                  </div>
                )}
                <ErrorState message={errors.password} />
                <DialogActions>
                  <Button type="button" variant="ghost" onClick={cancelPassword}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    data-e2e="password-save"
                    busy={pending.password}
                    busyLabel="Updating…"
                  >
                    {providerProof ? "Set password" : "Change password"}
                  </Button>
                </DialogActions>
              </Stack>
            </ScreenForm>
          )}
      </Modal>

      <Modal
        open={confirmingEnable && step === TwoFactorStep.Enable}
        onClose={cancelEnable}
        title="Turn on two-factor sign-in"
        cancelLabel="Close"
        dataE2E="totp-start-confirm"
      >
        {providerProof && !providerProof.fresh
          ? (
            <Stack>
              <ProviderProofNotice proof={providerProof} next={HERE} />
              <DialogActions>
                <Button type="button" variant="ghost" onClick={cancelEnable}>Close</Button>
              </DialogActions>
            </Stack>
          )
          : (
            <ScreenForm pending={pending.totp} onSubmit={props.onStartTotp}>
              <Stack>
                <p class="text-sm text-muted">
                  Once it is on, sign-in also asks for a code from your authenticator app, and your
                  other devices are signed out.{providerProof
                    ? ""
                    : " Enter your password to confirm it is you."}
                </p>
                {providerProof ? <ProviderProofNotice proof={providerProof} next={HERE} /> : (
                  <Field
                    id="totp-start-password"
                    label="Password"
                    error={errors.fields.totpPassword}
                    required
                  >
                    <Input
                      ref={fieldRefs.totpPassword}
                      data-e2e="totp-start-password"
                      name="password"
                      type="password"
                      autocomplete="current-password"
                      value={values.totpPassword}
                      onInput={(e) => onValueChange("totpPassword", e.currentTarget.value)}
                      required
                    />
                  </Field>
                )}
                <ErrorState message={errors.totp} />
                <DialogActions>
                  <Button type="button" variant="ghost" onClick={cancelEnable}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    data-e2e="totp-start-submit"
                    busy={pending.totp}
                    busyLabel="Preparing…"
                  >
                    Continue
                  </Button>
                </DialogActions>
              </Stack>
            </ScreenForm>
          )}
      </Modal>

      {step === TwoFactorStep.Confirm && (
        <Modal
          open
          onClose={() => props.onCancelTotp?.()}
          title="Turn on two-factor sign-in"
          cancelLabel="Close"
          dataE2E="totp-dialog"
        >
          <ScreenForm pending={pending.totp} onSubmit={props.onFinishTotp}>
            <Stack>
              <p class="text-sm text-muted">
                Scan the code with your authenticator app, then enter the six digits it shows.
              </p>
              {qrSrc && (
                <div class="self-center rounded-lg border border-subtle bg-white p-3">
                  <img src={qrSrc} alt="QR code for your authenticator app" class="size-40" />
                </div>
              )}
              <p class="text-xs text-muted break-all">
                Cannot scan it? Enter this key:{" "}
                <code class="font-mono" data-e2e="totp-secret">{enrolment?.secret}</code>
              </p>
              <Field
                id="totp-connect-otp"
                label="Code from your app"
                error={errors.fields.otp}
                required
              >
                <Input
                  ref={fieldRefs.otp}
                  data-e2e="totp-connect-otp"
                  name="otp"
                  inputMode="numeric"
                  autocomplete="one-time-code"
                  value={values.otp}
                  onInput={(e) => onValueChange("otp", e.currentTarget.value)}
                  required
                />
              </Field>
              <ErrorState message={errors.totp} />
              <DialogActions>
                <Button type="button" variant="ghost" onClick={() => props.onCancelTotp?.()}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-e2e="totp-connect-finish"
                  busy={pending.totp}
                  busyLabel="Turning on…"
                >
                  Turn on
                </Button>
              </DialogActions>
            </Stack>
          </ScreenForm>
        </Modal>
      )}

      <Modal
        open={confirmingDisable && step === TwoFactorStep.Disable}
        onClose={cancelDisable}
        title="Turn off two-factor sign-in?"
        cancelLabel="Close"
        tone="danger"
        dataE2E="totp-disable-confirm"
      >
        <ScreenForm pending={pending.totp} onSubmit={() => props.onDisableTotp?.(proof)}>
          <Stack>
            <p class="text-sm text-muted">
              {proof === TwoFactorProof.Code
                ? "Sign-in will no longer ask for a code. Enter a code from your authenticator app to confirm it is you."
                : "Sign-in will ask only for your password. Enter your password to confirm it is you."}
              {" "}
              You can turn two-factor on again at any time.
            </p>
            <Field
              id="totp-disable-proof"
              label={proof === TwoFactorProof.Code ? "Code from your app" : "Password"}
              error={errors.fields.twoFactorProof}
              required
            >
              {proof === TwoFactorProof.Code
                ? (
                  <Input
                    ref={fieldRefs.twoFactorProof}
                    data-e2e="totp-disable-proof"
                    name="otp"
                    inputMode="numeric"
                    autocomplete="one-time-code"
                    value={values.twoFactorProof}
                    onInput={(e) => onValueChange("twoFactorProof", e.currentTarget.value)}
                    required
                  />
                )
                : (
                  <Input
                    ref={fieldRefs.twoFactorProof}
                    data-e2e="totp-disable-proof"
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    value={values.twoFactorProof}
                    onInput={(e) => onValueChange("twoFactorProof", e.currentTarget.value)}
                    required
                  />
                )}
            </Field>
            <ErrorState message={errors.totp} />
            <DialogActions>
              <Button type="button" variant="ghost" onClick={cancelDisable}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="danger"
                data-e2e="totp-disable-submit"
                busy={pending.totp}
                busyLabel="Turning off…"
              >
                Turn off
              </Button>
            </DialogActions>
          </Stack>
        </ScreenForm>
      </Modal>
    </>
  )
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${encodeBase64(new TextEncoder().encode(svg))}`
}
