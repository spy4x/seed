import { type } from "arktype"
import { BaseModelSchema, dateSchema, PUSH_SUBSCRIPTION_LIMITS } from "@spy4x/platform/model"
import type { SecondFactorStatus } from "@spy4x/server/sign-in"
import {
  hasUnsafeTextCharacters,
  hasUnstorableTextCharacters,
} from "@spy4x/platform/universal/text"
import type { AdminUserPreferences } from "./preferences.ts"
import type { GuestStats } from "./guests.ts"
import { parseSort, serializeSort, type SortRule } from "@spy4x/platform/universal/sort"

// Not in @spy4x/platform/model: too template-specific (a user's name length limit) to belong in a
// general-purpose package. Moved here from the deleted libs/platform/types/+index.ts.
export const NAME_MAX_LENGTH = 50

export enum UserRole {
  VIEWER = 1,
  OPERATOR = 2,
  SUPERVISOR = 3,
  ADMIN = 4,
}
/** Every role's number. `Object.values` of a numeric enum also holds its names, left out here. */
export const userRoleValues = Object.values(UserRole).filter((value) =>
  typeof value === "number"
) as UserRole[]

/** What each role is called on a page and on the command line. */
export const USER_ROLE_NAMES: Record<UserRole, string> = {
  [UserRole.VIEWER]: "viewer",
  [UserRole.OPERATOR]: "operator",
  [UserRole.SUPERVISOR]: "supervisor",
  [UserRole.ADMIN]: "administrator",
}

/** The role named `name` (`operator`), or `null` for a name no role has. */
export function userRoleNamed(name: string): UserRole | null {
  const wanted = name.trim().toLowerCase()
  return userRoleValues.find((role) => USER_ROLE_NAMES[role] === wanted) ?? null
}

export enum UserMFAStatus {
  NOT_CONFIGURED = 1,
  CONFIGURATION_NOT_FINISHED = 2,
  CONFIGURED = 3,
}
export const userMFAStatusValues = Object.values(
  UserMFAStatus,
) as UserMFAStatus[]

export const userBaseSchema = type({
  firstName: `string <= ${NAME_MAX_LENGTH} = ''`,
  lastName: `string <= ${NAME_MAX_LENGTH} = ''`,
  lastLoginAt: dateSchema.default(() => new Date()),
  mfa: type.enumerated(...userMFAStatusValues).default(
    UserMFAStatus.NOT_CONFIGURED,
  ),
  role: type.enumerated(...userRoleValues).default(UserRole.VIEWER),
  /**
   * When an operator blocked the person (#146), or `null`. Optional because only the row read from
   * Postgres carries it: nothing a client sends sets it.
   */
  "blockedAt?": "Date | null",
  /**
   * When the guest account was made (#224), or `null` for an account with a sign-in method, which
   * includes a guest who kept the account. Optional for the same reason as `blockedAt`.
   */
  "guestSince?": "Date | null",
  /**
   * The person's profile picture (#228, `pictureUrl`), or `null` for none. Optional for the same
   * reason as `blockedAt`: only `picture.confirm` and `picture.remove` set it.
   */
  "pictureId?": "string | null",
  /** Where that picture stands (#464, `PictureState`), or `null` for none. Optional likewise. */
  "pictureState?": "1 | 2 | 3 | null",
})
export type UserBase = typeof userBaseSchema.infer

export const userSchema = BaseModelSchema.and(userBaseSchema)
export type User = typeof userSchema.infer

export const userUpdateSchema = userBaseSchema.pick("firstName", "lastName")
export type UserUpdate = typeof userUpdateSchema.infer

/**
 * One part of a person's name as the profile form sends it: 1 to {@link NAME_MAX_LENGTH}
 * characters, none of them one Postgres cannot store (NUL, half of a surrogate pair), which would
 * answer 500 instead of 400.
 */
const profileName = type(`1 <= string <= ${NAME_MAX_LENGTH}`).narrow((value, ctx) =>
  !hasUnstorableTextCharacters(value) || ctx.mustBe("free of NUL and broken characters")
)

/** The body of a profile edit, over REST and the socket: the only request that writes the names. */
export const userProfileBaseSchema = type({
  firstName: profileName,
  lastName: profileName,
})
export type UserProfileBase = typeof userProfileBaseSchema.infer

// A plain ASCII-digit regex, not `string.numeric`: arktype's `numeric` keyword accepts only a
// well-formed number string, and a well-formed number has no leading zero, so any code starting
// with `0` (about one TOTP code in ten) was refused with a 400 before verification. See
// spy4x/template#27.
export const authOTPSchema = type({
  otp: "/^[0-9]{6}$/",
})
export type AuthOTP = typeof authOTPSchema.infer

/**
 * Longest address a form accepts before the server normalises it: the 254 characters
 * `normalizeEmail` (`@spy4x/server/auth`) allows, with room for the spaces it trims.
 */
export const EMAIL_INPUT_MAX_LENGTH = 320

/** An e-mail address as typed. The server normalises it with `normalizeEmail` and refuses junk. */
export const authEmailSchema = type({
  email: `string <= ${EMAIL_INPUT_MAX_LENGTH}`,
})
export type AuthEmail = typeof authEmailSchema.infer

/**
 * What a person signs in with: an e-mail address, or the username of an account made before
 * sign-up took addresses.
 */
export const authLoginSchema = type({
  login: `string <= ${EMAIL_INPUT_MAX_LENGTH}`,
})
export type AuthLogin = typeof authLoginSchema.infer

export const authPasswordSchema = type({
  password: "8 <= string <= 50",
})
export type AuthPassword = typeof authPasswordSchema.infer

/**
 * The language of the page that asks for a mail (#277): a sign-up code or a sign-in link, sent
 * before the server knows whose account the address is. Any short tag is accepted, so an app
 * that offers a language the server does not yet know still signs up; the server keeps only one
 * of {@link LANGUAGES}, and English otherwise.
 */
const mailLanguageSchema = type({ "language?": "string <= 35" })

/** The body of sign-up. */
export const authSignUpSchema = authEmailSchema.and(authPasswordSchema).and(mailLanguageSchema)
export type AuthSignUp = typeof authSignUpSchema.infer

