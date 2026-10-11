import { parseBoundedInteger } from "@spy4x/platform/universal/bounded-integer"

/** The largest page any list route returns. */
export const MAX_LIST_LIMIT = 100

/**
 * The `limit` of a request's query string: `fallback` when it is absent, otherwise a whole number
 * from 1 to {@link MAX_LIST_LIMIT}. Anything else throws the error `invalid` builds, so the route
 * answers in its feature's error shape.
 */
export function parseListLimit(
  value: string | undefined,
  fallback: number,
  invalid: () => Error,
): number {
  const limit = parseBoundedInteger(value, { fallback, max: MAX_LIST_LIMIT })
  if (limit === null) throw invalid()
  return limit
}
