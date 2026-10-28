import { type } from "arktype"
import { type ApiErrorBody, apiErrorBodySchema } from "@domain/errors"

/**
 * The `error` of an API answer, after checking the whole body against the one error type
 * (docs/api-errors.md). A body of any other shape fails the test that read it, so every test of
 * an error path also proves the shape.
 */
export async function apiError(response: Response): Promise<ApiErrorBody["error"]> {
  return checkedError(await response.json())
}

/** {@link apiError} for a body already read. */
export function checkedError(body: unknown): ApiErrorBody["error"] {
  const checked = apiErrorBodySchema(body)
  if (checked instanceof type.errors) {
    throw new Error(`Not the API's error body (${checked.summary}): ${JSON.stringify(body)}`)
  }
  return checked.error
}
