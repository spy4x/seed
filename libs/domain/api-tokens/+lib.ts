import { type } from "arktype"
import { hasUnsafeTextCharacters } from "@spy4x/platform/universal/text"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { type FieldErrors, fieldErrors } from "@spy4x/validation"

/**
 * Personal API tokens (#167): a person lets a script or another service use the API in one of
 * their groups, without their password. A token is shown once, when it is created; the server
 * keeps only a keyed hash of it. It carries a name, one group, read-only or read-write access, an
 * expiry and the time it was last used.
 *
 * A token acts as its owner, so it can do no more than the owner can in that group, and it never
 * reaches the account itself: the password, the address, deleting the account, sessions or other
 * tokens. `apps/api/routes/token-api.ts` is the only place that accepts one.
 */

/**
 * The start of every token, so a secret scanner recognises a leaked one and the person sees which
 * product it belongs to.
 */
export const API_TOKEN_PREFIX = "tpl_"

/** The random part after {@link API_TOKEN_PREFIX}: 128 bits as unpadded base64url. */
const API_TOKEN_PATTERN = /^tpl_[A-Za-z0-9_-]{22}$/

/** The longest token name, in characters, after trimming. */
export const API_TOKEN_NAME_MAX_LENGTH = 60

/** The most live tokens one person may hold: a request for another is refused. */
export const API_TOKENS_MAX = 25

/** The lifetimes a person may choose, in days; `null` is "never expires". */
export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const

/** The lifetime offered first. */
export const API_TOKEN_DEFAULT_EXPIRY_DAYS = 90

/**
 * How long an expired token's row is kept, in days, before the worker deletes it. The token itself
 * is refused from the moment it expires.
 */
export const API_TOKEN_PURGE_GRACE_DAYS = 30

/** What a token may do in its group. */
export enum ApiTokenAccess {
  /** Lists and reads. */
  READ = 1,
  /** Reads and writes, as far as the owner's role in the group allows. */
  WRITE = 2,
}

/** One token as its owner's list shows it. The secret is never part of it. */
export interface ApiToken {
  /** A UUID. */
  id: string
  name: string
  groupId: string
  /** The group's name, for the list. */
  groupName: string
  access: ApiTokenAccess
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601, or `null` for a token that never expires. */
  expiresAt: string | null
  /** ISO 8601, to within a few minutes; `null` until the token is first used. */
  lastUsedAt: string | null
}

/** The answer of `GET /api/tokens`: the live tokens, newest first. */
export interface ApiTokenListResponse {
  tokens: ApiToken[]
}

/** The answer of `POST /api/tokens`: the token, and the secret that is never shown again. */
export interface ApiTokenCreateResponse {
  token: ApiToken
  secret: string
}

/**
 * `POST /api/tokens`: the token's name, its group, what it may do, how many days it lives (`null`
 * for never) and the person's current password, which a stolen session does not have (#293). The
 * field names are the form's.
 */
export const apiTokenCreateRequestSchema = type({
  // The length is checked in characters by `parseApiTokenCreateRequest`: arktype counts UTF-16
  // units.
  name: "string",
  groupId: type("string").narrow((value, ctx) => isUuid(value) || ctx.mustBe("a UUID")),
  access: type.enumerated(ApiTokenAccess.READ, ApiTokenAccess.WRITE),
  expiresInDays: type.enumerated(...API_TOKEN_EXPIRY_DAYS, null),
  // No longer than a password can be; whether it is the right one is the API's to say.
  password: "1 <= string <= 50",
  "+": "reject",
})
export type ApiTokenCreateRequest = typeof apiTokenCreateRequestSchema.infer

export type ApiTokenErrorCode =
  /** The request body is not a valid token request. */
  | "INVALID_REQUEST"
  /** The password sent with a create is not the person's current one. */
  | "PASSWORD_INVALID"
  /** The person is not a member of the group, or it is gone. */
  | "GROUP_NOT_FOUND"
  /** The person has no such live token: another person's token gets the same answer. */
  | "TOKEN_NOT_FOUND"
  /** The person already holds {@link API_TOKENS_MAX} live tokens. */
  | "TOO_MANY_TOKENS"
  /** The bearer token is missing, malformed, unknown, revoked or expired: one answer for all. */
  | "TOKEN_INVALID"
  /** The token may not do this: another group, a write with a read-only token, or another API. */
  | "TOKEN_SCOPE"

/** A refusal about API tokens; `code` maps to an HTTP status in the routes. */
export class ApiTokenError extends Error {
  constructor(
    public readonly code: ApiTokenErrorCode,
    message: string,
    /** Each failed field's code and rule, when a schema refused the request. */
    public readonly fields?: FieldErrors,
  ) {
    super(message)
    this.name = "ApiTokenError"
  }
}