/** The body of sign-in. */
export const authSignInSchema = authLoginSchema.and(authPasswordSchema)
export type AuthSignIn = typeof authSignInSchema.infer

/** The body of "forgot password": the address the reset link goes to. */
export const authPasswordForgotSchema = authEmailSchema
export type AuthPasswordForgot = typeof authPasswordForgotSchema.infer

/** The body of a password reset: the address and code from the link, and the new password. */
export const authPasswordResetSchema = authEmailSchema.and({
  code: "string <= 128",
  newPassword: "8 <= string <= 50",
})
export type AuthPasswordReset = typeof authPasswordResetSchema.infer

/** The body that proves an address: the code from the mail, as typed. */
export const authEmailCodeSchema = type({
  code: "string <= 64",
})
export type AuthEmailCode = typeof authEmailCodeSchema.infer

/**
 * The body of an address change: the new address and the current password. An account with no
 * password sends none: a sign-in with its provider a moment ago confirms the change instead
 * ({@link PROVIDER_PROOF_MINUTES}).
 */
export const authEmailChangeSchema = authEmailSchema.and({
  "password?": authPasswordSchema.get("password"),
})
export type AuthEmailChange = typeof authEmailChangeSchema.infer

/** Where the signed-in person's e-mail address stands (`GET /api/auth/email`). */
export interface EmailStatus {
  /** The address the account signs in with; `null` for an account made with a username. */
  email: string | null
  /** Whether a code proved `email`. */
  proven: boolean
  /** A new address waiting for its code; the account keeps `email` until it is proven. */
  pending: string | null
}

/**
 * The address a code proves now: the pending new one, else the current one while it is unproven.
 * `null` when there is nothing to prove.
 */
export function emailToVerify(status: EmailStatus): string | null {
  if (status.pending !== null) return status.pending
  return status.email !== null && !status.proven ? status.email : null
}

/** The first steps of a new account, each `true` once the person's own data says it is done. */
export interface OnboardingSteps {
  /** A code proved the address the account signs in with. */
  emailVerified: boolean
  /** The person wrote a note themselves; the welcome note a new account starts with does not count. */
  noteCreated: boolean
  /** The person invited someone to a group. */
  memberInvited: boolean
  /** A browser of the person is registered for push notifications. */
  notificationsOn: boolean
  /** An authenticator app is set up. */
  twoFactorOn: boolean
}

/** What the SPA's first-steps checklist and tour show (`onboarding.get`). Kept per person. */
export interface OnboardingStatus {
  steps: OnboardingSteps
  /** The person closed the checklist; it stays closed on every device. */
  dismissed: boolean
  /** The person finished or skipped the tour; it is not offered again on any device. */
  tourSeen: boolean
}

/** The two answers a person gives once: closing the checklist, and ending the tour. */
export type OnboardingMark = "dismissed" | "tourSeen"

export const authPasswordChangeSchema = authPasswordSchema.and({
  newPassword: "8 <= string <= 50",
  /** Ends every other session of the person once the password changed. Left out means `true`. */
  "signOutOthers?": "boolean",
})
export type AuthPasswordChange = typeof authPasswordChangeSchema.infer

/**
 * Minutes after a sign-in with Google or GitHub during which that session confirms a step that
 * otherwise asks for the password. It proves the browser is signed in to the provider, not who sits
 * at it (#204). Deleting the account, setting a first password and changing the address each ask
 * for it when the account has no password.
 */
export const PROVIDER_PROOF_MINUTES = 5

/**
 * The body of "set a password" for an account that has none: the first password. `otp` is the
 * authenticator code, which an account with two-factor on must send too: the password could
 * otherwise turn two-factor off.
 */
export const authPasswordSetSchema = type({
  newPassword: "8 <= string <= 50",
  "otp?": "/^[0-9]{6}$/",
})
export type AuthPasswordSet = typeof authPasswordSetSchema.infer

/**
 * The body of "link a provider", of "unlink a sign-in method" and of "turn two-factor on". An
 * account with a password sends it; one without has signed in with a provider it already has a
 * moment ago instead ({@link PROVIDER_PROOF_MINUTES}).
 */
export const signInMethodProofSchema = type({
  "password?": authPasswordSchema.get("password"),
})
export type SignInMethodProof = typeof signInMethodProofSchema.infer

/** Days a deleted account waits before it is removed for good. Signing in before then restores it. */
export const ACCOUNT_DELETION_GRACE_DAYS = 7

/**
 * The body of "turn two-factor off": the account's password, or a current authenticator code. A
 * session alone is not enough, since one left open on a shared machine could remove the second
 * factor. An account with no password sends the code.
 */
export const authTotpDisconnectSchema = type({
  "password?": authPasswordSchema.get("password"),
  "otp?": authOTPSchema.get("otp"),
})
export type AuthTotpDisconnect = typeof authTotpDisconnectSchema.infer

/**
 * The body of "delete my account": the password, and an authenticator code when two-factor is on.
 * An account with no password sends none: a sign-in with its provider a moment ago confirms the
 * deletion instead ({@link PROVIDER_PROOF_MINUTES}).
 */
export const accountDeleteSchema = type({
  "password?": authPasswordSchema.get("password"),
  "otp?": "/^[0-9]{6}$/",
})
export type AccountDelete = typeof accountDeleteSchema.infer

/** Why a group stops its owner from deleting their account. */
export enum AccountDeletionBlockReason {
  /** Other people are still members: hand the group over or remove them first. */
  Members = 1,
  /** Its subscription is not cancelled: cancel it first, or the provider keeps charging. */
  Subscription = 2,
  /** Its subscription is cancelled but runs until the end of the paid period: wait for that. */
  PlanEnding = 3,
}

/** A group the person owns that must be dealt with before their account can be deleted. */
export interface AccountDeletionBlocker {
  groupId: string
  name: string
  reason: AccountDeletionBlockReason
  /** When its plan ends, as an ISO timestamp, for {@link AccountDeletionBlockReason.PlanEnding}. */
  endsAt: string | null
}

