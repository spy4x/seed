import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { NotificationError, type NotificationErrorCode } from "@domain/notifications"
import { AccessError } from "@domain/identity"
import type { APIContext } from "../../_types.ts"
import { codeForStatus, errorResponse } from "../../services/error-response.ts"

export type NotificationFeatureErrorCode =
  | NotificationErrorCode
  | "AUTH_REQUIRED"
  | "INTERNAL_ERROR"
  | "MFA_REQUIRED"
  | "REQUEST_ORIGIN_INVALID"

/** A refusal the REST route makes itself, before anything is dispatched. */
export class NotificationFeatureError extends Error {
  constructor(
    public readonly code: NotificationFeatureErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "NotificationFeatureError"
  }
}

const ERROR_DEFINITIONS: Record<
  NotificationFeatureErrorCode,
  { status: ContentfulStatusCode; message: string }
> = {
  AUTH_REQUIRED: { status: 401, message: "Authentication required" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  INVALID_CURSOR: { status: 400, message: "Notification cursor is invalid" },
  INVALID_REQUEST: { status: 400, message: "Request is invalid" },
  MFA_REQUIRED: { status: 401, message: "Complete MFA to read notifications" },
  NOTIFICATION_NOT_FOUND: { status: 404, message: "Notification not found" },
  REQUEST_ORIGIN_INVALID: { status: 403, message: "Request origin is invalid" },
}

/** The JSON error of a notification route. */
export function notificationErrorResponse(c: Context<APIContext>, error: unknown): Response {
  const code: NotificationFeatureErrorCode =
    error instanceof NotificationFeatureError || error instanceof NotificationError ||
      error instanceof AccessError
      ? error.code
      : "INTERNAL_ERROR"
  const definition = ERROR_DEFINITIONS[code]
  return errorResponse(c, codeForStatus(definition.status), {
    message: definition.message,
    reason: code,
    status: definition.status,
  })
}
