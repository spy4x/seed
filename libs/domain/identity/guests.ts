import { type } from "arktype"

/**
 * Guest accounts (#224): a person tries the app with one click, in a real account that has no
 * sign-in method yet. The session cookie is the only way back in, so the app keeps asking, at
 * moments that make sense, to "keep" the account by adding a sign-in method to the same user id.
 *
 * @module
 */

/**
 * The `auth_keys.method` of a guest's key. A session must name a key, so a guest has one, with a
 * random subject; no route signs in with it, and it is never listed as a sign-in method.
 */
export const GUEST_METHOD = "guest"

/** How long a guest's session lasts; every day of use renews it to this length again. */
export const GUEST_SESSION_DAYS = 365

/** Guest accounts one client address may start per hour. */
export const GUEST_STARTS_PER_HOUR = 5

/** A guest account with nothing of its own in it is deleted this many days after it was made. */
export const GUEST_EMPTY_DAYS = 7

/** A guest account unused for this many days is deleted with everything in it. */
export const GUEST_IDLE_DAYS = 365

/** How long the choice after "that sign-in method belongs to another account" waits, in minutes. */
export const GUEST_SWITCH_MINUTES = 10

/** What the API answers when a guest asks for something that needs a sign-in method. */
export const GUEST_REFUSAL_CODE = "GUEST_NEEDS_SIGN_IN_METHOD"

/** The refusal's words, for the API and for any screen that does not know the action. */
export const GUEST_REFUSAL_MESSAGE = "This needs a sign-in method. Add one to your account first."

/** The actions a guest cannot take until the account is kept. */
export type GuestLimitedAction =
  | "invite"
  | "push"
  | "api-token"
  | "upload"
  | "billing"
  | "telegram"

/** The body of a guest refusal: `forbidden`, with the guest reason and the refused action. */
export interface GuestRefusal {
  error: {
    code: "forbidden"
    message: string
    reason: typeof GUEST_REFUSAL_CODE
    details: { action: GuestLimitedAction }
  }
}

/** Whether an API answer's body is a guest refusal. */
export function isGuestRefusal(body: unknown): body is GuestRefusal {
  const error = (body as { error?: { reason?: unknown } } | null)?.error
  return typeof error === "object" && error !== null && error.reason === GUEST_REFUSAL_CODE
}

/** What the dashboard counts: guest accounts made, kept and deleted by the clean-up. */
export enum GuestEventKind {
  Created = 1,
  Kept = 2,
  CleanedUp = 3,
}

/** The inbox reminders a guest gets, each once. */
export enum GuestReminderKind {
  /** After the first note the guest writes. */
  FirstNote = 1,
  /** On the third day the guest uses the app. */
  ThirdVisit = 2,
  /** When the guest tried to invite someone. */
  Invite = 3,
}

/** Guest accounts in a period, from `guest_events`. */
export interface GuestStats {
  created: number
  kept: number
  cleanedUp: number
}

/** Whether a user, as the API sends it, is a guest: made with one click and not kept yet. */
export function isGuest(user: { guestSince?: Date | string | null } | null | undefined): boolean {
  return user?.guestSince !== undefined && user?.guestSince !== null
}

/** The body of `POST /api/auth/guest/switch`: what happens to the guest's work. */
export const guestSwitchSchema = type({
  choice: "'move' | 'delete'",
  "password?": "0 < string <= 200",
  "otp?": "/^[0-9]{6}$/",
}).onUndeclaredKey("reject")
export type GuestSwitchBody = typeof guestSwitchSchema.infer

/** The word a guest types to delete their account, in place of a password they do not have. */
export const GUEST_DELETE_WORD = "delete"

/**
 * The choice that waits after a guest's new sign-in method turned out to belong to another
 * account, as `GET /api/auth/guest/switch` answers it.
 */
export interface GuestSwitchState {
  /** `password`, `google`, `github` or `passkey`: the method that belongs to the other account. */
  method: string
  /** The other account's address, masked (`j***@example.com`), when it has one. */
  maskedEmail: string | null
  /** The person still owes that account's password (the e-mail path). */
  needsPassword: boolean
  /** That account has an authenticator app: the person owes its six-digit code too. */
  needsCode: boolean
  /** The groups the guest owns, which "Switch and move my groups" moves. */
  groups: { id: string; name: string }[]
  /** How many notes those groups hold, for the confirmation of "Switch and delete guest data". */
  notes: number
}

/** What the switch did, for the status line on the other account's first screen. */
export interface GuestSwitchResult {
  /** `true` when the session still owes that account's one-time code. */
  secondFactorPending: boolean
  /** How many groups moved; `0` when the guest's data was deleted instead. */
  movedGroups: number
}

/** What `POST /api/auth/guest` did: `started` (201), or nothing because a session is already open. */
export type GuestStartAnswer = "started" | "already-guest" | "signed-in"

/** The body of `POST /api/auth/guest`'s answer. */
export interface GuestStartResponse {
  guest: GuestStartAnswer
}

/** The body of `GET /api/auth/guest/switch`: the choice that waits, or `null`. */
export interface GuestSwitchResponse {
  switch: GuestSwitchState | null
}

/** The body of `POST /api/auth/guest/delete`: the word {@link GUEST_DELETE_WORD}, typed. */
export const guestDeleteSchema = type({ confirm: "0 < string <= 50" }).onUndeclaredKey("reject")

/**
 * The refusal of a guest start once the network made too many (#224), with the real wait in whole
 * minutes; an unknown wait reads as an hour. The screen's title already says what happened.
 */
export function guestTooManyMessage(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || !(retryAfterSeconds > 0)) return GUEST_ANSWERS.tooMany
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return `Try again in ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }, or create an account with your e-mail address.`
}

/** The API's sentences for the guest routes, so the screens show the same words. */
export const GUEST_ANSWERS = {
  off: "Trying the app without an account is turned off here. Create an account instead.",
  tooMany: "Try again in an hour, or create an account with your e-mail address.",
  wrongPassword: "That password is not right. Try again.",
  wrongCode: "That code did not work. Try again.",
  expired: "This choice has timed out. Add the sign-in method again.",
  unavailable: "That account cannot be signed in to right now.",
  notMoved: "The groups could not be moved. Your guest account was not changed. Try again.",
  wrongWord: `Type "${GUEST_DELETE_WORD}" to confirm.`,
  notGuest: "Only a guest account can be deleted this way.",
} as const