/** `GET /api/auth/account/deletion`: what stops the account from being deleted now. */
export interface AccountDeletionStatus {
  blockers: AccountDeletionBlocker[]
}

// The longest value, in characters, of each text field of a push device: the library's own
// `PUSH_SUBSCRIPTION_LIMITS`, which its request check (`pushSubscribeRequestSchema`) enforces. The
// row schema below and the columns of `user_push_tokens` must agree with it, or a request that
// passes the check does not fit the column (#355). `push-token-limits.test.ts` holds the row schema
// to these numbers, and `tests/integration/web-push.integration.test.ts` holds the columns to them.
export const userPushTokenSchemaBase = type({
  userId: "number = 0",
  deviceId: `string <= ${PUSH_SUBSCRIPTION_LIMITS.deviceId} = ''`,
  endpoint: `string <= ${PUSH_SUBSCRIPTION_LIMITS.endpoint} = ''`,
  auth: `string <= ${PUSH_SUBSCRIPTION_LIMITS.auth} = ''`,
  p256dh: `string <= ${PUSH_SUBSCRIPTION_LIMITS.p256dh} = ''`,
})
export type UserPushTokenBase = typeof userPushTokenSchemaBase.infer

export const userPushTokenSchema = BaseModelSchema.and(userPushTokenSchemaBase)
export type UserPushToken = typeof userPushTokenSchema.infer

export const userPushTokenPublicSchema = userPushTokenSchema.omit(
  "endpoint",
  "auth",
  "p256dh",
  "deletedAt",
)
export type UserPushTokenPublic = typeof userPushTokenPublicSchema.infer

export enum AuthAuditEventType {
  SIGNED_UP = 1,
  SIGNED_IN = 2,
  SIGNED_OUT = 3,
  PROFILE_UPDATED = 4,
  /** The person asked to delete their account; it waits {@link ACCOUNT_DELETION_GRACE_DAYS} days. */
  ACCOUNT_DELETION_REQUESTED = 5,
  /** The person signed in while their account waited for deletion, which restored it. */
  ACCOUNT_RESTORED = 6,
  /** The person ended one of their other sessions, or all of them, from the devices list. */
  SESSIONS_ENDED = 7,
  /**
   * The person created a personal API token. `identifier` names the token, as in every token row
   * below: its id, group, access and name (`@server/api-tokens/api-tokens.ts` has the format), so
   * the row still says which token it was once the token is gone. Never the secret or its hash.
   */
  API_TOKEN_CREATED = 8,
  /** A personal API token was used; written at most once every few minutes per token. */
  API_TOKEN_USED = 9,
  /**
   * A personal API token was revoked, with the reason in `identifier`: by its owner, by a password
   * change or reset, because the owner's membership of the group ended, or because the group was
   * deleted.
   */
  API_TOKEN_REVOKED = 10,
  /** The worker deleted this person's token that expired long ago; one row per token. */
  API_TOKENS_PURGED = 11,
  /**
   * A request with a personal API token was refused, with the reason in `identifier`: the token was
   * revoked or expired, or it may not do what was asked. Written a few times an hour per token at
   * most, so a flood of refused requests cannot fill the table.
   */
  API_TOKEN_REFUSED = 12,
  /**
   * A Google or GitHub account became a way into this account, with the key's method in
   * `identifier` (`oauth:google`): the provider vouched for the address the account had proven.
   */
  SIGN_IN_METHOD_LINKED = 13,
  /** The person removed a sign-in method, with the key's method in `identifier`. */
  SIGN_IN_METHOD_UNLINKED = 14,
  /**
   * The account lost its password because it never confirmed its address, and someone a provider
   * vouched for as the owner of that address created an account of their own. `identifier` is the
   * method of that provider (`oauth:google`). The account keeps its data but has no way in.
   */
  UNCONFIRMED_ADDRESS_TAKEN = 15,
  /**
   * An operator blocked the person (#146): every session ended and no sign-in is let in.
   * `identifier` names the operator (`operator:<id>`). An operator ending all of a person's
   * sessions writes {@link SESSIONS_ENDED} with the same `identifier`.
   */
  USER_BLOCKED = 16,
  /** An operator unblocked the person. `identifier` names the operator, as for `USER_BLOCKED`. */
  USER_UNBLOCKED = 17,
  /**
   * An operator removed one of the person's push devices (#427). `identifier` names the operator
   * and the device's row: `operator:<id> device=<row id>`. An operator revoking a token writes
   * {@link API_TOKEN_REVOKED} with `reason=operator:<id>`.
   */
  PUSH_DEVICE_REMOVED = 18,
  /**
   * An operator removed an address from a mailing list (#428). The row is on the operator; its
   * `identifier` is the list and the masked address (`news:j***@e***.com`), never the address
   * itself, which the removal erased.
   */
  NEWSLETTER_SUBSCRIBER_REMOVED = 19,
  /** An operator mailed a pending address its confirm link again; `identifier` as for 19. */
  NEWSLETTER_CONFIRMATION_RESENT = 20,
  /** An operator downloaded a list's addresses; `identifier` is the list and how many rows. */
  NEWSLETTER_SUBSCRIBERS_EXPORTED = 21,
  /**
   * The person's role changed (#425). `identifier` names who changed it and both roles:
   * `operator:<id> from viewer to operator` from the admin app, `cli:user-role from …` from
   * `deno task user:role`.
   */
  USER_ROLE_CHANGED = 22,
  /**
   * An operator sent the person a password-reset link, the same mail "Forgot password" sends.
   * `identifier` names the operator (`operator:<id>`).
   */
  PASSWORD_RESET_SENT = 23,
  /**
   * The operator exported the user list as CSV. Written on the operator's own trail, since the file
   * holds many people; `identifier` names the operator and the filter (`operator:<id> q=ada`).
   */
  USERS_EXPORTED = 24,
  /**
   * The person renamed one of their passkeys (#222). `identifier` names both names:
   * `passkey name=<new> from=<old>`. Numbers 25 to 29 are the billing events of
   * `@domain/billing/admin.ts`.
   */
  SIGN_IN_METHOD_RENAMED = 30,
  /** A guest account was made with one click (#224). */
  GUEST_STARTED = 31,
  /** A guest kept the account by adding a sign-in method; `identifier` names the method. */
  GUEST_KEPT = 32,
  /**
   * An operator deleted a guest account (#224). The row is the operator's, because the guest's
   * own rows go with the account: `identifier` is `user:<id>` of the deleted guest.
   */
  GUEST_DELETED_BY_OPERATOR = 33,
  /**
   * The person linked a Telegram account (#269): its chat gets their notifications and its
   * messages to the bot act as them. `identifier` is `telegram:<Telegram user id>`.
   */
  TELEGRAM_LINKED = 34,
  /**
   * The Telegram account was unlinked: by the person, in the app or with `/unlink` in the chat
   * (`telegram:<id>`), or by an operator (`operator:<id> telegram:<id>`).
   */
  TELEGRAM_UNLINKED = 35,
  /**
   * An operator removed the person's profile picture (#228). `identifier` names the operator
   * (`operator:<id>`). The person's own changes of it are {@link PROFILE_UPDATED} rows with the
   * `identifier` `picture`.
   */
  PICTURE_REMOVED_BY_OPERATOR = 36,
}

