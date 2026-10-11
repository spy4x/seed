import type { Context } from "hono"
import { readJsonBody } from "@spy4x/server/http/bounded-body"

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
 * Read the JSON body of a feature route: the request must declare `application/json`, and any
 * failure to read it (too large, stalled, not JSON) is the feature's own `INVALID_REQUEST`, built
 * by `invalid` from the message, so the route answers in its feature's error shape.
 */
export async function readFeatureJson(
  c: Context,
  invalid: (message: string) => Error,
): Promise<unknown> {
  if (!c.req.header("content-type")?.toLowerCase().includes("application/json")) {
    throw invalid("Content type must be JSON")
  }
  try {
    return await readApiJson(c)
  } catch {
    throw invalid("Request body must be JSON")
  }
}
