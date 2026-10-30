import type { Actor } from "@domain/identity"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { Operation, Operations } from "@spy4x/realtime/operations"
import {
  type Clock,
  createStoreLimiter,
  failOpenLimiter,
  type RateLimiter,
  type RateLimitStore,
} from "@spy4x/platform/rate-limit"

/** The window of every operation budget: one minute. */
export const OPERATION_WINDOW_MS = 60_000

/** How many operations fit in one {@link OPERATION_WINDOW_MS}. */
export interface OperationBudget {
  /** Commands (writes) per signed-in person, from every device and both transports. */
  commands: number
  /** Queries (reads) per signed-in person. */
  queries: number
  /** Commands per client address, shared by every guest account on it. */
  guestCommands: number
  /** Queries per client address, shared by every guest account on it. */
  guestQueries: number
}

/**
 * The defaults, far above what a person clicking and typing sends: the page saves a note once per
 * pause, and opening a screen reads a handful of lists. They stop a script, not a fast person.
 */
export const OPERATION_BUDGET: Readonly<OperationBudget> = {
  commands: 120,
  queries: 600,
  guestCommands: 60,
  guestQueries: 300,
}

/** Who sent one call, as the adapter that received it knows. */
export interface OperationCaller {
  /** Whether the account is a guest (#224). */
  guest: boolean
  /** The client address as the guest-start limit counts it (`signUpClient`). */
  client: string
}

/** What the operation limits are built from. */
export interface OperationRateLimitSettings {
  budget: OperationBudget
  /** Builds the store of one limiter; `name` is its key prefix. See `AuthRateLimitSettings.store`. */
  store: (name: string) => RateLimitStore
  /** Told each time a store failure is let pass. */
  onStoreError: (error: unknown) => void
  /** Injected by tests. */
  clock?: Clock
}

/** The per-person budget of the operations table (#429). */
export interface OperationRateLimits {
  /**
   * `operations` with each call spending one unit of its caller's budget before it runs. Both
   * adapters serve the table this returns, so the socket and `POST /api/call` share one budget.
   * A call past the budget is refused `rate_limited` and its handler does not run, so a client may
   * send the same command again later.
   */
  limit(operations: Operations<Actor>): Operations<Actor>
  /**
   * Tells the budget who sent the call `actor` was built for. An adapter calls it on the fresh
   * actor of every call. An actor it was never called for is counted by its user id, under the
   * signed-in budget.
   */
  identify(actor: Actor, caller: OperationCaller): Actor
}

/**
 * Builds the operation budget: per user id for a signed-in person, per client address for a guest,
 * with commands and queries counted apart. A guest account costs nothing but a click, so a guest's
 * budget follows the address, which can start only 5 of them an hour (`GUEST_STARTS_PER_HOUR`):
 * opening more accounts gives no more writes.
 *
 * It fails open, as the normal auth limit does: an outage of Valkey must not stop every page.
 */
export function createOperationRateLimits(
  settings: OperationRateLimitSettings,
): OperationRateLimits {
  const { budget, store, onStoreError, clock } = settings
  const limiter = (name: string, limit: number) =>
    failOpenLimiter(
      createStoreLimiter(store(name), { windowMs: OPERATION_WINDOW_MS, limit, clock }),
      { limit, onError: onStoreError },
    )
  const limiters: Record<Operation<Actor>["kind"], { user: RateLimiter; guest: RateLimiter }> = {
    command: {
      user: limiter(`ratelimit-operation-command`, budget.commands),
      guest: limiter(`ratelimit-operation-guest-command`, budget.guestCommands),
    },
    query: {
      user: limiter(`ratelimit-operation-query`, budget.queries),
      guest: limiter(`ratelimit-operation-guest-query`, budget.guestQueries),
    },
  }
  const callers = new WeakMap<Actor, OperationCaller>()

  const spend = async (kind: Operation<Actor>["kind"], actor: Actor) => {
    const caller = callers.get(actor)
    const decision = caller?.guest
      ? await limiters[kind].guest.check(`operation-guest:${caller.client}`)
      : await limiters[kind].user.check(`operation-user:${actor.userId}`)
    if (!decision.allowed) {
      throw new RealtimeRequestError(`rate_limited`, `Too many requests. Wait a minute`)
    }
  }

  return {
    limit: (operations) =>
      Object.fromEntries(
        Object.entries(operations).map(([name, operation]) => [name, {
          kind: operation.kind,
          handle: async (call) => {
            await spend(operation.kind, call.actor)
            return await operation.handle(call)
          },
        }]),
      ),
    identify: (actor, caller) => {
      callers.set(actor, caller)
      return actor
    },
  }
}
