/**
 * The checks of the runtime smoke test (`tests/runtimes/smoke.sh`, #623), against an API and a
 * website that run on Deno, Node or Bun. It runs on Deno, the toolchain, whatever the servers run on.
 *
 * - `api <api origin> <app origin>`: `/api/health` answers 200, a guest account starts, and a
 *   WebSocket opens at `/api/ws` with the guest's session, as the SPA opens it.
 * - `website <origin>`: the home page renders, its stylesheet is served, and a video answers a
 *   byte range with 206, which Safari needs to play it.
 *
 * Exits with 1 and the reason on the first check that fails.
 */
import { SOCKET_USER_PROTOCOL } from "@domain/identity"

/** Throws `message` unless `condition` holds. */
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** The API answers, a guest signs in and its WebSocket opens. */
async function checkApi(api: string, app: string): Promise<void> {
  const health = await fetch(`${api}/api/health`)
  await health.body?.cancel()
  expect(health.status === 200, `GET /api/health answered ${health.status}`)

  // The headers a browser sends with a same-origin request, which the API's mutation guard checks.
  const started = await fetch(`${api}/api/auth/guest`, {
    method: `POST`,
    headers: { origin: app, "sec-fetch-site": `same-origin` },
  })
  expect(started.status === 201, `POST /api/auth/guest answered ${started.status}`)
  await started.body?.cancel()
  const cookie = started.headers.getSetCookie().map((line) => line.split(`;`)[0]).join(`; `)
  expect(cookie, `POST /api/auth/guest set no cookie`)

  const me = await fetch(`${api}/api/auth/me`, { headers: { cookie } })
  const user = await me.json() as { id?: unknown }
  expect(me.status === 200 && user.id, `GET /api/auth/me answered ${me.status}`)

  // Deno's WebSocket takes headers, as a browser sends its cookie and origin; the DOM types the
  // repository is checked against know only the protocols.
  const options = {
    protocols: [`${SOCKET_USER_PROTOCOL}${user.id}`],
    headers: { cookie, origin: app },
  } as unknown as string[]
  const socket = new WebSocket(`${api.replace(/^http/, `ws`)}/api/ws`, options)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the WebSocket did not open within 10 s`)),
      10_000,
    )
    socket.onopen = () => {
      clearTimeout(timer)
      resolve()
    }
    socket.onerror = () => {
      clearTimeout(timer)
      reject(new Error(`the WebSocket failed to open`))
    }
  })
  socket.close()
}

/** The home page renders with its stylesheet, and a video answers a byte range. */
async function checkWebsite(origin: string): Promise<void> {
  const home = await fetch(`${origin}/`)
  const html = await home.text()
  expect(home.status === 200 && html.includes(`</html>`), `GET / answered ${home.status}`)

  const stylesheet = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1]
  expect(stylesheet, `the home page links no stylesheet`)
  const css = await fetch(new URL(stylesheet, origin))
  await css.body?.cancel()
  expect(css.status === 200, `GET ${stylesheet} answered ${css.status}`)

  const video = await fetch(`${origin}/video/demo.mp4`, { headers: { range: `bytes=0-99` } })
  const bytes = await video.arrayBuffer()
  expect(
    video.status === 206 && bytes.byteLength === 100,
    `GET /video/demo.mp4 with a range answered ${video.status} with ${bytes.byteLength} bytes`,
  )
}

const [kind, ...origins] = Deno.args
try {
  if (kind === `api` && origins.length === 2) await checkApi(origins[0], origins[1])
  else if (kind === `website` && origins.length === 1) await checkWebsite(origins[0])
  else throw new Error(`usage: check.ts api <api origin> <app origin> | website <origin>`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  Deno.exit(1)
}
