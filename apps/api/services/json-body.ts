import type { Context } from "hono"
import { JSON_BODY_WRONG_TYPE, readJsonBody } from "@spy4x/server/http/bounded-body"

/**
 * The largest JSON body any API route accepts. The largest real one, a push subscription, is well
 * under 1 KiB; the library's 5 MiB default is far more than any route needs.
 */
export const MAX_JSON_BODY_BYTES = 64 * 1024

/**
 * Read the request's JSON body, capped at {@link MAX_JSON_BODY_BYTES}. Throws Hono's
 * `HTTPException`: 413 when the body is too large, 408 when it stalls, 400 when it is not JSON.
 */
export function readApiJson(c: Context): Promise<unknown> {
  return readJsonBody(c, { maxBytes: MAX_JSON_BODY_BYTES })
}

/**
 * Read the JSON body of a feature route with the library's `readJsonBody`, under this API's rules:
 * the body is capped at {@link MAX_JSON_BODY_BYTES}, the request must declare `application/json`,
 * and every refusal is the feature's own `INVALID_REQUEST`, built by `invalid` from the message, so
 * the route answers in its feature's error shape.
 *
 * The library rethrows a body stream that breaks while it is read (a phone that loses signal
 * during a save), which a route would answer with 500. That is the client's failure, not the
 * server's, so it is `invalid` here too.
 */
export async function readFeatureJson(
  c: Context,
  invalid: (message: string) => Error,
): Promise<unknown> {
  let refused: Error | undefined
  try {
    return await readJsonBody(c, {
      maxBytes: MAX_JSON_BODY_BYTES,
      requireJsonContentType: true,
      toError: ({ status }) =>
        refused = invalid(status === 415 ? JSON_BODY_WRONG_TYPE : "Request body must be JSON"),
    })
  } catch (_error) {
    throw refused ?? invalid("Request body must be JSON")
  }
}
