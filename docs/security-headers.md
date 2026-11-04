# Security headers

> Also on the website: [seedsaas.com/docs/security-headers](https://seedsaas.com/docs/security-headers).

The headers every answer of the API, the SPA and the MPA sends, what each page may load, and how to
allow a new source.

## The headers

The three apps send the header set of `securityHeaders` in
[`@spy4x/server/http/security-headers`](https://jsr.io/@spy4x/server/doc) with every response,
error answers included.

| Header                                                                                                                             | What it does                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Content-Security-Policy`                                                                                                          | Names everything a page may load or run; the tables below list it.              |
| `X-Content-Type-Options: nosniff`                                                                                                  | The browser never guesses a file's type, so an upload cannot run as script.     |
| `Referrer-Policy: no-referrer`                                                                                                     | No address leaves in a `Referer`; some carry a reset code or a token.           |
| `X-Frame-Options: DENY`, and `frame-ancestors 'none'` in the policy                                                                | No site can show the app in a frame to trick a click.                           |
| `Strict-Transport-Security: max-age=15552000; includeSubDomains`                                                                   | For 180 days the browser reaches the domain and its subdomains over HTTPS only. |
| `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`                                                       | Another site can neither hold a handle on the app's window nor embed its files. |
| `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection: 0` | The remaining defaults of Hono's `secureHeaders`, which the helper wraps.       |

`Strict-Transport-Security` covers subdomains, so every host under the product's domain must be
served over HTTPS. The production Compose file does that, the MPA's `MPA_DOMAIN` included. Grafana
has no such host ([Admin consoles](operator-access.md#admin-consoles)). Browsers ignore the header
over plain HTTP, so development is not affected.

## The SPA's policy

| Directive         | Allows                                                                                          | Why                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `default-src`     | `'self'`                                                                                        | Anything not named below, such as the web manifest and the fonts in `/fonts/`, comes from the app's own origin.          |
| `script-src`      | `'self'` and one `'sha256-…'`                                                                   | The built files, the service worker `/sw.js`, and the inline script that paints the stored theme before the first frame. |
| `style-src`       | `'self'` and one `'sha256-…'`                                                                   | The built stylesheet and the inline `<style>` of `index.html`.                                                           |
| `img-src`         | `'self'`, `data:`, `https://lh3.googleusercontent.com`, `https://avatars.githubusercontent.com` | The icons, the two-factor QR code as a `data:` address, and the provider's picture on "Create a new account?".           |
| `connect-src`     | `'self'`, and the origin of `SPA_ERROR_REPORT_DSN` when it is set                               | The API and its WebSocket, `/config.json`, and the error tracker.                                                        |
| `object-src`      | `'none'`                                                                                        | No plugins.                                                                                                              |
| `base-uri`        | `'self'`                                                                                        | An injected `<base>` cannot move the app's relative addresses to another site.                                           |
| `form-action`     | `'self'`                                                                                        | A form posts to the app only.                                                                                            |
| `frame-ancestors` | `'none'`                                                                                        | No framing.                                                                                                              |

There is no `'unsafe-inline'` and no `'unsafe-eval'`. The service worker and the web manifest need
no directive of their own: `worker-src` falls back to `script-src`, and `manifest-src` to
`default-src`.

The API passes on a provider's picture from the two `img-src` hosts only (`PROVIDER_AVATAR_ORIGINS`
in `libs/domain/identity`). Any other is dropped, and the page shows initials.

### Allow a new source

Prefer serving the file from the app's own origin, which needs no change. Otherwise:

1. Add the source to `EXTRA_SOURCES` in `apps/spa/vite.config.ts`.
2. Add it to the directives that `e2e/spa/security-headers.spa.ts` expects.
3. Add it to the table above.

### How nginx gets the headers

nginx serves the SPA, so the library's middleware cannot run there. Two files carry the headers into
`apps/spa/nginx.conf`:

- **At build:** a plugin in `apps/spa/vite.config.ts` writes `apps/spa/security-headers.conf` from
  the built `index.html`, one `add_header … always;` line per header. The hashes therefore always
  match that build's inline blocks. The file is not committed.
- **At container start:** `apps/spa/csp-connect.sh` sets the error tracker's origin from
  `SPA_ERROR_REPORT_DSN`, the only part of the policy that differs between environments. It accepts
  an `http` or `https` address of letters, digits and `.:/@_-` only. Anything else stops the
  container, naming the variable but not its value.

nginx drops every inherited `add_header` in a block that has one of its own. So a new `location`
with an `add_header` must include the header file again; `e2e/spa/security-headers.spa.ts` checks
the ones that exist.

nginx serves no byte ranges (`max_ranges 0`), because its 416 answer would carry every header
twice. A product that serves video or large downloads from the SPA's origin needs ranges back, and
then a `location` for those files that sets the headers itself.

The Vite dev server sends none of these headers: it injects inline code that no fixed policy fits.
The policy is checked behind nginx.

### One refusal to expect

arktype, the validation library, tries `new Function` once per page load to learn whether it may
compile its validators. The policy refuses it, the browser records the refusal, and arktype
validates without compiling. The app works. The browser walk in `e2e/spa` fails on any other
refused `eval`.

## The API's policy

The API answers JSON and no page, so it sends the library's default policy with nothing added, the
same as the MPA's below. `createApiApp` in `apps/api/app.ts` mounts the headers before every route,
so a refusal, a 404 and a 500 carry them too. A WebSocket upgrade passes through untouched.

## The MPA's policy

| Directive                                               | Allows                | When                                                     |
| ------------------------------------------------------- | --------------------- | -------------------------------------------------------- |
| `default-src`, `script-src`, `style-src`, `connect-src` | `'self'`              | Always.                                                  |
| `img-src`                                               | `'self'`, `data:`     | Always.                                                  |
| `img-src`                                               | also `https:`         | On a blog post's page, `/blog/<slug>` in any language.   |
| `script-src`, `connect-src`                             | also the Umami origin | With `MPA_UMAMI_ORIGIN` set ([Analytics](analytics.md)). |
| `form-action`                                           | `'self'`              | Always.                                                  |
| `form-action`                                           | also the SPA's origin | When `MPA_DOMAIN` differs from `DOMAIN`.                 |
| `object-src`                                            | `'none'`              | Always.                                                  |
| `base-uri`                                              | `'self'`              | Always.                                                  |
| `frame-ancestors`                                       | `'none'`              | Always.                                                  |

A post's cover and the images in its body are `https:` addresses wherever the operator keeps them
([Blog](blog.md)). Only operators write posts, and an image runs no code. Every other page, the
blog's index included, keeps `img-src 'self' data:`.

No page has an inline script: the script that wakes a page's islands is a file from the site's own
origin, so `'self'` covers it. The pricing page's form posts to the MPA, which redirects to the
SPA's sign-up; a browser applies `form-action` to that redirect too.

`securityHeadersMiddleware` in `apps/mpa/middleware.ts` sets the headers. It runs before the static
files, and also answers errors no route caught, which the website's server would otherwise answer
without the headers.

## Tests

| What                                                                              | Where                              | Runs in                              |
| --------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| The API's headers on an answer, a refusal, a 404 and a 500                        | `apps/api/app.test.ts`             | `deno task check`                    |
| The running API's headers on an answer and a 404                                  | `e2e/spa/security-headers.spa.ts`  | `e2e/spa/run.sh` (CI step `browser`) |
| The MPA's headers on a page, a rendered page's nonce, a 404, a 500 and a refusal  | `apps/mpa/app.test.ts`             | `deno task check`                    |
| The MPA's headers on real responses; a walk with no refusal under the policy      | `e2e/mpa/security-headers.mpa.ts`  | `e2e/mpa/run.sh` (CI step `browser`) |
| The tracker origin the container writes, and what it refuses                      | `tests/spa-runtime-config.test.ts` | `deno task check`                    |
| nginx's real responses and the policy's sources; a signed-in walk with no refusal | `e2e/spa/security-headers.spa.ts`  | `e2e/spa/run.sh` (CI step `browser`) |

`e2e/spa/run.sh` has two modes:

- **On a machine** (the default): it builds the image of `apps/spa/dockerfile.prod`, runs it beside
  the API, and removes the image afterwards.
- **In CI** (`SPA_SERVER=nginx`): CI steps have no container tool, so it builds the SPA and installs
  it into the step's own nginx at the image's paths. This mode does not prove the Dockerfile's
  `COPY` lines; the release pipeline's image build stops if the header file is missing.

## Next

- [Settings](settings.md): `SPA_ERROR_REPORT_DSN`, `MPA_UMAMI_ORIGIN` and the domains.
- [Analytics](analytics.md)