/**
 * Reads a create request with its name trimmed, or throws `INVALID_REQUEST`: a name that is empty,
 * longer than {@link API_TOKEN_NAME_MAX_LENGTH} characters or holds a character a one-line name
 * must not (`hasUnsafeTextCharacters`: a line break or another control character, NUL among them,
 * an invisible or text-direction character, a lone surrogate) is refused. The name goes into the
 * owner's mail and the audit trail as it is.
 */
export function parseApiTokenCreateRequest(body: unknown): ApiTokenCreateRequest {
  const result = apiTokenCreateRequestSchema(body)
  if (result instanceof type.errors) {
    throw new ApiTokenError("INVALID_REQUEST", result.summary, fieldErrors(result))
  }
  const name = result.name.trim()
  const length = Array.from(name).length
  const failed = length < 1
    ? { code: "required" }
    : length > API_TOKEN_NAME_MAX_LENGTH
    ? { code: "maxLength", values: { rule: API_TOKEN_NAME_MAX_LENGTH } }
    : hasUnsafeTextCharacters(name)
    ? { code: "unsafeCharacters" }
    : null
  if (failed) {
    throw new ApiTokenError(
      "INVALID_REQUEST",
      `Name must be 1 to ${API_TOKEN_NAME_MAX_LENGTH} characters`,
      { name: failed },
    )
  }
  return { ...result, name }
}

/** Whether `value` has the shape of a token: the prefix and 22 base64url characters. */
export function isApiTokenFormat(value: string): boolean {
  return API_TOKEN_PATTERN.test(value)
}

/** When a token created at `now` expires, or `null` when it never does. */
export function apiTokenExpiresAt(now: Date, days: number | null): Date | null {
  return days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60_000)
}

// The operator area's API tokens (#427): every token across people, and one person's.

/** Where a token stands for the operator: it works, its time ran out, or it was revoked. */
export type AdminApiTokenState = "live" | "expired" | "revoked"

/** Every {@link AdminApiTokenState}, in the order the page's filter shows them. */
export const ADMIN_API_TOKEN_STATES: readonly AdminApiTokenState[] = ["live", "expired", "revoked"]

/** How many tokens one page of the operator's list holds. */
export const ADMIN_API_TOKENS_PAGE_SIZE = 25

/** The most tokens one person's tab shows, newest first: live ones and those not purged yet. */
export const ADMIN_USER_API_TOKENS_LIMIT = 100

/** The person a token acts as, as the operator's list names them. */
export interface AdminApiTokenOwner {
  id: number
  firstName: string
  lastName: string
  /** The address the person signs in with, or `null` when no key holds one. */
  email: string | null
}

/**
 * One token as the operator sees it: what it may do, where it stands and whose it is. Never its
 * secret or the hash of it.
 */
export interface AdminApiToken {
  /** A UUID. */
  id: string
  name: string
  groupId: string
  /** The group's name, or `null` when the group is gone. */
  groupName: string | null
  access: ApiTokenAccess
  state: AdminApiTokenState
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601, or `null` for a token that never expires. */
  expiresAt: string | null
  /** ISO 8601, to within a few minutes; `null` until the token is first used. */
  lastUsedAt: string | null
  /** ISO 8601, or `null` while the token is not revoked. */
  revokedAt: string | null
  owner: AdminApiTokenOwner
}

/** How many tokens of every state there are, whatever the filter. */
export type AdminApiTokenCounts = Record<AdminApiTokenState, number>

/** The answer of `GET /api/admin/api-tokens`. */
export interface AdminApiTokenListResponse {
  tokens: AdminApiToken[]
  /** How many tokens match the filter. */
  total: number
  page: number
  pageSize: number
  counts: AdminApiTokenCounts
}

/** The answer of `GET /api/admin/users/:id/api-tokens`: the person's tokens, newest first. */
export interface AdminUserApiTokensResponse {
  tokens: AdminApiToken[]
}

/** What the operator's token list shows: one state or every one, and which page. */
export interface AdminApiTokenFilter {
  state: AdminApiTokenState | null
  page: number
}

/** The list with no filter: every token, page 1. */
export const ADMIN_API_TOKEN_NO_FILTER: AdminApiTokenFilter = { state: null, page: 1 }

/**
 * The filter in the page's address or the API's query (`?state=live&page=2`). Anything it does not
 * know reads as no filter and page 1, so a hand-edited address never fails.
 */
export function parseAdminApiTokenFilter(params: URLSearchParams): AdminApiTokenFilter {
  const rawState = params.get("state")
  const state = ADMIN_API_TOKEN_STATES.find((known) => known === rawState) ?? null
  const pageNumber = Number(params.get("page"))
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 100_000
    ? pageNumber
    : 1
  return { state, page }
}

/** The query of `filter`, without the parts that are the default; `""` for the plain list. */
export function adminApiTokenFilterQuery(filter: AdminApiTokenFilter): string {
  const params = new URLSearchParams()
  if (filter.state) params.set("state", filter.state)
  if (filter.page > 1) params.set("page", String(filter.page))
  return params.toString()
}
