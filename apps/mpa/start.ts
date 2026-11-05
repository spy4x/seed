/**
 * Starts the built website on Node or Bun (#623); Deno runs `deno serve dist/server.js` instead.
 * `deno task mpa:build` bundles this file into `dist/start.js`, next to the `dist/server.js` the
 * Vite build writes, and it serves that file's `fetch` with `serve` of
 * `@spy4x/platform/server/serve`, which hands it the connection's address as `deno serve` does.
 *
 * It listens on `MPA_HOST` and `MPA_PORT`, by default `0.0.0.0` and `8000`, the address
 * `deno serve` uses. On the first SIGINT or SIGTERM it stops taking connections, lets the requests
 * in flight finish and exits with 0.
 */
import { serve, type ServeHandler } from "@spy4x/platform/server/serve"
import { shutdownSignal } from "@spy4x/platform/server/shutdown-signal"
import { exitProcess, processEnv } from "@spy4x/platform/server/process"

const hostname = processEnv.get(`MPA_HOST`) || `0.0.0.0`
const port = Number(processEnv.get(`MPA_PORT`) || 8000)
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error(`MPA_PORT must be a port number, got "${processEnv.get(`MPA_PORT`)}"`)
}

// Loaded at run time, not bundled: the server's modules find their files relative to their own
// place in `dist/server/`.
const built: { default: { fetch: ServeHandler } } = await import(
  new URL(`./server.js`, import.meta.url).href
)

const server = await serve(built.default.fetch, { hostname, port, signal: shutdownSignal() })
await server.finished
exitProcess(0)
