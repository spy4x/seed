import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { GroupError, InvitationError, type InvitationErrorCode } from "@domain/groups"
import type { APIContext } from "../../_types.ts"
import { groupErrorResponse } from "./errors.ts"
import { codeForStatus, errorResponse } from "../../services/error-response.ts"

const INVITATION_STATUSES: Record<InvitationErrorCode, ContentfulStatusCode> = {
  ADDRESS_NOT_PROVEN: 403,
  ALREADY_MEMBER: 409,
  INVITATION_ALREADY_USED: 409,
  INVITATION_EXPIRED: 410,
  INVITATION_NOT_FOUND: 404,
  INVITATION_REVOKED: 410,
  INVITATION_USED_UP: 410,
  INVITATION_WRONG_ACCOUNT: 403,
  SEAT_PRICE_NOT_ACCEPTED: 400,
}

/** Group refusals whose own message says what to change, so it reaches the person as written. */
const TOLD_GROUP_ERRORS: Partial<Record<GroupError["code"], ContentfulStatusCode>> = {
  INVALID_REQUEST: 400,
  ROLE_INSUFFICIENT: 403,
}

/**
 * The answer to a failed invitation request. An invitation refusal, a malformed request and a role
 * the creator may not give keep their own message, which says what happened in words the person
 * understands; anything else is answered as a group error.
 */
export function invitationErrorResponse(c: Context<APIContext>, error: unknown): Response {
  const status = error instanceof InvitationError
    ? INVITATION_STATUSES[error.code]
    : error instanceof GroupError
    ? TOLD_GROUP_ERRORS[error.code]
    : undefined
  if (!status) return groupErrorResponse(c, error)
  const { code, message } = error as InvitationError | GroupError
  return errorResponse(c, codeForStatus(status), { message, reason: code, status })
}
