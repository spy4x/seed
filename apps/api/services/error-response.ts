import type { Context, MiddlewareHandler } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { HTTPException } from "hono/http-exception"
import type { ArkErrors } from "arktype"
import { CALL_ERROR_STATUS } from "@spy4x/realtime/operations"
import { isRecord } from "@spy4x/platform/universal/is-record"
import { type FieldErrors, fieldErrors } from "@spy4x/validation"
import type { ApiErrorBody, ErrorCode, ErrorReason } from "@domain/errors"

/** What an error answer says besides its code. */
export interface ErrorResponseOptions {
  /** The English sentence a screen shows until it translates `reason ?? code`. */
  message: string
  /** The feature's finer name for the refusal. */
  reason?: ErrorReason
  /** Each failed field's code and rule, keyed by path. */
  fields?: FieldErrors
  /** Structured, JSON-safe detail a client acts on, such as the plan a refusal names. */
  details?: unknown
  /** The HTTP status, when it is not the one the code stands for (`CALL_ERROR_STATUS`). */
  status?: ContentfulStatusCode
}

/** The JSON body of an error answer, with the request's id when the request log gave it one. */
export function errorBody(
  c: Context,
  code: ErrorCode,
  options: ErrorResponseOptions,
): ApiErrorBody {
  const { message, reason, fields, details } = options
  const requestId = (c as Context<{ Variables: { requestId?: string } }>).get(`requestId`)
  return {
    error: {
      code,
      message,
      ...(reason !== undefined ? { reason } : {}),
      ...(fields !== undefined ? { fields } : {}),
      ...(details !== undefined ? { details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  }
}

/**
 * The one way an API route answers an error (docs/api-errors.md): `{ error: { code, message,
 * reason?, fields?, details?, requestId? } }`, with the status `code` stands for unless `status`
 * says otherwise.
 *
 * @example
 * ```ts
 * return errorResponse(c, `not_found`, { message: `Group not found`, reason: `GROUP_NOT_FOUND` })
 * ```
 */
export function errorResponse(
  c: Context,
  code: ErrorCode,
  options: ErrorResponseOptions,
): Response {
  const status = options.status ?? CALL_ERROR_STATUS[code] as ContentfulStatusCode
  return c.json(errorBody(c, code, options), status)
}

/**
 * A body a schema refused: `bad_request` with reason `validation` and every failed field. The
 * message is arktype's summary unless the route has its own sentence.
 */
export function validationResponse(
  c: Context,
  errors: ArkErrors,
  options: { message?: string; status?: ContentfulStatusCode } = {},
): Response {
  return errorResponse(c, `bad_request`, {
    message: options.message ?? errors.summary,
    reason: `validation`,
    fields: fieldErrors(errors),
    ...(options.status !== undefined ? { status: options.status } : {}),
  })
}

/** The fields a domain error carries, from a schema or the feature's own check, or `undefined`. */
export function fieldsOf(error: unknown): FieldErrors | undefined {
  const fields = (error as { fields?: FieldErrors } | null)?.fields
  return error instanceof Error && fields !== undefined ? fields : undefined
}

/** The code an HTTP status stands for, for an answer that knows only its status. */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return `unauthorized`
    case 402:
    case 403:
      return `forbidden`
    case 404:
    case 410:
      return `not_found`
    case 408:
    case 504:
      return `timeout`
    case 409:
      return `conflict`
    case 429:
      return `rate_limited`
  }
  return status >= 500 ? `internal` : `bad_request`
}

/** The text of an answer to an error no route handled: it names nothing about the failure. */
export const UNEXPECTED_ERROR_MESSAGE = `Request failed`

/**
 * The app's last word on an error, in the one shape: an `HTTPException` (a body too large, not
 * JSON, or too slow) keeps its status, message and headers; anything else is `internal` with a
 * sentence that says nothing about the failure.
 */
export function unhandledErrorResponse(c: Context, error: unknown): Response {
  if (!(error instanceof HTTPException)) {
    return errorResponse(c, `internal`, { message: UNEXPECTED_ERROR_MESSAGE })
  }
  const response = errorResponse(c, codeForStatus(error.status), {
    message: error.message || UNEXPECTED_ERROR_MESSAGE,
    status: error.status,
  })
  // The library asks to close the connection after a body too large; keep that.
  const connection = error.getResponse().headers.get(`connection`)
  if (connection) response.headers.set(`connection`, connection)
  return response
}

/**
 * Turns the `{ error: "…" }` refusals of the shared libraries' middleware (the session guards,
 * the `Origin` checks, the proxy check, the rate limits) into the one error body, keeping their
 * status, message and headers such as `Retry-After`. It looks only at an answer of 400 or more
 * that is JSON, so a success costs nothing. The app's own routes answer with
 * {@link errorResponse} and never need it.
 */
export const libraryRefusals: MiddlewareHandler = async (c, next) => {
  await next()
  const { status, headers } = c.res
  if (status < 400 || !headers.get(`content-type`)?.startsWith(`application/json`)) return
  const body: unknown = await c.res.clone().json().catch(() => undefined)
  if (!isRecord(body) || typeof body.error !== `string`) return
  const message = body.error
  // Setting `c.res` keeps the old answer's headers on the new one.
  c.res = errorResponse(c, codeForStatus(status), {
    message,
    status: status as ContentfulStatusCode,
  })
}
