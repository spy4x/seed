/**
 * Starts the API on Deno, Node or Bun (#748): `serve` of `@spy4x/platform/server/serve` answers
 * every request with the Hono app of `index.ts` and hands it the connection's address, as
 * `deno serve` did, so the rate limits read the peer from the connection.
 *
 * It listens on `API_HOST` and `API_PORT`, by default `0.0.0.0` and `8000`, the address
 * `deno serve` used. On the first SIGINT or SIGTERM it stops taking connections, lets the requests
 * in flight finish, closes the database pools and exits with 0.
 */
import app from "./index.ts"
import { listenSql, sql } from "@api/services/db.ts"
import { log } from "@api/services/log.ts"
import { serve } from "@spy4x/platform/server/serve"
import { shutdownSignal, ShutdownSignalError } from "@spy4x/platform/server/shutdown-signal"
import { exitProcess, processEnv } from "@spy4x/platform/server/process"

const hostname = processEnv.get(`API_HOST`) || `0.0.0.0`
const port = Number(processEnv.get(`API_PORT`) || 8000)
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error(`API_PORT must be a port number, got "${processEnv.get(`API_PORT`)}"`)
}

const signal = shutdownSignal()
const server = await serve(app.fetch, { hostname, port, signal })
await server.finished
await Promise.all([sql.end({ timeout: 5 }), listenSql.end({ timeout: 5 })])
const reason = signal.reason instanceof ShutdownSignalError ? ` on ${signal.reason.signal}` : ``
log(`API stopped${reason}`)
// The hourly sweeps in index.ts keep timers; nothing else is left to finish.
exitProcess(0)