export const authAuditBaseSchema = type({
  userId: "number = 0",
  eventType: type.enumerated(
    AuthAuditEventType.SIGNED_UP,
    AuthAuditEventType.SIGNED_IN,
    AuthAuditEventType.SIGNED_OUT,
    AuthAuditEventType.PROFILE_UPDATED,
    AuthAuditEventType.ACCOUNT_DELETION_REQUESTED,
    AuthAuditEventType.ACCOUNT_RESTORED,
    AuthAuditEventType.SESSIONS_ENDED,
    AuthAuditEventType.API_TOKEN_CREATED,
    AuthAuditEventType.API_TOKEN_USED,
    AuthAuditEventType.API_TOKEN_REVOKED,
    AuthAuditEventType.API_TOKENS_PURGED,
    AuthAuditEventType.API_TOKEN_REFUSED,
    AuthAuditEventType.SIGN_IN_METHOD_LINKED,
    AuthAuditEventType.SIGN_IN_METHOD_UNLINKED,
    AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN,
    AuthAuditEventType.USER_BLOCKED,
    AuthAuditEventType.USER_UNBLOCKED,
    AuthAuditEventType.PUSH_DEVICE_REMOVED,
    AuthAuditEventType.NEWSLETTER_SUBSCRIBER_REMOVED,
    AuthAuditEventType.NEWSLETTER_CONFIRMATION_RESENT,
    AuthAuditEventType.NEWSLETTER_SUBSCRIBERS_EXPORTED,
    AuthAuditEventType.USER_ROLE_CHANGED,
    AuthAuditEventType.PASSWORD_RESET_SENT,
    AuthAuditEventType.USERS_EXPORTED,
    AuthAuditEventType.SIGN_IN_METHOD_RENAMED,
    AuthAuditEventType.GUEST_STARTED,
    AuthAuditEventType.GUEST_KEPT,
    AuthAuditEventType.GUEST_DELETED_BY_OPERATOR,
    AuthAuditEventType.TELEGRAM_LINKED,
    AuthAuditEventType.TELEGRAM_UNLINKED,
    AuthAuditEventType.PICTURE_REMOVED_BY_OPERATOR,
  ),
  identifier: "string <= 320 | null = null",
  ip: "string <= 45 | null = null",
  userAgent: "string <= 300 | null = null",
})
export type AuthAuditBase = typeof authAuditBaseSchema.infer

export const authAuditSchema = BaseModelSchema.and(authAuditBaseSchema)
export type AuthAudit = typeof authAuditSchema.infer

/**
 * The id a person's own changes (profile, push devices) are announced under. The socket sends a
 * `change.hint` for it to every socket of that person, so a second tab reads the profile again.
 */
export function userChangeGroupId(userId: number): string {
  return `user:${userId}`
}

export type ProfileResponse = {
  user: User
}

export type PushDevicesResponse = {
  data: UserPushTokenPublic[]
}

export type PushSubscribeResponse = {
  userPushToken: UserPushTokenPublic
}

export type TotpConnectStartResponse = {
  qrcode: string
  secret: string
}

/** One device the person is signed in on, as `GET /api/auth/sessions` lists it (#151). */
export interface SignedInDevice {
  id: number
  /** "Firefox on Linux", worked out once at sign-in; "Unknown device" when nothing was recognised. */
  deviceName: string
  /** The sign-in address with its last part hidden (`203.0.113.*`), or `null` when unknown. */
  ipHint: string | null
  /** ISO 8601. When the device signed in. */
  createdAt: string
  /** ISO 8601. The last time the device used the session, to within a few minutes. */
  lastUsedAt: string
  /** The session of the request that asked: this device. */
  current: boolean
}

/** The answer of `GET /api/auth/sessions`: this device first, then the rest, last used first. */
export interface SignedInDevicesResponse {
  sessions: SignedInDevice[]
}

/** The providers a person can sign in with besides a password (#141), as the API's paths name them. */
export const OAUTH_PROVIDERS = ["google", "github"] as const
export type OAuthProviderId = typeof OAUTH_PROVIDERS[number]

/** What each provider is called on a button and in a sentence. */
export const OAUTH_PROVIDER_NAMES: Record<OAuthProviderId, string> = {
  google: "Google",
  github: "GitHub",
}

/**
 * The only origins a provider's picture of a person is shown from: Google's and GitHub's image
 * hosts. The SPA's `img-src` allows exactly these (docs/security-headers.md); a picture from any
 * other host is dropped before it reaches the page, and the page shows initials instead.
 */
export const PROVIDER_AVATAR_ORIGINS = [
  "https://lh3.googleusercontent.com",
  "https://avatars.githubusercontent.com",
] as const

/** `url` when it is an `https:` address on one of {@link PROVIDER_AVATAR_ORIGINS}, else `null`. */
export function providerAvatarUrl(url: unknown): string | null {
  if (typeof url !== "string" || !URL.canParse(url)) return null
  const parsed = new URL(url)
  const allowed: readonly string[] = PROVIDER_AVATAR_ORIGINS
  return allowed.includes(parsed.origin) && parsed.username === "" && parsed.password === ""
    ? parsed.href
    : null
}

