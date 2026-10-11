import { RealtimeRequestError } from "@spy4x/realtime"

/**
 * What to tell the person about a failed call: the server's own message when it answered with one,
 * otherwise `fallback`, for an error that is not a server answer (a dropped socket, a bug).
 */
export function describeError(error: unknown, fallback: string): string {
  return error instanceof RealtimeRequestError ? error.message : fallback
}
