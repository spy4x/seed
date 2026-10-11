import { RealtimeRequestError } from "@spy4x/realtime"

/**
 * Wraps an aggregate's error classifier so a write answered `unauthorized` stays queued. The
 * session ended, belongs to someone else or owes a second factor (the server answers all three as
 * `unauthorized`): the write was not judged, so it waits for its owner (spy4x/ts-libs#535 asks the
 * library to do this). Every offline-writable aggregate wraps its classifier here, so the rule
 * lives in one place.
 */
export function keepQueuedWhenUnauthorized<Result extends { kind: string }>(
  classify: (error: unknown) => Result,
): (error: unknown) => Result | { kind: "unreachable" } {
  return (error) => {
    if (error instanceof RealtimeRequestError && error.code === "unauthorized") {
      return { kind: "unreachable" }
    }
    return classify(error)
  }
}