/** `value` as a provider id, or `null` when it names none. */
export function oauthProviderId(value: unknown): OAuthProviderId | null {
  return OAUTH_PROVIDERS.find((id) => id === value) ?? null
}

/** The answer of `GET /api/auth/providers`: the providers whose credentials are set. */
export interface OAuthProvidersResponse {
  providers: OAuthProviderId[]
}

/**
 * A provider sign-in that would create a new account and waits for the person to confirm it
 * (#142), as `GET /api/auth/sign-up/pending` answers it.
 */
export interface PendingSignUp {
  provider: OAuthProviderId
  /** The address the provider reported, vouched for or not; `null` when it shared none. */
  email: string | null
  /** The person's name as the provider shows it; `null` when it shared none. */
  name: string | null
  /**
   * The provider's picture of the person, an `https:` address on one of
   * {@link PROVIDER_AVATAR_ORIGINS}; `null` when it shared none, or one from anywhere else.
   */
  avatarUrl: string | null
  /** ISO 8601. After this the sign-up can no longer be confirmed. */
  expiresAt: string
  /**
   * An account here signed up with a password and this address but never confirmed it. The
   * provider vouches that the person at the question owns the address, so creating the new
   * account takes the password away from that one. The question page says so first.
   */
  unconfirmedAccount: boolean
}

/** How long a sign-up and its mailed code work, in minutes (#142). A new code starts it again. */
export const SIGN_UP_CODE_MINUTES = 10

/**
 * A sign-up with an address and a password that waits for the code mailed to the address (#142),
 * as `GET /api/auth/password/sign-up` answers it.
 */
export interface WaitingPasswordSignUp {
  /** The address the person typed and the code went to. */
  email: string
  /** ISO 8601. After this the sign-up no longer works. */
  expiresAt: string
}

/** What `GET /api/auth/password/sign-up` answers: the sign-up that waits, or `null`. */
export interface WaitingPasswordSignUpResponse {
  pending: WaitingPasswordSignUp | null
}

/**
 * How an account that already uses the address signs in, as `POST /api/auth/password/sign-up/verify`
 * answers the right code for such an address. Told only to the person who proved the mailbox.
 */
export interface ExistingAccountAnswer {
  email: string
  /** The account has a password, so "Sign in instead" works. */
  password: boolean
  /** The providers it signs in with, in the order they were linked. */
  providers: OAuthProviderId[]
}

/** The answer of the verify route when an account already uses the address: nothing was created. */
export interface SignUpAccountExistsResponse {
  accountExists: ExistingAccountAnswer
}

/**
 * What the sign-up code answers for a guest whose address belongs to an account with a password
 * (#224): nothing changed, and `/keep/taken` asks what to do.
 */
export interface SignUpGuestTakenResponse {
  guestTaken: true
}

/** How long a sign-in link works, in minutes (#391). Each link works once. */
export const SIGN_IN_LINK_MINUTES = 15

/**
 * The `auth_keys.method` of the key a sign-in link signs in through (#391), and the `identifier` of
 * the audit rows a link writes. It holds no secret: an account gets one such key, and a link proves
 * the mailbox each time. It is no sign-in method a person links or unlinks.
 */
export const SIGN_IN_LINK_METHOD = "email-link"

/**
 * The `identifier` of the person's own {@link AuthAuditEventType.PROFILE_UPDATED} rows for their
 * profile picture (#228): a new picture, and a removal (#453). Rows written before #453 say
 * `picture` for a removal too.
 */
export const PICTURE_AUDIT = { changed: "picture", removed: "picture-removed" } as const

/**
 * The body of `POST /api/auth/link`: the address the link goes to, and the page to open after
 * sign-in, which the API checks again.
 */
export const authSignInLinkSchema = authEmailSchema.and({
  "next?": "string <= 2048",
}).and(mailLanguageSchema)
export type AuthSignInLink = typeof authSignInLinkSchema.infer

/** The body of `POST /api/auth/link/redeem`: the token from the link, as the page read it. */
export const authSignInLinkRedeemSchema = type({
  token: "0 < string <= 256",
})
export type AuthSignInLinkRedeem = typeof authSignInLinkRedeemSchema.infer

/** What `POST /api/auth/link/redeem` answers when the link signed someone in (#391). */
export interface SignInLinkRedeemed {
  /** The address the link proved, for the sign-in page's "last time" hint. */
  email: string
  /** The page to open: the one asked for when the link was requested, already checked. */
  next: string | null
  /** The link made a new account, or kept a guest's (`false` for an existing account). */
  created: boolean
  /** The account has an authenticator app: its code comes next. */
  secondFactorPending: boolean
}

/**
 * The `code` of the refusal `POST /api/auth/link/redeem` answers a guest whose link another browser
 * asked for (#391). The link is spent and the guest's session stays as it was.
 */
export const SIGN_IN_LINK_ASKED_ELSEWHERE_CODE = "SIGN_IN_LINK_ASKED_ELSEWHERE"

/** What `GET /auth/sign-up/pending` answers: the sign-up that waits, or `null` when none does. */
export interface PendingSignUpResponse {
  pending: PendingSignUp | null
}

/** Longest name a passkey may have, in characters (#222). */
export const PASSKEY_NAME_MAX_LENGTH = 64

/**
 * The name of a passkey from a rename's body, trimmed, or `null` when the body has none a passkey
 * may carry: empty, longer than {@link PASSKEY_NAME_MAX_LENGTH} characters, or holding a character
 * a one-line name must not (`hasUnsafeTextCharacters`). The name goes into the audit trail as it is.
 */
export function parsePasskeyName(body: unknown): string | null {
  const raw = (body as { name?: unknown } | null)?.name
  if (typeof raw !== "string") return null
  const name = raw.trim()
  const length = Array.from(name).length
  if (length < 1 || length > PASSKEY_NAME_MAX_LENGTH || hasUnsafeTextCharacters(name)) return null
  return name
}

