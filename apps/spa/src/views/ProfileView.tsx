import { useEffect, useState } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import { decodeBase64Url } from "@std/encoding"
import {
  PROFILE_FAILURES,
  type ProfileFieldErrors,
  ProfileScreen,
  type ProfileValues,
  type TotpEnrolment,
} from "@ui/profile-screen.tsx"
import type { AccountDeleteErrors, AccountDeleteValues } from "@ui/account-delete.tsx"
import { SCREEN_PATHS } from "@ui/progressive.tsx"
import { OnboardingView } from "./OnboardingView.tsx"
import { TwoFactorProof } from "@ui/two-factor.ts"
import {
  changePassword,
  deleteAccount,
  endOtherSessions,
  endSession,
  listSessions,
  readAccountDeletionBlockers,
  setPassword,
  totpConnectFinish,
  totpConnectStart,
  totpDisconnect,
} from "../state/auth.ts"
import { sessionState } from "../state/session.ts"
import { emailStore } from "../state/email.ts"
import { apiFetch } from "../state/api.ts"
import { profileStore } from "../state/profile.ts"
import { toasts } from "../state/toasts.ts"
import type { PushSubscribeRequest } from "@spy4x/platform/model"
import { validate } from "@spy4x/validation"
import {
  accountDeleteSchema,
  type AccountDeletionBlocker,
  authOTPSchema,
  authPasswordChangeSchema,
  authPasswordSchema,
  authPasswordSetSchema,
  OAUTH_NOTICE_PARAM,
  OAUTH_NOTICES,
  oauthNotice,
  UserMFAStatus,
  userProfileBaseSchema,
} from "@domain/identity"
import type { PushPublicKeyResponse } from "@domain/identity"
import { SESSIONS_FAILURE } from "@ui/signed-in-devices.tsx"
import { SIGN_IN_METHODS_FAILURE } from "@ui/sign-in-methods.tsx"
import { apiTokensHttp, createApiTokensStore } from "../state/api-tokens.ts"
import { passwordChangedMessage } from "./password-changed-message.ts"
import { isProviderProofFresh } from "./provider-proof-fresh.ts"
import { providerProofOf } from "@ui/provider-proof.tsx"
import { createDevicesStore } from "../state/devices.ts"
import { createSignInMethodsStore } from "../state/sign-in-methods.ts"
import { localReads } from "../modules.ts"
import { groupsStore } from "../state/groups.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { preferencesState } from "../state/preferences.ts"
import { usePreferencesProps } from "./preferences-props.ts"

const NO_DELETE_VALUES: AccountDeleteValues = { password: "", otp: "" }
const NO_DELETE_ERRORS: AccountDeleteErrors = { form: null }
const CODE_MISSING = "Enter the code from your authenticator app"

/**
 * Wires `ProfileScreen` to this app's session store, the auth calls and the push endpoints. Holds
 * what the user types, what is in flight and what failed; the screen only draws it.
 */
