/// <reference lib="deno.ns" />
import { Hono } from "hono"
import type { Context } from "hono"
import { adaptWebSocket } from "@spy4x/realtime"
import { isBoundToUser } from "@spy4x/realtime/operations"
import { createSameOriginUpgradeGuard } from "@spy4x/server/http/same-origin"
import { SOCKET_USER_PROTOCOL } from "@domain/identity"
import type { APIContext } from "../_types.ts"
import type { Realtime } from "./realtime.ts"
import type { AppAuthState, SignIn } from "./sign-in.ts"
import { errorResponse } from "./error-response.ts"

/** The `user.<id>` subprotocol the handshake offered, or `null` when it offered none. */
export function offeredUserProtocol(request: Request): string | null {
  const offered = request.headers.get("sec-websocket-protocol")?.split(",") ?? []
  return offered.map((value) => value.trim()).find((value) =>
    value.startsWith(SOCKET_USER_PROTOCOL)
  ) ?? null
}

/** What {@link createSocketRoute} needs from the app. */
export interface SocketRouteDependencies {
  /** The session guards. `isAuthenticated2FA` runs before the Origin check. */
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  /**
   * The web app's origin, such as `https://app.example.com`. Behind the TLS-terminating proxy the
   * API sees `http://…`, so it comes from configuration, never from the request.
   */
  expectedOrigin: string
  /** Where an accepted socket goes. */
  realtime: Pick<Realtime, "attach">
  /** Opens the socket and hands it to {@link realtime}. Defaults to `Deno.upgradeWebSocket`. */
  upgrade?: (c: Context<APIContext>, auth: AppAuthState) => Response
}

/**
 * Builds the `GET /` WebSocket route. This is the only place a socket is authenticated:
 *
 * 1. `isAuthenticated2FA` reads the session cookie the handshake carried, with the same rules as a
 *    REST request: no session is 401, and a session that still owes its second factor is 401 too.
 * 2. `Origin` must equal the web app's origin, or the upgrade is refused with 403. A browser
 *    attaches the session cookie to a socket that a page on a sibling subdomain opens, and that
 *    page can read every message; `SameSite=Lax` does not stop it, and CORS does not govern
 *    handshakes.
 * 3. The handshake names the user the page was started for, as the subprotocol `user.<id>` (a
 *    browser cannot set a header on a socket), and the session must be that user's, or the upgrade
 *    is refused with 401.
 *    A cookie can change under a running page, and a socket opened as someone else would carry the
 *    page's calls as them.
 *
 * Every later frame is authorized again by {@link Realtime}; nothing here is trusted afterwards.
 */
export function createSocketRoute(deps: SocketRouteDependencies): Hono<APIContext> {
  const upgrade = deps.upgrade ?? ((c, auth) => upgradeWebSocket(c, auth, deps.realtime))
  return new Hono<APIContext>()
    .use(deps.auth.isAuthenticated2FA)
    .get(
      "/",
      createSameOriginUpgradeGuard<APIContext>({ expectedOrigin: deps.expectedOrigin }),
      (c) => {
        const auth = c.get("auth")
        if (!auth) {
          return errorResponse(c, `unauthorized`, { message: "Not authenticated" })
        }
        if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
          return errorResponse(c, `bad_request`, { message: "Upgrade required", status: 426 })
        }
        const claimed = offeredUserProtocol(c.req.raw)?.slice(SOCKET_USER_PROTOCOL.length)
        if (!isBoundToUser(claimed, auth.user.id)) {
          return errorResponse(c, `unauthorized`, {
            message: "The session belongs to another user",
          })
        }
        return upgrade(c, auth)
      },
    )
}

function upgradeWebSocket(
  c: Context<APIContext>,
  auth: AppAuthState,
  realtime: Pick<Realtime, "attach">,
): Response {
  // A browser closes a socket whose server accepted none of the subprotocols it offered.
  const { socket, response } = Deno.upgradeWebSocket(c.req.raw, {
    protocol: offeredUserProtocol(c.req.raw) ?? undefined,
  })
  realtime.attach(adaptWebSocket(socket), auth)
  return response
}