/** The answer to adding a passkey: its key id and the name it was given. */
export interface PasskeyAdded {
  keyId: number
  name: string
}

/** What a passkey row adds to a {@link SignInMethod} (#222). Dates are ISO 8601. */
export interface PasskeyDetails {
  name: string
  createdAt: string
  lastUsedAt: string | null
}

/** One way into the account, as `GET /api/auth/methods` lists it (#141). */
export interface SignInMethod {
  /** The id to unlink it by. */
  id: number
  kind: "password" | "passkey" | OAuthProviderId
  /** The address this method proved or signs in with; `null` when it carries none. */
  email: string | null
  /** This device signed in with it, so unlinking it signs this device out. */
  current: boolean
  /**
   * A provider method or passkey that is not the last way in. An address another key holds proven
   * is a way in, through a sign-in link. The password is never unlinked.
   */
  canUnlink: boolean
  /** The passkey's name and dates, on a passkey row only. */
  passkey?: PasskeyDetails
}

/** The answer of `GET /api/auth/methods`. */
export interface SignInMethodsResponse {
  methods: SignInMethod[]
  /** Providers that are on and not linked to this account yet. */
  available: OAuthProviderId[]
  /**
   * ISO 8601. Until then this session confirms a step that an account with no password cannot
   * confirm with one: it was started by a sign-in with a provider less than
   * {@link PROVIDER_PROOF_MINUTES} minutes ago. `null` for any other session.
   */
  providerProofUntil: string | null
  /**
   * The account has a proven address, so a sign-in link reaches it (#391): an account with no
   * password can confirm a step with a link sign-in of a moment ago.
   */
  emailLink: boolean
}

/**
 * How a provider sign-in or a link ended, as the API's callback puts it in the `oauth` query
 * parameter of the page it sends the browser to.
 */
export type OAuthNotice =
  /** The sign-in failed: the provider refused, the attempt expired, or the account is gone. */
  | "failed"
  /** Linked: the provider is now a way into the signed-in account. */
  | "linked"
  /** Nothing changed: that provider account was already a way into the signed-in account. */
  | "link-exists"
  /** Not linked: another account here already signs in with that provider account. */
  | "link-taken"
  /** Too many attempts from this address in a minute; nothing was tried. */
  | "busy"
  /** A guest linked the provider: the account is kept (#224). */
  | "kept"
  /** A guest's provider account signs in to another account here: the switch page asks (#224). */
  | "guest-taken"

/**
 * The web app's pages a provider's callback redirects to. `apps/spa` routes each one
 * (`spa-paths.ts`), and its tests fail when one is missing there.
 */
export const OAUTH_PAGES = {
  /** Sign-in: where a failed provider sign-in says so. */
  signIn: "/sign-in",
  /** Asks "Create a new account?" before a provider signs anyone up. */
  confirmSignUp: "/sign-up/confirm",
  /** Asks for the authenticator code a provider sign-in still owes. */
  oneTimeCode: "/totp",
  /** The app's home, which opens the notes: where sign-in lands without a `next`. */
  home: "/",
  /** The profile's sign-in methods: where linking a provider reports how it ended. */
  signInMethods: "/profile/security",
  /** Keeping a guest account (#224): where a guest's link reports. */
  keep: "/keep",
  /** "That sign-in belongs to another account": where a guest's taken link lands. */
  keepTaken: "/keep/taken",
} as const

/** The query parameter that carries an {@link OAuthNotice}. */
export const OAUTH_NOTICE_PARAM = "oauth"

/** What each {@link OAuthNotice} tells the person. */
export const OAUTH_NOTICES: Record<OAuthNotice, string> = {
  "failed": "That sign-in did not work. Try again.",
  "linked": "Linked. You can now sign in with it.",
  "link-exists": "Already linked. You can sign in with it as before.",
  "link-taken": "Not linked: that account is already linked to another account here.",
  "busy": "Too many attempts. Wait a minute, then try again.",
  "kept": "Sign-in method added. You can now sign in with it on any device.",
  "guest-taken": "That sign-in method belongs to another account.",
}

/** `value` as a notice, or `null` when it is none. */
export function oauthNotice(value: unknown): OAuthNotice | null {
  return typeof value === "string" && Object.hasOwn(OAUTH_NOTICES, value)
    ? value as OAuthNotice
    : null
}

// The four response shapes below have no @spy4x/platform/api counterpart: they name this app's
// own endpoint responses (a boolean success flag, a public key string), not a general envelope.
// Moved here from the deleted libs/platform/types/+index.ts.
export type ApiSuccessResponse = {
  success: boolean
}

export type ApiIsSuccessResponse = {
  isSuccess: boolean
}

export type PushPublicKeyResponse = {
  publicKey: string
}

/**
 * Who is acting, in a form no transport owns.
 *
 * REST builds this from the session cookie on each request; a WebSocket transport builds it once
 * at upgrade and reuses it per message. Every user-facing CQRS message carries one, and the session
 * gate on the buses reads it, so one check covers every transport.
 *
 * An actor is a snapshot of the session when it was built. A long-lived transport such as a
 * WebSocket must re-validate the session (sign-out, expiry, a second factor completed or removed)
 * rather than keep trusting an actor it built at upgrade.
 *
 * `sessionSecondFactor` holds a `SecondFactorStatus` from `@spy4x/server/sign-in`. It is typed
 * with a type-only import so this module, which the SPA also imports, pulls in no server code.
 */
export interface Actor {
  userId: number
  userMfa: UserMFAStatus
  sessionSecondFactor: SecondFactorStatus
  /**
   * The session the actor acts through, when a session does. A write that must not outlive the
   * session, such as storing a push subscription (#409), checks it again under a lock.
   */
  sessionId?: number
  /**
   * Set when a personal API token acts instead of a session (#167). The session gate then lets
   * through only the messages a token may send, in the token's group, and only reads when the
   * token cannot write.
   */
  token?: ActorToken
}

/** What an API token may do, carried on the {@link Actor} it builds. */
export interface ActorToken {
  tokenId: string
  /** The one group the token acts in. */
  groupId: string
  /** `false` for a read-only token: every command is refused. */
  canWrite: boolean
}

