import { EventBus } from "@spy4x/platform/cqrs"
import type { Event, EventConstructor } from "@spy4x/platform/cqrs"
import { log } from "./log.ts"
import { createCounter } from "@spy4x/platform/universal/metrics"

/** Counts every listener that threw, by event and listener name. */
export const eventListenerFailures = createCounter(
  "event_listener_failures_total",
  "Event listeners that threw, by event and listener name",
)

/** Carries the failing listener's name, which the bus does not pass to its error handler. */
class ListenerFailure extends Error {
  constructor(readonly listener: string, readonly original: unknown) {
    super(`listener ${listener} failed`)
  }
}

function reportListenerFailure(eventClass: EventConstructor<Event<unknown>>, error: unknown): void {
  const failure = error instanceof ListenerFailure ? error : new ListenerFailure("unknown", error)
  const cause = failure.original
  eventListenerFailures.increment({ event: eventClass.name, listener: failure.listener })
  // "log" prefixes the request id when the event was raised inside a request.
  log(JSON.stringify({
    level: "error",
    message: "event listener failed",
    event: eventClass.name,
    listener: failure.listener,
    error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
  }))
}

export const eventBus = new EventBus(reportListenerFailure)

/**
 * Subscribes `handler` to `eventClass`, so that a failure is reported with the handler's name.
 * Every listener is either best-effort (a failure is logged and counted, nothing retries it) or
 * durable (its work survives a failure); the choice and its reason are written where it is
 * registered, in `cqrs/+init.ts`.
 */
export function subscribe<T extends Event<unknown>>(
  eventClass: EventConstructor<T>,
  handler: (event: T) => void | Promise<void>,
): () => void {
  return eventBus.on(eventClass, async (event) => {
    try {
      await handler(event)
    } catch (error) {
      throw new ListenerFailure(handler.name || "anonymous", error)
    }
  })
}
