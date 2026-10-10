import { Hono } from "hono"
import type { Actor } from "@domain/identity"
import {
  CALL_ERROR_STATUS,
  createCallHandler,
  type OperationErrorMapper,
  type Operations,
} from "@spy4x/realtime/operations"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import { actorFromAuth } from "../cqrs/actor.ts"
import type { APIContext } from "../_types.ts"

export interface CallRouteDependencies {
  /** The table the socket serves too (`services/realtimeHub.ts`). */
  operations: Operations<Actor>
  /** Turns a handler's error into the typed one the client reads; the socket's own mapper. */
  mapError: OperationErrorMapper
  /** Called with every failure the route hides from the client. */
  log(...data: unknown[]): void
  /** The origin the browser sends; see `GroupsRouteDependencies.expectedOrigin`. */
  expectedOrigin?: string
  /** The path the route is mounted at. A call is `POST <basePath>/<name>`. */
  basePath?: string
}

/**
 * The HTTP adapter of the operations table, mounted at `/api/call`: `POST /api/call/<name>` runs
 * the operation the socket runs for the same name, so a page with no socket can do everything a
 * page with one can (ADR 003).
 *
 * It stands behind what every REST route stands behind: the session `parseAuth` read from the
 * cookie, and the `Origin` check on a write (every call is a `POST`, so every call is checked).
 * The library's handler then refuses a call whose `X-Realtime-User` is not the session's user and a
 * command without an `Idempotency-Key`, and the session gate on the buses decides whether the
 * session is strong enough. Answers follow the library's contract: `{ result }`, or
 * `{ error: { code, message, details? } }` with the socket's code.
 */
export function createCallRoute(dependencies: CallRouteDependencies): Hono<APIContext> {
  // The handler takes a web `Request`; the session `parseAuth` found travels beside it.
  const actors = new WeakMap<Request, Actor | null>()
  const handle = createCallHandler(dependencies.operations, {
    basePath: dependencies.basePath ?? "/api/call",
    authenticate: (request) => actors.get(request) ?? null,
    userIdOf: (actor) => actor.userId,
    mapError: dependencies.mapError,
    onError: (error, { name, requestId }) =>
      dependencies.log(`error: call ${name ?? "(no name)"} failed`, requestId, error),
  })
  const requireSameOrigin = createSameOriginMutationGuard<APIContext>({
    expectedOrigin: dependencies.expectedOrigin,
    // A signed-out caller is answered by the handler (`unauthorized`), not by this guard.
    requireSessionCookie: false,
    onReject: (c) =>
      c.json(
        { error: { code: "forbidden", message: "Request origin is invalid" } },
        CALL_ERROR_STATUS.forbidden as 403,
      ),
  })
  return new Hono<APIContext>().all("*", requireSameOrigin, (c) => {
    const auth = c.get("auth")
    actors.set(c.req.raw, auth ? actorFromAuth(auth) : null)
    return handle(c.req.raw)
  })
}