export type AccessErrorCode = "AUTH_REQUIRED" | "MFA_REQUIRED"

/** Thrown when a dispatch is refused for who is acting; `code` maps to an HTTP status. */
export class AccessError extends Error {
  constructor(
    public readonly code: AccessErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "AccessError"
  }
}

/**
 * The prefix of the WebSocket subprotocol that names the user a page was started for: the page
 * offers `user.<id>` (a browser cannot set a header on a socket), and the API refuses the upgrade
 * unless the session is that user's, and answers with the same subprotocol.
 */
export const SOCKET_USER_PROTOCOL = "user."

// ---------------------------------------------------------------------------------------------
// The operator area (#146): `/api/admin/...`, open to operators and the roles above them.
// ---------------------------------------------------------------------------------------------

/** The lowest role that may open the operator area. Anyone below it gets 404 there. */
export const ADMIN_MIN_ROLE = UserRole.OPERATOR

/** Whether a person with `role` may open the operator area. */
export function canOpenAdmin(role: UserRole | undefined | null): boolean {
  return typeof role === "number" && role >= ADMIN_MIN_ROLE
}

/** How many people one page of the operator's user list shows. */
export const ADMIN_USERS_PAGE_SIZE = 25

/** The longest search the user list takes, in characters. */
export const ADMIN_SEARCH_MAX_LENGTH = 100

/** One person in the operator's user list. Dates are ISO 8601. */
export interface AdminUserRow {
  id: number
  firstName: string
  lastName: string
  /** The address the person signs in with, or `null` for an older account with a username only. */
  email: string | null
  role: UserRole
  /** When an operator blocked the person, or `null`. */
  blockedAt: string | null
  createdAt: string
  /** The last signed-in activity, to within five minutes (#152), or `null` when never seen. */
  lastSeenAt: string | null
  /** When a guest account (#224) was started, or `null` (or absent) for a full account. */
  guestSince?: string | null
  /** Their profile picture (#228); `null` or absent for none. */
  pictureId?: string | null
}

/** The answer of `GET /api/admin/users`. */
export interface AdminUserListResponse {
  users: AdminUserRow[]
  /** How many people match the search and filters, over every page. */
  total: number
  /** The page shown, 1-based. */
  page: number
  pageSize: number
}

/** One way the person signs in, as the operator sees it: never a secret. */
export interface AdminSignInMethod {
  /**
   * `password`, `oauth:google`, `oauth:github`, `email-code`, `passkey`, `email-link`, or
   * `telegram` for a linked Telegram account (#269), which is no way in.
   */
  method: string
  /** A passkey's name and last use (#222), on a passkey row only. */
  passkey?: { name: string; lastUsedAt: string | null }
  /**
   * On the `email-link` row only (#391): when a sign-in link last signed the person in or up, or
   * `null` when the audit keeps no such row. ISO 8601.
   */
  lastUsedAt?: string | null
  /** The address the key holds, or `null`. */
  email: string | null
  /** When the address was proven, or `null` when it was not. ISO 8601. */
  provenAt: string | null
  createdAt: string
}

/** One live session of the person. Dates are ISO 8601. */
export interface AdminSession {
  id: number
  deviceName: string
  ipHint: string | null
  createdAt: string
  lastUsedAt: string
}

/** One group the person is a member of. */
export interface AdminUserGroup {
  id: string
  name: string
  /** The person's role in the group (`GroupRole`: 1 viewer, 2 editor, 3 admin, 4 owner). */
  role: number
}

/** One row of the person's audit trail, newest first. */
export interface AdminAuditRow {
  id: number
  eventType: AuthAuditEventType
  identifier: string | null
  ip: string | null
  createdAt: string
}

/** The answer of `GET /api/admin/users/:id`. */
export interface AdminUserDetail {
  user: AdminUserRow
  methods: AdminSignInMethod[]
  sessions: AdminSession[]
  groups: AdminUserGroup[]
  /** The newest {@link ADMIN_AUDIT_LIMIT} rows of the person's audit trail. */
  audits: AdminAuditRow[]
  /** Their theme, region format, time zone and clock, read-only (#163). */
  preferences: AdminUserPreferences
  /** When their one billing trial went to a group (#205), or `null` while unused. ISO 8601. */
  trialUsedAt: string | null
}

/** How many audit rows the detail page shows. */
export const ADMIN_AUDIT_LIMIT = 50

/** Whether the list shows blocked people, people who are not, or both. */
export type AdminBlockedFilter = "any" | "blocked" | "active"

/** Which kind of account the user list shows (#224): guests, or accounts with a sign-in method. */
export type AdminAccountFilter = "guest" | "full"

/** A column the user list sorts by, on the server. */
export type AdminUserSortKey = "name" | "role" | "lastSeenAt" | "createdAt"

/** Every {@link AdminUserSortKey}, in the order the list's columns show them. */
export const ADMIN_USER_SORT_KEYS: readonly AdminUserSortKey[] = [
  "name",
  "role",
  "lastSeenAt",
  "createdAt",
]

/** The order of the user list when the address names none: newest first. */
export const ADMIN_DEFAULT_SORT: SortRule<AdminUserSortKey>[] = [
  { key: "createdAt", direction: "desc" },
]

/** The search and filters of the user list, as the page's address and the API's query carry them. */
export interface AdminUserFilter {
  /** Words that must each appear in the name or an address; `""` for everyone. */
  query: string
  /** Only people with this role, or `null` for every role. */
  role: UserRole | null
  blocked: AdminBlockedFilter
  /** Only guest accounts (#224), or only full ones; absent for both. */
  account?: AdminAccountFilter
  /**
   * The order, most significant rule first. Empty means the default order, newest first; the
   * server breaks every tie by id, so a page never shows a person twice.
   */
  sort: SortRule<AdminUserSortKey>[]
  /** 1-based. */
  page: number
}

/** The filter that shows everyone, first page, newest first. */
export const ADMIN_NO_FILTER: AdminUserFilter = {
  query: "",
  role: null,
  blocked: "any",
  sort: ADMIN_DEFAULT_SORT,
  page: 1,
}

