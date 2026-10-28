import type { JSX } from "preact"
import { IconLockClosed } from "@spy4x/preact-icons"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Button } from "@spy4x/preact-ui/button"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { Cluster } from "@spy4x/preact-ui/layout"
import { SettingsLayout, type SettingsSection } from "@spy4x/preact-system/settings-layout"
import { SettingGroup } from "@spy4x/preact-ui/setting-row"
import {
  type EmailStatus,
  type SignInMethod,
  UserMFAStatus,
  type UserPushTokenPublic,
} from "@domain/identity"
import { AccountDelete, type AccountDeleteProps } from "./account-delete.tsx"
import { ApiTokens, type ApiTokensProps } from "./api-tokens.tsx"
import type { EmailChangeProps } from "./email-screen.tsx"
import {
  GuestAccountDelete,
  type GuestAccountDeleteProps,
  GuestAccountRow,
  GuestSignInMethods,
} from "./guest-profile.tsx"
import {
  AppearanceSection,
  type PreferencesProps,
  RegionSection,
  themeName,
} from "./preferences.tsx"
import type { PictureRowProps } from "./profile-picture.tsx"
import { AccountSection } from "./profile-account.tsx"
import type { DataExportRowProps } from "./profile-export.tsx"
import { PushDevicesSection } from "./profile-notifications.tsx"
import { TelegramLink, type TelegramLinkProps } from "./profile-telegram.tsx"
import { SecuritySection } from "./profile-security.tsx"
import {
  type Navigate,
  PROFILE_SECTIONS,
  profilePath,
  type ProfileSectionId,
  SCREEN_PATHS,
} from "./progressive.tsx"
import { type ProviderProof, providerProofOf } from "./provider-proof.tsx"
import { SignedInDevices, type SignedInDevicesProps } from "./signed-in-devices.tsx"
import { signInMethodName, type SignInMethodsProps } from "./sign-in-methods.tsx"
import type { TwoFactorProof } from "./two-factor.ts"
import { useAppText } from "./i18n.ts"
import type { Translator } from "@spy4x/platform/universal/i18n"

/** The messages shown when an action failed without one of its own, by their keys in `app`. */
export const PROFILE_FAILURES = {
  profile: `ProfileScreen.profileFailed`,
  password: `ProfileScreen.passwordFailed`,
  passwordSet: `ProfileScreen.passwordSetFailed`,
  totpFinish: `ProfileScreen.totpFinishFailed`,
  totpDisable: `ProfileScreen.totpDisableFailed`,
  push: `ProfileScreen.pushFailed`,
  pushRemove: `ProfileScreen.pushRemoveFailed`,
} as const

