/**
 * The one error body of the API (docs/api-errors.md). Every answer that is not a success, over
 * REST, over `/api/call` and on the socket, says what failed in three parts a screen can translate:
 *
 * - `code`: one of the eight protocol codes the realtime transport closes ({@link ERROR_CODES});
 * - `reason`: the feature's own, finer name for the refusal ({@link ErrorReason}), when it has one;
 * - `fields`: each failed field's arktype code and rule, keyed by path, for a validation failure.
 *
 * `message` stays English, for API clients, logs and a screen not translated yet. A screen shows
 * the text for `reason ?? code`.
 * @module
 */

import { type } from "arktype"
import { REALTIME_ERROR_CODES, type RealtimeErrorCode } from "@spy4x/realtime"
import { fieldErrorsSchema } from "@spy4x/validation"
import type { ApiTokenErrorCode } from "@domain/api-tokens"
import type { BillingErrorCode, PlanErrorCode } from "@domain/billing"
import type { BlogErrorCode } from "@domain/blog"
import type { CatalogErrorCode } from "@domain/catalog"
import type { ContactLinkErrorCode } from "@domain/contact-links"
import type { GroupErrorCode, InvitationErrorCode } from "@domain/groups"
import type {
  AccessErrorCode,
  GUEST_REFUSAL_CODE,
  PictureErrorCode,
  SIGN_IN_LINK_ASKED_ELSEWHERE_CODE,
} from "@domain/identity"
import type { AttachmentErrorCode, NoteErrorCode } from "@domain/notes"
import type { NotificationErrorCode } from "@domain/notifications"
import type { SubscriberTokenRefusal } from "@domain/subscribers"
import type { TagErrorCode } from "@domain/tags"

/** The closed list of error codes, the same on every transport. */
export const ERROR_CODES = REALTIME_ERROR_CODES

/** One of {@link ERROR_CODES}. */
export type ErrorCode = RealtimeErrorCode

/**
 * Reasons no domain aggregate owns: the API's own refusals. A feature's codes are added to
 * {@link ErrorReason} by their type instead, so they keep their names.
 */
export const API_ERROR_REASONS = [
  /** A body a schema refused; `fields` says which fields. */
  `validation`,
  /** Too many wrong passwords: the account's password check is locked for a while. */
  `PASSWORD_LOCKED`,
  /** The billing provider may have acted although its answer was lost. */
  `result_unknown`,
  /** The billing provider refused the call, so nothing changed. */
  `provider_refused`,
  /** The first request with this idempotency key is still running. */
  `IDEMPOTENCY_IN_PROGRESS`,
  /** The idempotency key is not one the API accepts. */
  `IDEMPOTENCY_KEY_INVALID`,
  /** The idempotency key was already used for a different request. */
  `IDEMPOTENCY_KEY_REUSED`,
  /** A group export file that cannot be imported; `details` lists its problems. */
  `IMPORT_REFUSED`,
  /** Something failed on the server; the message says nothing more. */
  `INTERNAL_ERROR`,
  /** A write whose `Origin` is not the web app's. */
  `REQUEST_ORIGIN_INVALID`,
  /** A data export was asked for again before a day passed; `details.export` is the last one. */
  `TOO_SOON`,
] as const

/** Every `reason` an error may carry. Closed: the compiler refuses one that is not listed. */
export type ErrorReason =
  | (typeof API_ERROR_REASONS)[number]
  | AccessErrorCode
  | typeof GUEST_REFUSAL_CODE
  | typeof SIGN_IN_LINK_ASKED_ELSEWHERE_CODE
  | ApiTokenErrorCode
  | BillingErrorCode
  | BlogErrorCode
  | CatalogErrorCode
  | ContactLinkErrorCode
  | GroupErrorCode
  | InvitationErrorCode
  | AttachmentErrorCode
  | NoteErrorCode
  | NotificationErrorCode
  | PictureErrorCode
  | PlanErrorCode
  | SubscriberTokenRefusal
  | TagErrorCode

/** The arktype type of every error body the API sends. Nothing else may ride in it. */
export const apiErrorBodySchema = type({
  "+": `reject`,
  error: {
    "+": `reject`,
    code: type.enumerated(...ERROR_CODES),
    message: `string`,
    "reason?": `string`,
    "fields?": fieldErrorsSchema,
    "details?": `unknown`,
    "requestId?": `string`,
  },
})

/** An error body; see {@link apiErrorBodySchema}. */
export type ApiErrorBody = typeof apiErrorBodySchema.infer

/** What an error body says: `code`, `message` and the optional parts. */
export type ApiErrorAnswer = ApiErrorBody[`error`]

/** {@link apiErrorBodySchema} that drops a part a newer server added and this client does not know. */
const readableErrorBody = type({
  error: {
    "+": `delete`,
    code: type.enumerated(...ERROR_CODES),
    message: `string`,
    "reason?": `string`,
    "fields?": fieldErrorsSchema,
    "details?": `unknown`,
    "requestId?": `string`,
  },
})

/**
 * The one reader of an error body for a client that calls `fetch` itself, such as one that needs
 * `details`, which `apiFetch` leaves out. `null` for a body in any other shape, such as a proxy's
 * page or an empty body: the answer is not the API's.
 *
 * @example
 * ```ts
 * const error = readApiError(await response.json().catch(() => null))
 * if (error?.reason === `IMPORT_REFUSED`) showProblems(error.details)
 * ```
 */
export function readApiError(body: unknown): ApiErrorAnswer | null {
  const read = readableErrorBody(body)
  return read instanceof type.errors ? null : read.error
}
