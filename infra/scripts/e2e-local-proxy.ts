/// <reference lib="deno.ns" />
/**
 * The one origin `deno task e2e:local` serves the app at, as Traefik does in the compose stack:
 * `/api` goes to the API, everything else to what serves the SPA at `SPA_PORT` (the Vite dev server
 * or the built SPA). Reads `FRONT_PORT`, `API_PORT` and `SPA_PORT` and listens on 127.0.0.1. With
 * `FILES_PORT` and `S3_BUCKET` set, `/<bucket>/…` goes to the file store, as the store's own route
 * on the app's host does in the compose stack.
 *
 * It joins the two TCP connections instead of making a request of its own: it reads the head of
 * the first request to choose the upstream, rewrites that head (`forwardedHead`) and then copies
 * bytes both ways. A WebSocket handshake therefore reaches the API with the browser's own cookie
 * and subprotocol, and Vite's hot-reload socket works too.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** The headers a client could use to name its own address; the proxy alone sets them. */
const CLIENT_ADDRESS_HEADERS = /^(x-real-ip|x-forwarded-for)\s*:/i

/** What the proxy reads from a request head to route it. */
export interface RequestHead {
  /** The path and query of the request line. */
  path: string
  /** Whether the request asks to become a WebSocket. */
  isWebSocket: boolean
}

/** Reads the path and the WebSocket upgrade from a request head. */
export function parseHead(head: string): RequestHead {
  const lines = head.split("\r\n")
  return {
    path: lines[0]?.split(" ")[1] ?? "/",
    isWebSocket: lines.some((line) => /^upgrade:\s*websocket/i.test(line)),
  }
}

/**
 * The request head as the upstream gets it. `head` is everything up to and including the blank
 * line that ends the headers.
 *
 * - The client's own `X-Real-IP` and `X-Forwarded-For` are dropped and both are set to
 *   `clientAddress`, the address the proxy sees, so a client cannot choose the address the API
 *   records for it. Traefik does the same in the compose stack.
 * - Every request gets `Connection: close`, so one connection never carries a second request,
 *   which would skip this rewrite and the routing. A WebSocket handshake gets
 *   `Connection: Upgrade, close`: the upgrade still happens, and an upstream that refuses it, as
 *   for a plain request that only claims to be a handshake, closes the connection.
 *
 * Null when a line break of `head` is not CR LF: the proxy then closes the connection. The
 * upstream reads a bare line feed or carriage return as a line break too, so a header after one
 * would pass here as part of the line before it and reach the upstream as a header of its own.
 */
export function forwardedHead(head: string, clientAddress: string): string | null {
  if (/\r(?!\n)|(?<!\r)\n/.test(head)) return null
  const { isWebSocket } = parseHead(head)
  const [requestLine, ...headers] = head.split("\r\n").filter((line) => line !== "")
  const kept = headers.filter((line) =>
    !CLIENT_ADDRESS_HEADERS.test(line) && !/^connection\s*:/i.test(line)
  )
  return [
    requestLine,
    ...kept,
    `X-Real-IP: ${clientAddress}`,
    `X-Forwarded-For: ${clientAddress}`,
    isWebSocket ? "Connection: Upgrade, close" : "Connection: close",
    "",
    "",
  ].join("\r\n")
}

/** The ports the proxy routes to. `files` is the file store's, when there is one. */
export interface Upstreams {
  api: number
  spa: number
  files?: { port: number; bucket: string }
}

/** The port that serves `path`: the API's, the file store's or the SPA's. */
export function upstreamFor(path: string, upstreams: Upstreams): number {
  const under = (prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)
  if (under("/api")) return upstreams.api
  if (upstreams.files && under(`/${upstreams.files.bucket}`)) return upstreams.files.port
  return upstreams.spa
}

/** Where the headers end in `bytes` (after the blank line), or -1 when they are not complete. */
function headEnd(bytes: Uint8Array): number {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return i + 4
    }
  }
  return -1
}

/** Reads from `conn` until the request head is complete. Null when the client sent no full head. */
async function readThroughHead(conn: Deno.Conn): Promise<Uint8Array | null> {
  let read = new Uint8Array(0)
  const chunk = new Uint8Array(65536)
  while (headEnd(read) === -1) {
    const n = await conn.read(chunk)
    if (n === null || read.length + n > 1_000_000) return null
    const merged = new Uint8Array(read.length + n)
    merged.set(read)
    merged.set(chunk.subarray(0, n), read.length)
    read = merged
  }
  return read
}

async function copy(from: Deno.Conn, to: Deno.Conn): Promise<void> {
  const chunk = new Uint8Array(65536)
  try {
    while (true) {
      const n = await from.read(chunk)
      if (n === null) break
      await to.write(chunk.subarray(0, n))
    }
  } catch {
    // The peer reset or closed the connection: how most connections end.
  } finally {
    try {
      to.close()
    } catch {
      // Closed already.
    }
  }
}

async function handle(conn: Deno.TcpConn, upstreams: Upstreams): Promise<void> {
  const read = await readThroughHead(conn)
  if (read === null) return conn.close()
  const end = headEnd(read)
  const head = decoder.decode(read.subarray(0, end))
  const { path } = parseHead(head)
  const forwarded = forwardedHead(head, conn.remoteAddr.hostname)
  if (forwarded === null) return conn.close()
  let upstream: Deno.Conn
  try {
    upstream = await Deno.connect({ hostname: "127.0.0.1", port: upstreamFor(path, upstreams) })
  } catch {
    return conn.close()
  }
  try {
    await upstream.write(encoder.encode(forwarded))
    // Whatever of the body arrived with the head.
    if (end < read.length) await upstream.write(read.subarray(end))
  } catch {
    upstream.close()
    return conn.close()
  }
  await Promise.allSettled([copy(conn, upstream), copy(upstream, conn)])
}

if (import.meta.main) {
  const port = (name: string): number => {
    const value = Number(Deno.env.get(name))
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a port number`)
    return value
  }
  const bucket = Deno.env.get("S3_BUCKET")
  const upstreams: Upstreams = {
    api: port("API_PORT"),
    spa: port("SPA_PORT"),
    ...(Deno.env.get("FILES_PORT") && bucket
      ? { files: { port: port("FILES_PORT"), bucket } }
      : {}),
  }
  const listener = Deno.listen({ hostname: "127.0.0.1", port: port("FRONT_PORT") })
  for await (const conn of listener) {
    handle(conn, upstreams).catch(() => {
      try {
        conn.close()
      } catch {
        // Closed already.
      }
    })
  }
}
