/**
 * The container healthcheck of every service that runs on Deno: the API, the MPA and the SPA's and
 * admin app's dev servers (`infra/compose`). It exits 0 when the service is healthy, 1 when not.
 * The port comes from `HEALTHCHECK_PORT`, which each service sets in its environment.
 *
 * Given a path as its argument (`apps/healthcheck.ts /api/health`), it sends `GET` to that path on
 * the loopback address and is healthy only on a 200, so the API's `/api/health` turns the
 * container unhealthy when the database is gone. Without one, it only opens a connection to the
 * port, which is all a dev server can tell.
 *
 * It replaces `wget`, so the check needs nothing from the image beyond Deno itself and may reach
 * nothing but `127.0.0.1` (`--allow-net=127.0.0.1`).
 */
import { resolveHealthcheckPort, runHealthcheck } from "@spy4x/server/healthcheck"

await runHealthcheck({ port: resolveHealthcheckPort(Deno.env), path: Deno.args[0] })
