/**
 * The container healthcheck of every service that runs on Deno: the API, the MPA and the SPA's dev
 * server (`infra/compose`). It opens a connection to the service's own port on the loopback
 * address and exits 0 when the port answers, 1 when it does not. The port comes from
 * `HEALTHCHECK_PORT`, which each service sets in its environment.
 *
 * It replaces `wget`, so the check needs nothing from the image beyond Deno itself and may reach
 * nothing but `127.0.0.1` (`--allow-net=127.0.0.1`).
 */
import { resolveHealthcheckPort, runHealthcheck } from "@spy4x/server/healthcheck"

await runHealthcheck({ port: resolveHealthcheckPort(Deno.env) })
