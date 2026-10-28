import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { BillingError, type BillingErrorCode } from "@domain/billing"
import { AccessError } from "@domain/identity"
import { IdempotencyError } from "@spy4x/server/idempotency"
import type { APIContext } from "../../_types.ts"
import { codeForStatus, errorResponse } from "../../services/error-response.ts"

export type BillingFeatureErrorCode =
  | BillingErrorCode
  | "AUTH_REQUIRED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR"
  | "MFA_REQUIRED"
  | "REQUEST_ORIGIN_INVALID"

/** A refusal the REST route makes itself, before anything is dispatched. */
export class BillingFeatureError extends Error {
  constructor(
    public readonly code: BillingFeatureErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "BillingFeatureError"
  }
}

interface ErrorDefinition {
  status: ContentfulStatusCode
  message: string
}

const ERROR_DEFINITIONS: Record<BillingFeatureErrorCode, ErrorDefinition> = {
  ALREADY_SUBSCRIBED: { status: 409, message: "The group already has a paid plan" },
  AUTH_REQUIRED: { status: 401, message: "Authentication required" },
  BILLING_DISABLED: { status: 404, message: "Billing is off" },
  GROUP_NOT_FOUND: { status: 404, message: "Group not found" },
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    message: "The first request with this idempotency key is still running",
  },
  IDEMPOTENCY_KEY_INVALID: { status: 400, message: "Idempotency key is invalid" },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    message: "Idempotency key was already used for a different request",
  },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  INVALID_REQUEST: { status: 400, message: "Request is invalid" },
  MFA_REQUIRED: { status: 401, message: "Complete MFA to manage billing" },
  NO_SUBSCRIPTION: { status: 409, message: "The group has no subscription to manage" },
  PROVIDER_ERROR: { status: 502, message: "The payment provider did not answer; try again" },
  REQUEST_ORIGIN_INVALID: { status: 403, message: "Request origin is invalid" },
  ROLE_INSUFFICIENT: { status: 403, message: "Only the owner can manage the group's billing" },
  UNKNOWN_PLAN: { status: 400, message: "No such plan" },
}

const IDEMPOTENCY_CODES: Record<IdempotencyError["code"], BillingFeatureErrorCode> = {
  INVALID_KEY: "IDEMPOTENCY_KEY_INVALID",
  KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  IN_PROGRESS: "IDEMPOTENCY_IN_PROGRESS",
  INVALID_COMMAND: "INTERNAL_ERROR",
}

/** The JSON error of a billing route. */
export function billingErrorResponse(c: Context<APIContext>, error: unknown): Response {
  const code: BillingFeatureErrorCode =
    error instanceof BillingFeatureError || error instanceof BillingError ||
      error instanceof AccessError
      ? error.code
      : error instanceof IdempotencyError
      ? IDEMPOTENCY_CODES[error.code]
      : "INTERNAL_ERROR"
  const definition = ERROR_DEFINITIONS[code]
  return errorResponse(c, codeForStatus(definition.status), {
    message: definition.message,
    reason: code,
    status: definition.status,
  })
}
