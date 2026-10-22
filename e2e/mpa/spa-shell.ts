/**
 * Stands in for the SPA in the MPA's browser tests (`e2e/mpa/run.sh`): answers every address on
 * the app's host with one page that is plainly not the website. The tests need the app's host to
 * exist, so a mailed link that points at it by mistake shows this page instead of the website's
 * form, and so the pricing form's redirect to `/try` lands somewhere. Reads `SPA_PORT`.
 *
 * It also stands in for Umami (`MPA_UMAMI_ORIGIN` in `run.sh`): its `/script.js` defines
 * `umami.track` and keeps every call in `__umamiEvents`, where `analytics.mpa.ts` reads them, so no
 * test reaches a real Umami.
 */
const port = Number(Deno.env.get("SPA_PORT"))
if (!Number.isInteger(port) || port <= 0) throw new Error("SPA_PORT must be a port number")

const UMAMI_STAND_IN =
  `globalThis.umami = { track: (name, data) => (globalThis.__umamiEvents ??= []).push({ name, data }) }`

Deno.serve(
  { hostname: "127.0.0.1", port },
  (request) =>
    new URL(request.url).pathname === "/script.js"
      ? new Response(UMAMI_STAND_IN, {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      })
      : new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The app</title></head>` +
          `<body><h1 data-e2e="spa-shell">The app</h1></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
)
