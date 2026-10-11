import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { TagError, type TagErrorCode, TagVersionConflictError } from "@domain/tags"
import { AccessError } from "@domain/identity"
import type { APIContext } from "../../_types.ts"

export type TagFeatureErrorCode =
  | TagErrorCode
  | "AUTH_REQUIRED"
  | "INTERNAL_ERROR"
  | "MFA_REQUIRED"

/** A refusal the REST route makes itself, before anything is dispatched. */
export class TagFeatureError extends Error {
  constructor(
    public readonly code: TagFeatureErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "TagFeatureError"
  }
}

interface ErrorDefinition {
  status: ContentfulStatusCode
  message: string
}

const ERROR_DEFINITIONS: Record<TagFeatureErrorCode, ErrorDefinition> = {
  AUTH_REQUIRED: { status: 401, message: "Authentication required" },
  GROUP_NOT_FOUND: { status: 404, message: "Group not found" },
  ID_ALREADY_EXISTS: { status: 409, message: "Tag id is already in use" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  INVALID_REQUEST: { status: 400, message: "Request is invalid" },
  MFA_REQUIRED: { status: 401, message: "Complete MFA to access tags" },
  ROLE_INSUFFICIENT: { status: 403, message: "Only an editor can change tags" },
  TAG_NAME_TAKEN: { status: 409, message: "A tag with this name exists" },
  TAG_NOT_FOUND: { status: 404, message: "Tag not found" },
  VERSION_CONFLICT: { status: 409, message: "The tag was changed by someone else" },
}

/** The JSON error of the tag route. A version conflict also carries `currentVersion`. */
export function tagErrorResponse(c: Context<APIContext>, error: unknown): Response {
  const code: TagFeatureErrorCode =
    error instanceof TagFeatureError || error instanceof TagError || error instanceof AccessError
      ? error.code
      : "INTERNAL_ERROR"
  const definition = ERROR_DEFINITIONS[code]
  return c.json({
    error: {
      code,
      message: definition.message,
      requestId: c.get("requestId") || "unknown",
      ...(error instanceof TagVersionConflictError ? { currentVersion: error.currentVersion } : {}),
    },
  }, definition.status)
}
