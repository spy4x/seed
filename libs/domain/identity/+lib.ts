import { type } from "arktype"
import { BaseModelSchema, dateSchema } from "@spy4x/platform/model"
import type { SecondFactorStatus } from "@spy4x/server/sign-in"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"

// Not in @spy4x/platform/model: too template-specific (a user's name length limit) to belong in a
// general-purpose package. Moved here from the deleted libs/platform/types/+index.ts.
export const NAME_MAX_LENGTH = 50

export enum UserRole {
  VIEWER = 1,
  OPERATOR = 2,
  SUPERVISOR = 3,
  ADMIN = 4,
}
export const userRoleValues = Object.values(UserRole) as UserRole[]

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

/** The body of sign-up. */
export const authSignUpSchema = authEmailSchema.and(authPasswordSchema)
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

/** The body of an address change: the new address and the current password. */
export const authEmailChangeSchema = authEmailSchema.and(authPasswordSchema)
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

/** Days a deleted account waits before it is removed for good. Signing in before then restores it. */
export const ACCOUNT_DELETION_GRACE_DAYS = 7

/**
 * The author shown for what a deleted account left in a shared group. Its rows keep the content and
 * hold `null` where the author's id was.
 */
export const DELETED_USER_NAME = "Deleted user"

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

/** The body of "delete my account": the password, and an authenticator code when two-factor is on. */
export const accountDeleteSchema = authPasswordSchema.and({
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

/**
 * The longest value, in characters, of each text field of a push device. Three places must agree
 * on these: the request check (`pushSubscribeRequestSchema` in `@spy4x/platform/model`), the row
 * schema below and the columns of `user_push_tokens`. A request that passes the check and does not
 * fit the column is a server error (#355). `push-token-limits.test.ts` holds the request check to
 * these numbers, and `tests/integration/web-push.integration.test.ts` holds the columns to them.
 */
export const PUSH_TOKEN_LIMITS = {
  deviceId: 256,
  endpoint: 2048,
  auth: 256,
  p256dh: 256,
} as const

export const userPushTokenSchemaBase = type({
  userId: "number = 0",
  deviceId: `string <= ${PUSH_TOKEN_LIMITS.deviceId} = ''`,
  endpoint: `string <= ${PUSH_TOKEN_LIMITS.endpoint} = ''`,
  auth: `string <= ${PUSH_TOKEN_LIMITS.auth} = ''`,
  p256dh: `string <= ${PUSH_TOKEN_LIMITS.p256dh} = ''`,
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
  /** ISO 8601. After this the sign-up can no longer be confirmed. */
  expiresAt: string
  /**
   * An account here signed up with a password and this address but never confirmed it. The
   * provider vouches that the person at the question owns the address, so creating the new
   * account takes the password away from that one. The question page says so first.
   */
  unconfirmedAccount: boolean
}

/** What `GET /auth/sign-up/pending` answers: the sign-up that waits, or `null` when none does. */
export interface PendingSignUpResponse {
  pending: PendingSignUp | null
}

/** One way into the account, as `GET /api/auth/methods` lists it (#141). */
export interface SignInMethod {
  /** The id to unlink it by. */
  id: number
  kind: "password" | OAuthProviderId
  /** The address this method proved or signs in with; `null` when it carries none. */
  email: string | null
  /** This device signed in with it, so unlinking it signs this device out. */
  current: boolean
  /** A provider method that is not the last way in. The password is never unlinked. */
  canUnlink: boolean
}

/** The answer of `GET /api/auth/methods`. */
export interface SignInMethodsResponse {
  methods: SignInMethod[]
  /** Providers that are on and not linked to this account yet. */
  available: OAuthProviderId[]
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
  /** The profile: where sign-in lands without a `next`, and where linking reports. */
  profile: "/",
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
