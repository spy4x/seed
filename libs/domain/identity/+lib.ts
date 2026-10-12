import { type } from "arktype"
import { BaseModelSchema, dateSchema } from "@spy4x/platform/model"
import type { SecondFactorStatus } from "@spy4x/server/sign-in"

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

export const userProfileBaseSchema = type({
  firstName: `1 <= string <= ${NAME_MAX_LENGTH}`,
  lastName: `1 <= string <= ${NAME_MAX_LENGTH}`,
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