/** What the user has typed into the profile forms. */
export interface ProfileValues {
  firstName: string
  lastName: string
  currentPassword: string
  newPassword: string
  /** The authenticator code a first password needs while two-factor is on. */
  passwordOtp: string
  otp: string
  /** The password typed to turn two-factor on (#406). */
  totpPassword: string
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

/** Each section's name in the navigation, and the line under its heading, by their keys in `app`. */
export const PROFILE_SECTION_TEXT: Record<
  ProfileSectionId,
  { label: string; description: string }
> = {
  account: { label: `ProfileScreen.account`, description: `ProfileScreen.accountText` },
  security: { label: `ProfileScreen.security`, description: `ProfileScreen.securityText` },
  region: { label: `ProfileScreen.region`, description: `ProfileScreen.regionText` },
  appearance: { label: `ProfileScreen.appearance`, description: `ProfileScreen.appearanceText` },
  notifications: {
    label: `ProfileScreen.notifications`,
    description: `ProfileScreen.notificationsText`,
  },
  "api-tokens": { label: `ProfileScreen.apiTokens`, description: `ProfileScreen.apiTokensText` },
  "danger-zone": { label: `ProfileScreen.dangerZone`, description: `ProfileScreen.dangerZoneText` },
}

export interface ProfileScreenProps {
  /** The open section, or `null` on `/profile` itself: the list on a phone. */
  section: ProfileSectionId | null
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
  /** The e-mail dialog's state and calls (Account). Without it the address has no button. */
  emailChange?: EmailChangeProps
  /** Opens the e-mail dialog at its code, whenever this turns true while an address waits for one. */
  openEmailCode?: boolean
  /** Given only when the address could not be read: Account shows the failure and a retry. */
  onRetryEmail?: () => void
  onChangePassword?: () => void
  /**
   * Called when an account with no password submits its first one, which `values.newPassword`
   * holds. The same dialog asks for it, without "Current password".
   */
  onSetPassword?: () => void
  /**
   * This device signed in with Google or GitHub a moment ago, which an account with no password
   * confirms a first password, two-factor sign-in and its deletion with.
   */
  providerProofFresh?: boolean
  /**
   * The proof an account with no password gives, as the app built it, with its passkey button
   * (`onPasskey`) when it has one. Left out, the screen builds it from `methods` and
   * `providerProofFresh`, without that button.
   */
  providerProof?: ProviderProof | null
  /** Drops what was typed in the password dialog and its errors, when the person closes it. */
  onCancelPassword?: () => void
  /** Whether the password change also signs out every other device. */
  signOutOthers?: boolean
  /**
   * Called when the person ticks or clears "Sign out of all other devices" in the password dialog.
   * Without it the dialog has no such box.
   */
  onSignOutOthersChange?: (signOutOthers: boolean) => void
  /** "Ways to sign in" (Sign-in and security). Without it the password has a row alone. */
  methods?: SignInMethodsProps
  /** "Signed-in devices" (Sign-in and security). Without it the section has none. */
  devices?: SignedInDevicesProps
  /** The API tokens section's list. Without it the section is empty. */
  apiTokens?: ApiTokensProps
  /** The region and appearance settings. Without them those sections are empty. */
  preferences?: PreferencesProps
  /**
   * Called when the person submits the "Turn on" dialog, with the password in
   * `values.totpPassword`; an account with no password confirms with a provider sign-in a moment
   * ago instead, as the deletion does (#406).
   */
  onStartTotp?: () => void
  /** Drops what was typed in the "Turn on" dialog and its errors, when the person closes it. */
  onCancelStartTotp?: () => void
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
  /** Telegram (#269), under Notifications. Without it, or while the bot is off, no row shows. */
  telegram?: TelegramLinkProps
  /**
   * The "Delete account" section. Without it the section is empty. `twoFactor` and `navigate`
   * come from this screen's own props.
   */
  accountDeletion?: Omit<AccountDeleteProps, "twoFactor" | "navigate" | "providerProof">
  /**
   * Set for a guest account (#224), which has no sign-in method: the Profile says so with a way to
   * keep it, shows no password or two-factor rows, and deletes with a typed word.
   */
  guest?: GuestAccountDeleteProps
  /** The Account section's "Your data" row (#229). Without it the row is left out. */
  dataExport?: DataExportRowProps
  /** The Account section's "Profile picture" row (#228); its `src` is the intro's avatar too. */
  picture?: PictureRowProps
  navigate?: Navigate
}

/**
 * The profile, split into sections at `/profile/<section>` (#327): a navigation beside the open
 * section from `md` up, and on a phone the list of sections first, then one section under a link
 * back to it. Account holds the name and the e-mail address; Sign-in and security the ways to
 * sign in, two-factor sign-in and the signed-in devices; then Language and region, Appearance,
 * Notifications, API tokens, and Delete account last. Each section is its own screen; this one
 * picks the open one and draws the frame around it.
 */
export function ProfileScreen(props: ProfileScreenProps): JSX.Element {
  const { section, user, isMfaRequired, email = null, methods, navigate } = props
  const t = useAppText()

  if (isMfaRequired) {
    return (
      <EmptyState
        icon={<IconLockClosed class="size-6" />}
        title={t.t(`ProfileScreen.codeTitle`)}
        headingLevel={1}
        description={t.t(`ProfileScreen.codeText`)}
        action={
          <Button href={SCREEN_PATHS.oneTimeCode} navigate={navigate}>
            {t.t(`EmailScreen.enterCode`)}
          </Button>
        }
      />
    )
  }

  if (!user) {
    return (
      <div data-e2e="signin-required">
        <EmptyState
          icon={<IconLockClosed class="size-6" />}
          title={t.t(`ProfileScreen.signInTitle`)}
          headingLevel={1}
          description={t.t(`ProfileScreen.signInText`)}
          action={
            <Cluster justify="center">
              <Button href={SCREEN_PATHS.signIn} navigate={navigate}>
                {t.t(`PasswordResetScreen.signIn`)}
              </Button>
              <Button href={SCREEN_PATHS.signUp} navigate={navigate} variant="outline">
                {t.t(`ProfileScreen.createAccount`)}
              </Button>
            </Cluster>
          }
        />
      </div>
    )
  }

  const name = `${user.firstName} ${user.lastName}`.trim()
  const providerOnly = providerOnlyNames(t, methods?.methods, methods?.emailLink)
  const providerProof = props.providerProof !== undefined
    ? props.providerProof
    : providerProofOf(methods?.methods, props.providerProofFresh ?? false, methods?.emailLink)
  const twoFactorOn = user.mfa === UserMFAStatus.CONFIGURED
  const sections: SettingsSection[] = PROFILE_SECTIONS.map((id) => ({
    id,
    label: t.t(PROFILE_SECTION_TEXT[id].label),
    description: t.t(PROFILE_SECTION_TEXT[id].description),
    href: profilePath(id),
    tone: id === "danger-zone" ? "danger" : undefined,
    // A guest has no two-factor to turn on (#224).
    value: id === "security"
      ? props.guest
        ? undefined
        : t.t(twoFactorOn ? `ProfileScreen.twoFactorOn` : `ProfileScreen.twoFactorOff`)
      : id === "appearance" && props.preferences
      ? themeName(t, props.preferences.value.theme)
      : undefined,
  }))

  return (
    <SettingsLayout
      title={t.t(`ProfileScreen.title`)}
      href={SCREEN_PATHS.profile}
      sections={sections}
      current={section}
      defaultSection="account"
      navigate={navigate}
      intro={
        <div class="flex min-w-0 items-center gap-3" data-e2e="profile-intro">
          <Avatar name={name || email?.email} src={props.picture?.src} size="md" alt="" />
          <div class="flex min-w-0 flex-col">
            {name
              ? (
                <span class="truncate text-sm font-medium text-foreground" translate={false}>
                  {name}
                </span>
              )
              : (
                <span class="truncate text-sm font-medium text-foreground">
                  {t.t(`ProfileScreen.noName`)}
                </span>
              )}
            {email?.email && (
              <span class="truncate text-sm text-muted" translate={false}>{email.email}</span>
            )}
          </div>
        </div>
      }
    >
      {
        /* On `/profile` the layout shows Account, with its heading, beside the list from `md` up
        and hides it on a phone, where the list is the page. */
      }
      <ProfileSection
        {...props}
        section={section ?? "account"}
        user={user}
        name={name}
        providerOnly={providerOnly}
        providerProof={providerProof}
      />
    </SettingsLayout>
  )
}

/** The open section's content. */
function ProfileSection(
  props: ProfileScreenProps & {
    section: ProfileSectionId
    user: NonNullable<ProfileScreenProps["user"]>
    name: string
    providerOnly: string | null
    providerProof: ProviderProof | null
  },
): JSX.Element | null {
  const { section, user, values, errors, pending, providerOnly, providerProof } = props
  const t = useAppText()
  switch (section) {
    case "account":
      return (
        <AccountSection
          name={props.name}
          nameEdit={{
            firstName: values.firstName,
            lastName: values.lastName,
            onValueChange: props.onValueChange,
            fieldErrors: errors.fields,
            error: errors.profile,
            pending: pending.profile,
            onSave: props.onSaveProfile,
            onCancel: props.onCancelProfile,
          }}
          email={props.email ?? null}
          providerOnly={providerOnly === null ? null : providerOnlyNames(
            t,
            props.methods?.methods?.filter((method) => method.kind !== "passkey"),
            props.methods?.emailLink,
          ) ?? ""}
          emailChange={props.emailChange}
          openEmailCode={props.openEmailCode}
          onRetryEmail={props.onRetryEmail}
          providerProof={providerProof}
          guestRow={props.guest && <GuestAccountRow navigate={props.navigate} />}
          dataExport={props.dataExport}
          picture={props.picture}
        />
      )
    case "security":
      // A guest has no password, two-factor or method to list: one way to keep the account, then
      // the signed-in devices.
      if (props.guest) {
        return (
          <>
            <GuestSignInMethods navigate={props.navigate} />
            {props.devices && <SignedInDevices {...props.devices} />}
          </>
        )
      }
      return (
        <SecuritySection
          mfa={user.mfa}
          values={values}
          onValueChange={props.onValueChange}
          errors={errors}
          pending={pending}
          enrolment={props.enrolment}
          providerOnly={providerOnly}
          providerProof={providerProof}
          onChangePassword={props.onChangePassword}
          onSetPassword={props.onSetPassword}
          onCancelPassword={props.onCancelPassword}
          signOutOthers={props.signOutOthers ?? true}
          onSignOutOthersChange={props.onSignOutOthersChange}
          methods={props.methods}
          devices={props.devices}
          onStartTotp={props.onStartTotp}
          onCancelStartTotp={props.onCancelStartTotp}
          onFinishTotp={props.onFinishTotp}
          onCancelTotp={props.onCancelTotp}
          onDisableTotp={props.onDisableTotp}
          onCancelDisableTotp={props.onCancelDisableTotp}
        />
      )
    case "region":
      return props.preferences ? <RegionSection {...props.preferences} /> : null
    case "appearance":
      return props.preferences ? <AppearanceSection {...props.preferences} /> : null
    case "notifications":
      return (
        <>
          <SettingGroup
            title={t.t(`ProfileScreen.push`)}
            description={t.t(`ProfileScreen.pushText`)}
          >
            <PushDevicesSection
              devices={props.pushDevices}
              error={errors.push}
              pending={pending.push}
              onRegister={props.onRegisterPush}
              onRemove={props.onRemovePush}
            />
          </SettingGroup>
          {props.telegram && <TelegramLink {...props.telegram} />}
        </>
      )
    case "api-tokens":
      return props.apiTokens ? <ApiTokens {...props.apiTokens} /> : null
    case "danger-zone":
      if (props.guest) return <GuestAccountDelete {...props.guest} />
      return props.accountDeletion
        ? (
          <AccountDelete
            {...props.accountDeletion}
            twoFactor={user.mfa === UserMFAStatus.CONFIGURED}
            providerProof={providerProof}
            navigate={props.navigate}
          />
        )
        : null
  }
}

/**
 * The ways in of an account that has no password ("Google", "Google and GitHub", "a passkey"),
 * or `null` for an account with one, or while the sign-in methods are not known. An account with
 * no linked method signs in with "a sign-in link" when `emailLink` says one reaches it (#391).
 */
export function providerOnlyNames(
  t: Translator<string>,
  methods: readonly SignInMethod[] | null | undefined,
  emailLink = false,
): string | null {
  if (!methods) return null
  if (methods.length === 0) return emailLink ? t.t(`ProviderProof.link`) : null
  if (methods.some((method) => method.kind === "password")) return null
  const passkeys = methods.filter((method) => method.kind === "passkey").length
  return new Intl.ListFormat(t.language, { type: `conjunction` }).format([
    ...methods.flatMap((method) =>
      method.kind === "passkey" ? [] : [signInMethodName(t, method.kind)]
    ),
    ...(passkeys === 0 ? [] : [t.t(`ProfileScreen.passkeys`, { count: passkeys })]),
  ])
}
