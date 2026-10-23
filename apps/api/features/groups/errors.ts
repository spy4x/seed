import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { GroupError, GroupErrorCode, GroupImportError } from "@domain/groups"
import { AccessError } from "@domain/identity"
import { PlanError, type PlanErrorCode, toPlanRefusal } from "@domain/billing"
import { TagError } from "@domain/tags"
import { IdempotencyError } from "@spy4x/server/idempotency"
import { APIContext } from "../../_types.ts"
import { PasswordLockedError, passwordLockedMessage } from "../../services/password-locked.ts"
import { codeForStatus, errorResponse } from "../../services/error-response.ts"

export type GroupFeatureErrorCode =
  | GroupErrorCode
  | "AUTH_REQUIRED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IMPORT_REFUSED"
  | "INTERNAL_ERROR"
  | "MFA_REQUIRED"
  | PlanErrorCode
  | "REQUEST_ORIGIN_INVALID"
  | "TAG_LIMIT_REACHED"

export class GroupFeatureError extends Error {
  constructor(
    public readonly code: GroupFeatureErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "GroupFeatureError"
  }
}

interface ErrorDefinition {
  status: ContentfulStatusCode
  message: string
}

const ERROR_DEFINITIONS: Record<GroupFeatureErrorCode, ErrorDefinition> = {
  AUTH_REQUIRED: { status: 401, message: "Authentication required" },
  GROUP_NOT_FOUND: { status: 404, message: "Group not found" },
  ID_ALREADY_EXISTS: { status: 409, message: "Group id is already in use" },
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    message: "The first request with this idempotency key is still running",
  },
  IDEMPOTENCY_KEY_INVALID: { status: 400, message: "Idempotency key is invalid" },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    message: "Idempotency key was already used for a different request",
  },
  IMPORT_REFUSED: { status: 422, message: "The file cannot be imported" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  INVALID_CURSOR: { status: 400, message: "Group list cursor is invalid" },
  INVALID_REQUEST: { status: 400, message: "Request is invalid" },
  LAST_GROUP: { status: 409, message: "A person must keep at least one group" },
  LAST_OWNER: { status: 409, message: "The owner keeps the group and their role" },
  GROUP_SUBSCRIBED: {
    status: 409,
    message: "Cancel the group's subscription in the billing portal before deleting it",
  },
  MEMBER_NOT_FOUND: { status: 404, message: "Member not found" },
  NAME_MISMATCH: { status: 400, message: "Type the group's name exactly as it is shown" },
  NOTHING_TO_MOVE: { status: 409, message: "The group has no data to move" },
  PASSWORD_INVALID: { status: 400, message: "The password is incorrect" },
  PLAN_FEATURE_MISSING: { status: 402, message: "The group's plan does not include this" },
  PLAN_LIMIT_REACHED: { status: 402, message: "The group has reached its plan's limit" },
  MFA_REQUIRED: { status: 401, message: "Complete MFA to access groups" },
  REQUEST_ORIGIN_INVALID: { status: 403, message: "Request origin is invalid" },
  ROLE_INSUFFICIENT: { status: 403, message: "Group role is insufficient" },
  SAME_GROUP: { status: 400, message: "The data is in that group already" },
  TAG_LIMIT_REACHED: {
    status: 409,
    message: "The other group has no room for this group's tags",
  },
  SUBSCRIPTION_RENEWS: {
    status: 409,
    message: "Cancel the group's subscription in the billing portal before transferring it",
  },
  USER_NOT_ACTIVE: { status: 401, message: "Authentication required" },
}

const IDEMPOTENCY_CODES: Record<IdempotencyError["code"], GroupFeatureErrorCode> = {
  INVALID_KEY: "IDEMPOTENCY_KEY_INVALID",
  KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  IN_PROGRESS: "IDEMPOTENCY_IN_PROGRESS",
  INVALID_COMMAND: "INTERNAL_ERROR",
}

export function groupErrorResponse(c: Context<APIContext>, error: unknown): Response {
  // Handing a group over asks for the password, which the account's lock may refuse to check
  // (#406): the refusal says when to try again.
  if (error instanceof PasswordLockedError) {
    c.header("Retry-After", String(Math.ceil(error.retryAfterMs / 1000)))
    return errorResponse(c, `rate_limited`, {
      message: passwordLockedMessage(error.retryAfterMs),
      reason: `PASSWORD_LOCKED`,
    })
  }
  const code = error instanceof GroupFeatureError || error instanceof GroupError ||
      error instanceof AccessError || error instanceof PlanError ||
      error instanceof GroupImportError
    ? error.code
    : error instanceof IdempotencyError
    ? IDEMPOTENCY_CODES[error.code]
    // Moving all data creates the notes' tags in the other group, which may be full of tags.
    : error instanceof TagError && error.code === "TAG_LIMIT_REACHED"
    ? error.code
    : "INTERNAL_ERROR"
  const definition = ERROR_DEFINITIONS[code]
  return errorResponse(c, codeForStatus(definition.status), {
    message: definition.message,
    reason: code,
    status: definition.status,
    // A plan refusal names the feature or cap, so the client draws the upgrade prompt from it; a
    // refused file says what is wrong with it, so the import page can list it.
    details: error instanceof PlanError
      ? toPlanRefusal(error)
      : error instanceof GroupImportError
      ? { problems: error.problems, total: error.total }
      : undefined,
  })
}
