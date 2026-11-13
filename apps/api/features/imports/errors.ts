import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { ImportError, type ImportErrorCode } from "@domain/imports"
import { AccessError } from "@domain/identity"
import type { APIContext } from "../../_types.ts"
import { codeForStatus, errorResponse, fieldsOf } from "../../services/error-response.ts"

export type ImportFeatureErrorCode =
  | ImportErrorCode
  | "AUTH_REQUIRED"
  | "INTERNAL_ERROR"
  | "MFA_REQUIRED"
  | "REQUEST_ORIGIN_INVALID"

/** A refusal the REST route makes itself, before anything is dispatched. */
export class ImportFeatureError extends Error {
  constructor(
    public readonly code: ImportFeatureErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "ImportFeatureError"
  }
}

interface ErrorDefinition {
  status: ContentfulStatusCode
  message: string
}

const ERROR_DEFINITIONS: Record<ImportFeatureErrorCode, ErrorDefinition> = {
  AUTH_REQUIRED: { status: 401, message: "Authentication required" },
  GROUP_NOT_FOUND: { status: 404, message: "Group not found" },
  IMPORT_REFUSED: { status: 422, message: "The file cannot be imported" },
  FILE_TOO_LARGE: { status: 413, message: "The file is too large" },
  ITEM_NOT_FOUND: { status: 404, message: "Import not found" },
  VERSION_CONFLICT: { status: 409, message: "The import cannot take this step now" },
  INTERNAL_ERROR: { status: 500, message: "Internal server error" },
  INVALID_REQUEST: { status: 400, message: "Request is invalid" },
  MFA_REQUIRED: { status: 401, message: "Complete MFA to import" },
  REQUEST_ORIGIN_INVALID: { status: 403, message: "Request origin is invalid" },
  ROLE_INSUFFICIENT: { status: 403, message: "Your role cannot import these records" },
}

/**
 * The JSON error of the import route. An `ImportError` keeps its own message, which says in words
 * what to change ("Choose the column that holds Title"); any other refusal gets its code's.
 */
export function importErrorResponse(c: Context<APIContext>, error: unknown): Response {
  const code: ImportFeatureErrorCode = error instanceof ImportFeatureError ||
      error instanceof ImportError || error instanceof AccessError
    ? error.code
    : "INTERNAL_ERROR"
  const definition = ERROR_DEFINITIONS[code]
  return errorResponse(c, codeForStatus(definition.status), {
    message: error instanceof ImportError ? error.message : definition.message,
    reason: code,
    status: definition.status,
    fields: fieldsOf(error),
  })
}