export function ProfileView() {
  const [, navigate] = useLocation()
  const search = useSearch()
  const session = sessionState.value
  const preferences = usePreferencesProps()
  const [values, setValues] = useState<ProfileValues>({
    firstName: session.user?.firstName || "",
    lastName: session.user?.lastName || "",
    currentPassword: "",
    newPassword: "",
    passwordOtp: "",
    otp: "",
    totpPassword: "",
    twoFactorProof: "",
  })
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({})
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [totpError, setTotpError] = useState<string | null>(null)
  const [busyProfile, setBusyProfile] = useState(false)
  const [busyPassword, setBusyPassword] = useState(false)
  const [totpBusy, setTotpBusy] = useState(false)
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null)
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [deleteValues, setDeleteValues] = useState(NO_DELETE_VALUES)
  const [deleteErrors, setDeleteErrors] = useState(NO_DELETE_ERRORS)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [blockers, setBlockers] = useState<AccountDeletionBlocker[] | null>(null)
  const [signOutOthers, setSignOutOthers] = useState(true)
  // Both lists are kept on the device and shown, with their time, when the server is unreachable.
  const [devices] = useState(() => createDevicesStore(listSessions, localReads))
  const [devicesBusy, setDevicesBusy] = useState(false)
  const [methods] = useState(() => createSignInMethodsStore())
  const [tokens] = useState(() => createApiTokensStore(apiTokensHttp, localReads))
  const groups = groupsStore.groups.value

  const providerProofFresh = isProviderProofFresh(methods.providerProofUntil.value)
  /** Set when the account has no password: what confirms its deletion in place of one. */
  const providerProof = providerProofOf(methods.methods.value, providerProofFresh)

  /** Reads the signed-in devices again; a failure shows above the list and keeps the old one. */
  const loadDevices = () => devices.load()

  const setValue = (field: keyof ProfileValues, value: string) =>
    setValues((current) => ({ ...current, [field]: value }))

  useEffect(() => {
    setValues((current) => ({
      ...current,
      firstName: session.user?.firstName || "",
      lastName: session.user?.lastName || "",
    }))
  }, [session.user?.firstName, session.user?.lastName])

  useEffect(() => {
    if (!session.user || session.isMfaRequired) return
    // A change made in another tab reaches this page as a hint that runs the same read.
    void profileStore.refresh().catch(() => {})
    apiFetch<PushPublicKeyResponse>("/api/push/public-key").then((res) => {
      if (res.ok) setPushPublicKey(res.data.publicKey)
    })
    void loadDevices()
    void methods.load()
    void tokens.load()
  }, [session.user?.id, session.isMfaRequired])

  // A link started here comes back from the provider with `?oauth=`: say how it ended, once.
  useEffect(() => {
    const notice = oauthNotice(new URLSearchParams(search).get(OAUTH_NOTICE_PARAM))
    if (!notice) return
    const toast = { body: OAUTH_NOTICES[notice], dataE2E: `sign-in-method-${notice}` }
    if (notice === "linked") toasts.success({ title: "Sign-in method linked", ...toast })
    else if (notice === "link-exists") {
      toasts.info({ title: "Sign-in method already linked", ...toast })
    } else toasts.error({ title: "Sign-in method not linked", ...toast })
    navigate(SCREEN_PATHS.profile, { replace: true })
  }, [search])

  /** Unlinks one method. When this device signed in with it, the page reloads signed out. */
  const unlinkMethod = async (methodId: number, password?: string) => {
    const result = await methods.unlink(methodId, password)
    if (result === "signed-out") {
      location.href = SCREEN_PATHS.signIn
      return
    }
    if (result === "failed") return
    // The devices that signed in with it were signed out.
    void loadDevices()
    toasts.success({
      title: "Unlinked",
      body: "The devices that signed in with it were signed out.",
      dataE2E: "sign-in-method-unlinked",
    })
  }

  /** Runs one sign-out of other devices, then reads the list again. */
  const endDevices = async (
    end: () => Promise<{ ok: boolean; error?: string }>,
    body: string,
  ) => {
    devices.error.value = null
    setDevicesBusy(true)
    const result = await end()
    setDevicesBusy(false)
    await loadDevices()
    if (!result.ok) {
      devices.error.value = result.error || SESSIONS_FAILURE
      return
    }
    toasts.success({ title: "Signed out", body, dataE2E: "sessions-ended" })
  }

  /**
   * Checks the values with the schema the API checks them with. Each refused field gets its message
   * under it, and the call is not made; `false` means the form has something to fix.
   */
  const fieldsPass = (problems: ProfileFieldErrors | null): boolean => {
    setFieldErrors(problems ?? {})
    return problems === null
  }

  const submitProfile = async () => {
    setProfileError(null)
    const { firstName, lastName } = values
    if (!fieldsPass(refusedFields(userProfileBaseSchema, { firstName, lastName }))) return
    setBusyProfile(true)
    const result = await profileStore.saveProfile(values.firstName, values.lastName)
    setBusyProfile(false)
    if (!result.ok) {
      setProfileError(result.error || PROFILE_FAILURES.profile)
      return
    }
    toasts.success({ title: "Saved", body: "Your profile was updated.", dataE2E: "profile-saved" })
  }

  const submitPassword = async () => {
    setPasswordError(null)
    const problems = refusedFields(authPasswordChangeSchema, {
      password: values.currentPassword,
      newPassword: values.newPassword,
    })
    // The API calls the current password `password`; the form's field is `currentPassword`.
    const { password: currentPassword, ...rest } = problems ?? {}
    if (!fieldsPass(problems && { currentPassword, ...rest })) return
    setBusyPassword(true)
    const result = await changePassword(values.currentPassword, values.newPassword, signOutOthers)
    setBusyPassword(false)
    if (!result.ok) {
      setPasswordError(result.error || PROFILE_FAILURES.password)
      return
    }
    setValues((current) => ({ ...current, currentPassword: "", newPassword: "" }))
    setSignOutOthers(true)
    // The change ends this device's session too and opens a new one: the list changes either way.
    void loadDevices()
    // The change revoked every API token of the person: the list is read again.
    if (result.revokedTokens) void tokens.load()
    toasts.success({
      title: "Password changed",
      body: passwordChangedMessage(signOutOthers, result.revokedTokens ?? 0),
      dataE2E: "password-saved",
    })
  }

  /** The first password of an account that has none. The list of sign-in methods gains it. */
  const submitFirstPassword = async () => {
    setPasswordError(null)
    // With two-factor on the server asks for the code too; the dialog shows its field then.
    const twoFactor = session.user?.mfa === UserMFAStatus.CONFIGURED
    const problems: ProfileFieldErrors = {
      ...refusedFields(authPasswordSetSchema, { newPassword: values.newPassword }),
    }
    if (twoFactor && !/^[0-9]{6}$/.test(values.passwordOtp)) problems.passwordOtp = CODE_MISSING
    if (!fieldsPass(Object.keys(problems).length > 0 ? problems : null)) return
    setBusyPassword(true)
    const result = await setPassword(
      values.newPassword,
      twoFactor ? values.passwordOtp : undefined,
    )
    setBusyPassword(false)
    // Read again either way: a refusal may mean the provider sign-in is no longer recent.
    await methods.load()
    if (!result.ok) {
      setPasswordError(result.error || PROFILE_FAILURES.passwordSet)
      return
    }
    setValues((current) => ({ ...current, newPassword: "", passwordOtp: "" }))
    toasts.success({
      title: "Password set",
      body: "You can now sign in with your e-mail address and this password too.",
      dataE2E: "password-set",
    })
  }

  /**
   * Starts the set-up after the "Turn on" dialog: with the password, or for an account with none
   * after its provider sign-in a moment ago, as the deletion asks (#406).
   */
  const startTotp = async () => {
    setTotpError(null)
    const password = providerProof ? undefined : values.totpPassword
    if (password !== undefined) {
      const problem = refusedFields(authPasswordSchema, { password })?.password
      if (!fieldsPass(problem ? { totpPassword: problem } : null)) return
    }
    setTotpBusy(true)
    const result = await totpConnectStart(password)
    setTotpBusy(false)
    if (!result.ok) {
      setTotpError(result.error)
      // A refusal may mean the provider sign-in is no longer recent: the dialog then says so.
      if (providerProof) void methods.load()
      return
    }
    setValue("totpPassword", "")
    setEnrolment({ qrcode: result.qrcode, secret: result.secret })
  }

  const finishTotp = async () => {
    setTotpError(null)
    if (!fieldsPass(refusedFields(authOTPSchema, { otp: values.otp }))) return
    setTotpBusy(true)
    const result = await totpConnectFinish(values.otp)
    setTotpBusy(false)
    if (!result.ok) {
      setTotpError(result.error || PROFILE_FAILURES.totpFinish)
      return
    }
    setEnrolment(null)
    setValue("otp", "")
  }

  const disableTotp = async (proof: TwoFactorProof) => {
    setTotpError(null)
    const typed = values.twoFactorProof
    // The API calls them `password` and `otp`; the dialog has one field for either.
    const problems = proof === TwoFactorProof.Code
      ? refusedFields(authOTPSchema, { otp: typed })?.otp
      : refusedFields(authPasswordSchema, { password: typed })?.password
    if (!fieldsPass(problems ? { twoFactorProof: problems } : null)) return
    setTotpBusy(true)
    const result = await totpDisconnect(
      proof === TwoFactorProof.Code ? { otp: typed } : { password: typed },
    )
    setTotpBusy(false)
    if (!result.ok) {
      setTotpError(result.error || PROFILE_FAILURES.totpDisable)
      return
    }
    setValue("twoFactorProof", "")
  }

  const registerPush = async () => {
    if (!pushPublicKey) return
    setPushError(null)
    setPushBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(pushPublicKey),
      })
      const result = await profileStore.registerPush(
        uuidV7(),
        subscriptionToPayload(subscription),
      )
      if (!result.ok) setPushError(result.error || PROFILE_FAILURES.push)
    } catch (_error) {
      setPushError(PROFILE_FAILURES.push)
    } finally {
      setPushBusy(false)
    }
  }

  const removePush = async (deviceId: string) => {
    setPushError(null)
    setPushBusy(true)
    const result = await profileStore.removePush(deviceId)
    setPushBusy(false)
    if (!result.ok) setPushError(result.error || PROFILE_FAILURES.push)
  }

  /** Reads the groups that stop the deletion; a failed read shows the form, which checks again. */
  const loadBlockers = async () => {
    setBlockers(null)
    const result = await readAccountDeletionBlockers()
    setBlockers(result.ok ? result.blockers : [])
    if (!result.ok) setDeleteErrors({ form: result.error })
  }

  const submitDelete = async () => {
    const twoFactor = session.user?.mfa === UserMFAStatus.CONFIGURED
    const { otp } = deleteValues
    // An account with no password sends none: its provider sign-in a moment ago confirms it.
    const password = providerProof ? undefined : deleteValues.password
    // Left out, not `undefined`: the schema takes a missing password and refuses an empty one.
    const problems = refusedFields(accountDeleteSchema, {
      ...(password === undefined ? {} : { password }),
      ...(twoFactor && otp !== "" ? { otp } : {}),
    })
    const otpMissing = twoFactor && otp === ""
    if (problems || otpMissing) {
      setDeleteErrors({
        form: null,
        password: problems?.password,
        otp: otpMissing ? CODE_MISSING : problems?.otp,
      })
      return
    }
    setDeleteErrors(NO_DELETE_ERRORS)
    setDeleteBusy(true)
    const result = await deleteAccount(password, twoFactor ? otp : undefined)
    setDeleteBusy(false)
    if (!result.ok) {
      if (result.blocked) await loadBlockers()
      else {
        setDeleteErrors({ form: result.error })
        // A refusal may mean the provider sign-in is no longer recent: the dialog then says so.
        if (providerProof) void methods.load()
      }
      return
    }
    navigate(SCREEN_PATHS.signIn, { replace: true })
    toasts.success({
      title: "Account deleted",
      body: `It goes for good on ${
        preferencesState.format.value.date(result.deleteAfter, "long")
      }. Sign in before then to keep it.`,
      dataE2E: "account-deleted",
    })
  }

  return (
    <ProfileScreen
      user={session.user}
      // The first steps show on the home page, where a new account lands, under its header.
      onboarding={<OnboardingView />}
      onSetPassword={submitFirstPassword}
      providerProofFresh={providerProofFresh}
      isMfaRequired={session.isMfaRequired}
      email={emailStore.status.value}
      values={values}
      onValueChange={setValue}
      errors={{
        fields: fieldErrors,
        profile: profileError,
        password: passwordError,
        totp: totpError,
        push: pushError,
      }}
      pending={{ profile: busyProfile, password: busyPassword, totp: totpBusy, push: pushBusy }}
      enrolment={enrolment}
      pushDevices={profileStore.pushDevices.value}
      onSaveProfile={submitProfile}
      onCancelProfile={() => {
        setProfileError(null)
        setFieldErrors(({ firstName: _first, lastName: _last, ...rest }) => rest)
        setValues((current) => ({
          ...current,
          firstName: session.user?.firstName || "",
          lastName: session.user?.lastName || "",
        }))
      }}
      onChangePassword={submitPassword}
      onCancelPassword={() => {
        setPasswordError(null)
        setFieldErrors(({ currentPassword: _current, newPassword: _new, ...rest }) => rest)
        setValues((current) => ({ ...current, currentPassword: "", newPassword: "" }))
        setSignOutOthers(true)
      }}
      signOutOthers={signOutOthers}
      onSignOutOthersChange={setSignOutOthers}
      preferences={preferences}
      methods={{
        methods: methods.methods.value,
        available: methods.available.value,
        pending: methods.pending.value,
        error: methods.error.value === "" ? SIGN_IN_METHODS_FAILURE : methods.error.value,
        loadError: methods.loadError.value,
        loading: methods.loading.value,
        onRetry: () => void methods.load(),
        onLink: (provider, password) => void methods.link(provider, password),
        onUnlink: (id, password) => void unlinkMethod(id, password),
      }}
      devices={{
        sessions: devices.sessions.value,
        pending: devicesBusy,
        error: devices.error.value === "" ? SESSIONS_FAILURE : devices.error.value,
        savedAt: devices.savedAt.value,
        onEnd: (id) => void endDevices(() => endSession(id), "That device was signed out."),
        onEndOthers: () => void endDevices(endOtherSessions, "Every other device was signed out."),
      }}
      apiTokens={{
        tokens: tokens.tokens.value,
        savedAt: tokens.savedAt.value,
        // While the groups are read the opener shows: the create page says when there is none.
        canCreate: groups.length > 0 || groupsStore.loading.value,
        error: tokens.errors.value.list,
        revoking: tokens.pending.value.revoke,
        navigate,
        onRevoke: (id) =>
          void tokens.revoke(id).then((revoked) => {
            if (revoked) {
              toasts.success({
                title: "Revoked",
                body: "That token no longer works.",
                dataE2E: "api-token-revoked",
              })
            }
          }),
      }}
      onStartTotp={startTotp}
      onCancelStartTotp={() => {
        setTotpError(null)
        setFieldErrors(({ totpPassword: _password, ...rest }) => rest)
        setValue("totpPassword", "")
      }}
      onFinishTotp={finishTotp}
      onCancelTotp={() => {
        setEnrolment(null)
        setTotpError(null)
        setValue("otp", "")
      }}
      onDisableTotp={disableTotp}
      onCancelDisableTotp={() => {
        setTotpError(null)
        setFieldErrors(({ twoFactorProof: _proof, ...rest }) => rest)
        setValue("twoFactorProof", "")
      }}
      onRegisterPush={registerPush}
      onRemovePush={removePush}
      accountDeletion={{
        blockers,
        values: deleteValues,
        onValueChange: (field, value) =>
          setDeleteValues((current) => ({ ...current, [field]: value })),
        errors: deleteErrors,
        pending: deleteBusy,
        onOpen: () => void loadBlockers(),
        onCancel: () => {
          setDeleteValues(NO_DELETE_VALUES)
          setDeleteErrors(NO_DELETE_ERRORS)
        },
        onDelete: () => void submitDelete(),
      }}
      navigate={navigate}
    />
  )
}

/**
 * The first message of each field `schema` refuses in `value`, keyed by the field's name, or `null`
 * when the value passes.
 */
function refusedFields(
  schema: Parameters<typeof validate>[0],
  value: unknown,
): Record<string, string> | null {
  const { error } = validate(schema, value)
  if (!error) return null
  const fields: Record<string, string> = {}
  for (const [field, issues] of Object.entries(error.errors)) {
    if (issues?.[0]) fields[field] = issues[0].message
  }
  return fields
}

function subscriptionToPayload(
  subscription: PushSubscription,
): PushSubscribeRequest["subscription"] {
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.auth || !json.keys?.p256dh) {
    throw new Error("Invalid push subscription")
  }
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      auth: json.keys.auth,
      p256dh: json.keys.p256dh,
    },
  }
}