/**
 * Reads the user list's filter from query parameters (`q`, `role`, `blocked`, `sort`, `page`). A
 * value it does not understand falls back to the default for that part, so a hand-edited address
 * still shows a list. `sort=none` reads as no sort rules: the operator turned every sort off.
 */
export function parseAdminUserFilter(params: URLSearchParams): AdminUserFilter {
  const query = (params.get("q") ?? "").trim().slice(0, ADMIN_SEARCH_MAX_LENGTH)
  const roleNumber = Number(params.get("role"))
  const role = userRoleValues.includes(roleNumber as UserRole) && Number.isInteger(roleNumber)
    ? roleNumber as UserRole
    : null
  const rawBlocked = params.get("blocked")
  const blocked: AdminBlockedFilter = rawBlocked === "blocked" || rawBlocked === "active"
    ? rawBlocked
    : "any"
  const pageNumber = Number(params.get("page"))
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 100_000
    ? pageNumber
    : 1
  // `none` reads as no rules: the operator turned every column's sort off.
  const sort = parseSort(params.get("sort"), ADMIN_USER_SORT_KEYS, ADMIN_DEFAULT_SORT)
  const rawAccount = params.get("account")
  const account = rawAccount === "guest" || rawAccount === "full" ? rawAccount : undefined
  return { query, role, blocked, ...(account ? { account } : {}), sort, page }
}

/** The query string of `filter`, leaving out every part at its default. No leading `?`. */
export function adminUserFilterQuery(filter: AdminUserFilter): string {
  const params = new URLSearchParams()
  if (filter.query) params.set("q", filter.query)
  if (filter.role !== null) params.set("role", String(filter.role))
  if (filter.blocked !== "any") params.set("blocked", filter.blocked)
  if (filter.account) params.set("account", filter.account)
  const sort = serializeSort(filter.sort)
  if (sort !== serializeSort(ADMIN_DEFAULT_SORT)) params.set("sort", sort)
  if (filter.page > 1) params.set("page", String(filter.page))
  return params.toString()
}

/** A count now and over the period before, for a stat card's change. */
export interface AdminStatChange {
  current: number
  previous: number
}

/** One day of a 30-day chart: the UTC day (`YYYY-MM-DD`) and its count. */
export interface AdminDailyCount {
  day: string
  count: number
}

/** How many days the dashboard's charts cover, today included. */
export const ADMIN_STATS_DAYS = 30

/**
 * The answer of `GET /api/admin/stats`: the dashboard's numbers. Counts only, never content. A
 * person is active on a day when they did something the product records that day: an entry in
 * their audit trail (a sign-in, a profile change, a token used), an entry in a group's activity,
 * or their last-seen time.
 */
export interface AdminStats {
  /** When the numbers were read. ISO 8601. */
  generatedAt: string
  /**
   * True when `people`, `groups` or `notes` is the database's estimate rather than a count: a table
   * that large is not counted on every load (#462). Absent means counted.
   */
  approximate?: boolean
  /** People with an account that is not deleted. */
  people: number
  /** Blocked people among them. */
  blocked: number
  /** Sign-ups in the last 7 days, and in the 7 days before. */
  newThisWeek: AdminStatChange
  /** Active people today (UTC), and yesterday. */
  activeToday: AdminStatChange
  /** Active people in the last 7 days, and in the 7 days before. */
  activeThisWeek: AdminStatChange
  /** Groups that are not deleted. */
  groups: number
  /** Notes that are not deleted. */
  notes: number
  /** Sign-ups per UTC day, oldest first, {@link ADMIN_STATS_DAYS} days ending today. */
  signUpsPerDay: AdminDailyCount[]
  /** Active people per UTC day, oldest first, the same days. */
  activePerDay: AdminDailyCount[]
  /** Guest accounts (#224) started, kept and cleaned up over the same days. */
  guests?: GuestStats
}

/** The roles an operator-area page may pick from, lowest first. */
export const ADMIN_ROLE_CHOICES: readonly UserRole[] = [
  UserRole.VIEWER,
  UserRole.OPERATOR,
  UserRole.SUPERVISOR,
  UserRole.ADMIN,
]

/**
 * The body of `POST /api/admin/users/:id/role` (#425): the new role, as its number. Only a number
 * that names a role passes; a role name or any other value is refused.
 */
export const adminUserRoleSchema = type({
  role: type.enumerated(UserRole.VIEWER, UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.ADMIN),
})
export type AdminUserRoleBody = typeof adminUserRoleSchema.infer

/** The roles `operatorRole` may give: every role below its own (#425). */
export function adminGrantableRoles(operatorRole: UserRole): UserRole[] {
  return ADMIN_ROLE_CHOICES.filter((role) => role < operatorRole)
}

/** Only an administrator changes a role, and only to one below their own (#425). */
export function canChangeRoles(operatorRole: UserRole): boolean {
  return operatorRole === UserRole.ADMIN
}

/** The address of the CSV of every person `filter` matches, on all its pages, in its sort. */
export function adminUsersExportPath(filter: AdminUserFilter): string {
  const query = adminUserFilterQuery({ ...filter, page: 1 })
  return `/api/admin/users/export.csv${query ? `?${query}` : ""}`
}

// #429: the audit log and the System page of the operator area.
export * from "./admin-audit.ts"
export * from "./admin-system.ts"
export * from "./admin-jobs.ts"
export * from "./preferences.ts"
export * from "./guests.ts"
export * from "./data-export.ts"
export * from "./telegram.ts"
export * from "./profile-picture.ts"

/**
 * One push device of a person, as the operator area shows it (#427): never the endpoint or the
 * keys, which let anyone who holds them push to the device.
 */
export interface AdminPushDevice {
  /** The row's id: what the operator's remove names. */
  id: number
  /** The device id's last eight characters, as the person's own profile names the device. */
  label: string
  /** ISO 8601: when the device was first registered. */
  createdAt: string
  /** ISO 8601: when the browser last renewed its subscription. */
  updatedAt: string
}

/** The answer of `GET /api/admin/users/:id/devices`: the live devices, newest first. */
export interface AdminPushDevicesResponse {
  devices: AdminPushDevice[]
}
