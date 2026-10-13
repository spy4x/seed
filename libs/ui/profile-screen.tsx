import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { encodeBase64 } from "@std/encoding"
import { IconBell, IconLockClosed } from "@spy4x/preact-icons"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import {
  type EmailStatus,
  type SignInMethod,
  UserMFAStatus,
  type UserPushTokenPublic,
} from "@domain/identity"
import { AccountDelete, type AccountDeleteProps } from "./account-delete.tsx"
import { ACCOUNT_COLUMN } from "./frame.tsx"
import { PageHeader, TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { type Navigate, PROFILE_ANCHORS, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { SignedInDevices, type SignedInDevicesProps } from "./signed-in-devices.tsx"
import { signInMethodName, SignInMethods, type SignInMethodsProps } from "./sign-in-methods.tsx"
import { ApiTokens, type ApiTokensProps } from "./api-tokens.tsx"
import { useSucceeded } from "@spy4x/preact-ui/use-succeeded"
import { TwoFactorProof, twoFactorProof, TwoFactorStep, twoFactorStep } from "./two-factor.ts"

/** The messages shown when an action failed without a message of its own. */
export const PROFILE_FAILURES = {
  profile: "Update failed",
  password: "Password change failed",
  totpFinish: "Failed to enable 2FA",
  totpDisable: "Failed to disable 2FA",
  push: "Push registration failed",
} as const

/** What the user has typed into the profile forms. */
export interface ProfileValues {
  firstName: string
  lastName: string
  currentPassword: string
  newPassword: string
  otp: string
  /** The password or the authenticator code typed to turn two-factor off. */
  twoFactorProof: string
}

/** A message per field, keyed like {@link ProfileValues}; a field without one is absent or `null`. */
export type ProfileFieldErrors = Partial<Record<keyof ProfileValues, string | null>>

/**
 * The errors of the profile page. A message about one field goes in `fields`, under that field; a
 * message that names no field goes under its form.
 */
export interface ProfileErrors {
  /**
   * Shown under each field and tied to it. Focus moves to the first field with a message each time
   * the app passes a new `fields` object.
   */
  fields: ProfileFieldErrors
  profile: string | null
  password: string | null
  /** The two-factor card's error. */
  totp: string | null
  push: string | null
}

/** The fields in the order the page shows them: focus goes to the first one with an error. */
const FIELD_ORDER: readonly (keyof ProfileValues)[] = [
  "firstName",
  "lastName",
  "currentPassword",
  "newPassword",
  "otp",
  "twoFactorProof",
]

/** Which actions are in flight. */
export interface ProfilePending {
  profile: boolean
  password: boolean
  totp: boolean
  push: boolean
}

/** An authenticator-app enrolment under way: the QR code (an SVG document) and its secret. */
export interface TotpEnrolment {
  qrcode: string
  secret: string
}

export interface ProfileScreenProps {
  /** The signed-in user, or `null` when nobody is signed in. */
  user: { mfa: UserMFAStatus; firstName: string; lastName: string } | null
  /** The session owes its one-time code: the screen points to it instead. */
  isMfaRequired: boolean
  /** The person's e-mail address and whether it is proven, or `null` while it is not known. */
  email?: EmailStatus | null
  values: ProfileValues
  onValueChange: (field: keyof ProfileValues, value: string) => void
  errors: ProfileErrors
  pending: ProfilePending
  enrolment: TotpEnrolment | null
  pushDevices: readonly UserPushTokenPublic[]
  onSaveProfile?: () => void
  /** Drops what was typed in the name dialog and its errors, when the person closes it. */
  onCancelProfile?: () => void
  onChangePassword?: () => void
  /** Drops what was typed in the password dialog and its errors, when the person closes it. */
  onCancelPassword?: () => void
  /** Whether the password change also signs out every other device. */
  signOutOthers?: boolean
  /**
   * Called when the person ticks or clears "Sign out of all other devices" in the password dialog.
   * Without it the dialog has no such box.
   */
  onSignOutOthersChange?: (signOutOthers: boolean) => void
  /** The "Sign-in methods" section, after Security. Without it the page has none. */
  methods?: SignInMethodsProps
  /** The "Signed-in devices" section, after the sign-in methods. Without it the page has none. */
  devices?: SignedInDevicesProps
  /** The "API tokens" section, after the signed-in devices. Without it the page has none. */
  apiTokens?: ApiTokensProps
  onStartTotp?: () => void
  onFinishTotp?: () => void
  /** Drops an enrolment under way, when the person closes the set-up dialog. */
  onCancelTotp?: () => void
  /**
   * Called when the person submits the "Turn off" dialog, with what `values.twoFactorProof` holds:
   * the password, or the code for an account with no password.
   */
  onDisableTotp?: (proof: TwoFactorProof) => void
  /** Drops what was typed in the "Turn off" dialog and its errors, when the person closes it. */
  onCancelDisableTotp?: () => void
  /**
   * Registering a push device needs the browser's push manager. Without it there is no "Add
   * device" button.
   */
  onRegisterPush?: () => void
  onRemovePush: (deviceId: string) => void
  /**
   * The "Danger zone" with "Delete my account", at the bottom. Without it the page has none.
   * `twoFactor` and `navigate` come from this screen's own props.
   */
  accountDeletion?: Omit<AccountDeleteProps, "twoFactor" | "navigate" | "unavailable">
  navigate?: Navigate
}

/**
 * The profile page as a list of settings: name and e-mail address, then password and two-factor
 * sign-in, then the signed-in devices, the API tokens and push devices. Each row shows its value
 * and one action; a form opens in a dialog only when asked, and closes once its change went
 * through. Turning two-factor off asks for the password first, or for a code from the authenticator
 * app when the account has no password.
 * Deleting the account sits last, in a closed "Danger zone".
 */
export function ProfileScreen(
  {
    user,
    isMfaRequired,
    email,
    values,
    onValueChange,
    errors,
    pending,
    enrolment,
    pushDevices,
    onSaveProfile,
    onCancelProfile,
    onChangePassword,
    onCancelPassword,
    signOutOthers = true,
    onSignOutOthersChange,
    methods,
    devices,
    apiTokens,
    onStartTotp,
    onFinishTotp,
    onCancelTotp,
    onDisableTotp,
    onCancelDisableTotp,
    onRegisterPush,
    onRemovePush,
    accountDeletion,
    navigate,
  }: ProfileScreenProps,
): JSX.Element {
  const step = user ? twoFactorStep(user.mfa, enrolment !== null) : null
  const providerOnly = providerOnlyNames(methods?.methods)
  const proof = twoFactorProof(providerOnly !== null)
  const fieldRefs = {
    firstName: useRef<HTMLInputElement>(null),
    lastName: useRef<HTMLInputElement>(null),
    currentPassword: useRef<HTMLInputElement>(null),
    newPassword: useRef<HTMLInputElement>(null),
    otp: useRef<HTMLInputElement>(null),
    twoFactorProof: useRef<HTMLInputElement>(null),
  }
  const enableButton = useRef<HTMLButtonElement>(null)
  const disableButton = useRef<HTMLButtonElement>(null)
  const [editingName, setEditingName] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [confirmingDisable, setConfirmingDisable] = useState(false)
  const cancelName = () => {
    setEditingName(false)
    onCancelProfile?.()
  }
  const cancelPassword = () => {
    setChangingPassword(false)
    onCancelPassword?.()
  }
  const cancelDisable = () => {
    setConfirmingDisable(false)
    onCancelDisableTotp?.()
  }

  useSucceeded(
    pending.profile,
    Boolean(errors.profile || errors.fields.firstName || errors.fields.lastName),
    () => setEditingName(false),
  )
  useSucceeded(
    pending.password,
    Boolean(errors.password || errors.fields.currentPassword || errors.fields.newPassword),
    () => setChangingPassword(false),
  )
  useSucceeded(
    pending.totp,
    Boolean(errors.totp || errors.fields.twoFactorProof),
    () => setConfirmingDisable(false),
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

  if (isMfaRequired) {
    return (
      <EmptyState
        icon={<IconLockClosed class="size-6" />}
        title="Enter your one-time code"
        headingLevel={1}
        description="Your profile opens once you enter the code from your authenticator app."
        action={
          <Button href={SCREEN_PATHS.oneTimeCode} navigate={navigate}>
            Enter the code
          </Button>
        }
      />
    )
  }

  if (!user || step === null) {
    return (
      <div data-e2e="signin-required">
        <EmptyState
          icon={<IconLockClosed class="size-6" />}
          title="Sign in to see your profile"
          headingLevel={1}
          description="Your name, password and devices are here once you sign in."
          action={
            <Cluster justify="center">
              <Button href={SCREEN_PATHS.signIn} navigate={navigate}>Sign in</Button>
              <Button href={SCREEN_PATHS.signUp} navigate={navigate} variant="outline">
                Create an account
              </Button>
            </Cluster>
          }
        />
      </div>
    )
  }

  const name = `${user.firstName} ${user.lastName}`.trim()
  const qrSrc = enrolment?.qrcode ? svgToDataUrl(enrolment.qrcode) : null

  return (
    <Stack gap="xl" class={ACCOUNT_COLUMN}>
      <PageHeader title="Profile" />

      <SettingGroup title="Account">
        <SettingList>
          <SettingRow
            label="Name"
            value={<span data-e2e="profile-name">{name || "Not set"}</span>}
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                class={TOUCH_TARGET}
                data-e2e="profile-edit"
                onClick={() => setEditingName(true)}
              >
                Edit <span class="sr-only">name</span>
              </Button>
            }
          />
          <SettingRow
            label="E-mail address"
            value={<EmailValue email={email} provider={providerOnly} />}
            action={providerOnly === null && (
              <Button
                href={SCREEN_PATHS.email}
                navigate={navigate}
                variant="secondary"
                size="sm"
                class={TOUCH_TARGET}
                data-e2e="profile-email-link"
              >
                {email?.email === null ? "Add" : "Change"}{" "}
                <span class="sr-only">e-mail address</span>
              </Button>
            )}
          />
        </SettingList>
      </SettingGroup>

      {/* The first-steps card links here (`PROFILE_ANCHORS`); the header above is sticky. */}
      <div id={PROFILE_ANCHORS.security} class="scroll-mt-16">
        <SettingGroup title="Security">
          <SettingList>
            <SettingRow
              label="Password"
              value={providerOnly === null
                ? "Asked for when you sign in on a new device."
                : <span data-e2e="password-none">None. You sign in with {providerOnly}.</span>}
              action={providerOnly === null && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  class={TOUCH_TARGET}
                  data-e2e="password-open"
                  onClick={() => setChangingPassword(true)}
                >
                  Change <span class="sr-only">password</span>
                </Button>
              )}
            />
            <SettingRow
              label="Two-factor sign-in"
              dataE2E="totp-row"
              value={step === TwoFactorStep.Disable
                ? (
                  <span class="flex flex-wrap items-center gap-2">
                    <Badge text="On" color="green" type="outline" />
                    Sign-in also asks for a code from your authenticator app.
                  </span>
                )
                : "Off. Add a code from an authenticator app to every sign-in."}
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
                  <ScreenForm
                    pending={pending.totp}
                    onSubmit={onStartTotp}
                  >
                    <Button
                      ref={enableButton}
                      type="submit"
                      variant="secondary"
                      size="sm"
                      class={TOUCH_TARGET}
                      data-e2e="totp-start"
                      busy={pending.totp && step === TwoFactorStep.Enable}
                      busyLabel="Preparing..."
                    >
                      Turn on <span class="sr-only">two-factor sign-in</span>
                    </Button>
                  </ScreenForm>
                )}
            />
          </SettingList>
          {step !== TwoFactorStep.Confirm && !confirmingDisable && (
            <ErrorState message={errors.totp} />
          )}
        </SettingGroup>
      </div>

      {methods && <SignInMethods {...methods} />}
      {devices && <SignedInDevices {...devices} />}

      {apiTokens && <ApiTokens {...apiTokens} />}

      <div id={PROFILE_ANCHORS.pushDevices} class="scroll-mt-16">
        <SettingGroup
          title="Push devices"
          description="Devices that get a notification when something changes."
        >
          <ErrorState message={errors.push} />
          {pushDevices.length === 0
            ? (
              <EmptyState
                icon={<IconBell class="size-6" />}
                title="No devices yet"
                headingLevel={3}
                class="w-full max-w-none"
                description="Add this browser to get notifications on it."
                action={onRegisterPush && (
                  <AddDevice
                    onClick={onRegisterPush}
                    busy={pending.push}
                  />
                )}
              />
            )
            : (
              <>
                <SettingList>
                  {pushDevices.map((device) => (
                    <SettingRow
                      key={device.id}
                      dataE2E={`push-device-${device.deviceId}`}
                      label={`Device ${device.deviceId.slice(-8)}`}
                      value={`Added ${new Date(device.createdAt).toLocaleString()}`}
                      action={
                        <ScreenForm
                          pending={pending.push}
                          onSubmit={() => onRemovePush(device.deviceId)}
                        >
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            class={TOUCH_TARGET}
                            data-e2e={`push-remove-${device.deviceId}`}
                            disabled={pending.push}
                          >
                            Remove <span class="sr-only">device {device.deviceId.slice(-8)}</span>
                          </Button>
                        </ScreenForm>
                      }
                    />
                  ))}
                </SettingList>
                {onRegisterPush && (
                  <div>
                    <AddDevice onClick={onRegisterPush} busy={pending.push} />
                  </div>
                )}
              </>
            )}
        </SettingGroup>
      </div>

      {accountDeletion && (
        <AccountDelete
          {...accountDeletion}
          twoFactor={user.mfa === UserMFAStatus.CONFIGURED}
          unavailable={providerOnly === null
            ? null
            : "This account cannot be deleted here yet: it has no password to confirm the deletion with."}
          navigate={navigate}
        />
      )}

      <Modal
        open={editingName}
        onClose={cancelName}
        title="Edit name"
        cancelLabel="Close"
        dataE2E="profile-dialog"
      >
        <ScreenForm
          pending={pending.profile}
          onSubmit={onSaveProfile}
        >
          <Stack>
            <Field
              id="profile-first-name"
              label="First name"
              error={errors.fields.firstName}
              required
            >
              <Input
                ref={fieldRefs.firstName}
                data-e2e="profile-first-name"
                name="firstName"
                autocomplete="given-name"
                value={values.firstName}
                onInput={(e) => onValueChange("firstName", e.currentTarget.value)}
                required
              />
            </Field>
            <Field
              id="profile-last-name"
              label="Last name"
              error={errors.fields.lastName}
              required
            >
              <Input
                ref={fieldRefs.lastName}
                data-e2e="profile-last-name"
                name="lastName"
                autocomplete="family-name"
                value={values.lastName}
                onInput={(e) => onValueChange("lastName", e.currentTarget.value)}
                required
              />
            </Field>
            <ErrorState message={errors.profile} />
            <DialogButtons
              onCancel={cancelName}
              submit={
                <Button
                  type="submit"
                  data-e2e="profile-save"
                  busy={pending.profile}
                  busyLabel="Saving..."
                >
                  Save
                </Button>
              }
            />
          </Stack>
        </ScreenForm>
      </Modal>

      <Modal
        open={changingPassword}
        onClose={cancelPassword}
        title="Change password"
        cancelLabel="Close"
        dataE2E="password-dialog"
      >
        <ScreenForm
          pending={pending.password}
          onSubmit={onChangePassword}
        >
          <Stack>
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
            {onSignOutOthersChange && (
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
            <DialogButtons
              onCancel={cancelPassword}
              submit={
                <Button
                  type="submit"
                  data-e2e="password-save"
                  busy={pending.password}
                  busyLabel="Updating..."
                >
                  Change password
                </Button>
              }
            />
          </Stack>
        </ScreenForm>
      </Modal>

      {step === TwoFactorStep.Confirm && (
        <Modal
          open
          onClose={() => onCancelTotp?.()}
          title="Turn on two-factor sign-in"
          cancelLabel="Close"
          dataE2E="totp-dialog"
        >
          <ScreenForm
            pending={pending.totp}
            onSubmit={onFinishTotp}
          >
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
              <DialogButtons
                onCancel={() => onCancelTotp?.()}
                submit={
                  <Button
                    type="submit"
                    data-e2e="totp-connect-finish"
                    busy={pending.totp}
                    busyLabel="Turning on..."
                  >
                    Turn on
                  </Button>
                }
              />
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
        <ScreenForm
          pending={pending.totp}
          onSubmit={() => onDisableTotp?.(proof)}
        >
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
            <DialogButtons
              onCancel={cancelDisable}
              submit={
                <Button
                  type="submit"
                  variant="danger"
                  data-e2e="totp-disable-submit"
                  busy={pending.totp}
                  busyLabel="Turning off..."
                >
                  Turn off
                </Button>
              }
            />
          </Stack>
        </ScreenForm>
      </Modal>
    </Stack>
  )
}

/**
 * The names of the providers of an account that has no password ("Google", "Google and GitHub"),
 * or `null` for an account with one, or while the sign-in methods are not known. Changing the
 * e-mail address or the password and deleting the account each ask for the current password, so
 * such an account can do none of them.
 */
export function providerOnlyNames(
  methods: readonly SignInMethod[] | null | undefined,
): string | null {
  if (!methods || methods.length === 0) return null
  if (methods.some((method) => method.kind === "password")) return null
  return methods.map((method) => signInMethodName(method.kind)).join(" and ")
}

/** The address and whether it is proven, or a placeholder while it is not known. */
function EmailValue(
  { email, provider }: { email?: EmailStatus | null; provider: string | null },
): JSX.Element {
  if (!email) return <span>…</span>
  if (email.email === null) {
    return (
      <span>
        {provider === null
          ? "None. You sign in with your username."
          : `None. ${provider} shared no verified address.`}
      </span>
    )
  }
  return (
    <span class="flex flex-col items-start gap-1">
      <span class="flex flex-wrap items-center gap-2">
        <span class="wrap-anywhere">{email.email}</span>
        <Badge
          text={email.proven ? "Verified" : "Not verified"}
          color={email.proven ? "green" : "orange"}
          type="outline"
        />
      </span>
      {provider !== null && (
        <span data-e2e="profile-email-from-provider">
          From{" "}
          {provider}. It cannot be changed here: this account has no password to confirm the change
          with.
        </span>
      )}
    </span>
  )
}

/** Cancel and the form's submit, at the end of a dialog's form. */
function DialogButtons(
  { onCancel, submit }: { onCancel: () => void; submit: JSX.Element },
): JSX.Element {
  return (
    <Cluster justify="end">
      <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      {submit}
    </Cluster>
  )
}

function AddDevice({ onClick, busy }: { onClick: () => void; busy: boolean }): JSX.Element {
  return (
    <Button
      type="button"
      variant="secondary"
      data-e2e="push-register"
      onClick={onClick}
      busy={busy}
      busyLabel="Working..."
    >
      Add this device
    </Button>
  )
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${encodeBase64(new TextEncoder().encode(svg))}`
}
