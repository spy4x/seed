# Security headers

The API, the SPA and the MPA send the header set of `securityHeaders` in
[`@spy4x/server/http/security-headers`](https://jsr.io/@spy4x/server/doc), with every response,
error answers included.

| Header                                                               | What it does                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Content-Security-Policy`                                            | Names everything a page may load or run; the tables below list it.          |
| `X-Content-Type-Options: nosniff`                                    | The browser never guesses a file's type, so an upload cannot run as script. |
| `Referrer-Policy: no-referrer`                                       | No address leaves in a `Referer`; some carry a reset code or a token.       |
| `X-Frame-Options: DENY`, and `frame-ancestors 'none'` in the policy  | No site can show the app in a frame to trick a click.                       |
| `Strict-Transport-Security: max-age=15552000; includeSubDomains`     | For 180 days the browser reaches the domain and its subdomains over HTTPS only. |
| `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin` | Another site can neither hold a handle on the app's window nor embed its files. |
| `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection: 0` | The remaining defaults of Hono's `secureHeaders`, which the helper wraps. |

`Strict-Transport-Security` covers subdomains: every host under the product's domain, such as the
MPA when `MPA_DOMAIN` is one, must be served over HTTPS, as the production Compose file does.
Grafana has no such host: it is published only on `127.0.0.1` of the
server (docs/deploy.md, "Admin consoles"). A browser ignores the header over plain HTTP, so
development is not affected.

## The SPA's policy

| Directive         | Allows                                                                                       | Why                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `default-src`     | `'self'`                                                                                     | Anything not named below comes from the app's own origin: the web manifest and the fonts (Geist, in `/fonts/`), for two.                   |
| `script-src`      | `'self'` and one `'sha256-…'`                                                                | The built files under `/assets/`, the service worker `/sw.js`, and the inline script that paints the stored theme before the first frame. No `'unsafe-inline'`, no `'unsafe-eval'`. |
| `style-src`       | `'self'`, one `'sha256-…'`                                                                | The built stylesheet and the inline `<style>` of `index.html`.                                        |
| `img-src`         | `'self'`, `data:`, `https://lh3.googleusercontent.com`, `https://avatars.githubusercontent.com` | The icons, the two-factor QR code, which the profile screen builds as a `data:` address, and the provider's picture of the person on "Create a new account?" (spy4x/template#142). The API passes on a picture from these two hosts only (`PROVIDER_AVATAR_ORIGINS` in `libs/domain/identity`); any other is dropped and the page shows initials. |
| `connect-src`     | `'self'`, and the origin of `SPA_ERROR_REPORT_DSN` when it is set                            | The API and its WebSocket (`/api`, on the app's origin), `/config.json`, and the error tracker.       |
| `object-src`      | `'none'`                                                                                     | No plugins.                                                                                           |
| `base-uri`        | `'self'`                                                                                     | An injected `<base>` cannot move the app's relative addresses to another site.                        |
| `form-action`     | `'self'`                                                                                     | A form posts to the app only.                                                                         |
| `frame-ancestors` | `'none'`                                                                                     | No framing.                                                                                           |

The service worker and the web manifest need no directive of their own: `worker-src` falls back to
`script-src` and `manifest-src` to `default-src`.

### How nginx gets it

nginx serves the SPA, so the library's middleware cannot run there. Two files carry the headers
into `apps/spa/nginx.conf`:

- **At build:** a plugin in `apps/spa/vite.config.ts` reads the built `dist/index.html` and writes
  `apps/spa/security-headers.conf`, one `add_header … always;` line per header. Both halves are
  the library's: `securityHeaderList` gives the headers for the built page and `nginxAddHeaders`
  writes them as nginx lines, refusing a value that could break out of the quoted string. The
  hashes therefore always match the inline blocks of that build: a library update that changes the
  theme script changes the hash with it. The file is not committed.
- **At container start:** `apps/spa/csp-connect.sh` writes `/tmp/csp-connect.conf`, which sets the
  nginx variable `$csp_error_tracker` to the origin of `SPA_ERROR_REPORT_DSN`, or to nothing. One
  image serves every environment, and the tracker is the only part of the policy that differs
  between them. The script accepts an `http` or `https` address made of letters, digits and
  `.:/@_-` only; anything else stops the container, naming the variable and not its value, because
  the origin lands inside nginx configuration.

nginx drops every inherited `add_header` in a block that has one of its own, so each `location`
that adds a header includes the file again. A new `location` with an `add_header` must do the same;
`e2e/spa/security-headers.spa.ts` checks the ones that exist.

The Vite dev server sends none of these headers: it injects inline scripts and styles of its own
that no fixed policy fits. The policy is therefore checked behind nginx.

nginx serves no byte ranges (`max_ranges 0`): its answer to a range it cannot satisfy, a 416, would
carry every header twice. A product that serves video or large downloads from the SPA's own origin
needs ranges back, and then a `location` for those files that sets the headers itself.

### Letting the app load something new

Add the source to `EXTRA_SOURCES` in `apps/spa/vite.config.ts`, to the directives
`e2e/spa/security-headers.spa.ts` expects, and to the table above. Prefer serving the file from the
app's own origin, which needs no change.

### One refusal to expect

arktype, the validation library, tries `new Function` once per page load, inside a `try`, to learn
whether it may compile its validators. The policy refuses it, the browser records the refusal, and
arktype validates without compiling. The app works. The walk in `e2e/spa` reads from the script
the place the browser names for each refused `eval`, and fails unless it is that probe: any other
`eval` in the app fails it.

## The API's policy

The API answers JSON and no page, so it sends the library's default policy with nothing added, the
same one as the MPA below. `createApiApp` in `apps/api/app.ts` mounts `securityHeaders` first,
before the request log and every route, so the headers are on a route's answer, a refusal, the 404
of an unknown address and the 500 of an error. A WebSocket upgrade passes through it untouched.

## The MPA's policy

The MPA's pages load one stylesheet from their own origin and no script, inline block or font,
so the policy is the helper's default with one source added: `'self'` for `default-src`,
`script-src`, `style-src` and `connect-src`; `'self'`, `data:` and `https:` for `img-src`;
`object-src 'none'`; `base-uri 'self'`; `frame-ancestors 'none'`. `https:` is there for the blog
([blog.md](blog.md)): a post's cover and the images in its body are `https:` addresses wherever the
operator keeps them. Only operators write posts, and an image runs no code.

With analytics on (`MPA_UMAMI_ORIGIN`, [analytics.md](analytics.md)), `script-src` and
`connect-src` also allow the Umami origin: its tracker loads from there and sends its events there.
Without it the policy names no other origin.

`form-action` is `'self'`, plus the SPA's origin when the MPA runs on a domain of its own
(`MPA_DOMAIN` differs from `DOMAIN`). The pricing page's form posts to the MPA, which redirects to
the SPA's sign-up, and a browser applies `form-action` to that redirect as well.

`securityHeadersMiddleware` in `apps/mpa/middleware.ts` sets the headers. It runs first, before the
static files, and also answers an error no route caught (the 404 of an unknown address, a 500),
because Fresh would answer those outside every middleware, without the headers.

## Tests

| What                                                                          | Where                                                    | Runs in                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| The API's headers on an answer, a refusal, a 404 and a 500 | `apps/api/app.test.ts` | `deno task check` |
| The running API's headers on an answer and a 404 | `e2e/spa/security-headers.spa.ts` | `e2e/spa/run.sh` (CI step `e2e-spa`) |
| The MPA's headers on a page, a 404, a 500 and a refusal                        | `apps/mpa/app.test.ts`                                   | `deno task check`                        |
| The MPA's headers on real responses; a walk with no refusal under the policy   | `e2e/mpa/security-headers.mpa.ts`                        | `e2e/mpa/run.sh` (CI step `e2e-mpa`)     |
| The tracker origin the container writes, and what it refuses                   | `tests/spa-runtime-config.test.ts`                       | `deno task check`                        |
| nginx's real responses and the policy's sources; a signed-in walk with no refusal      | `e2e/spa/security-headers.spa.ts`                        | `e2e/spa/run.sh` (CI step `e2e-spa`)     |

`e2e/spa/run.sh` has two modes. By default it builds the image of `apps/spa/dockerfile.prod` with
the container tool, as a deploy does, runs it beside the API and removes the image afterwards: use
this on a machine. CI steps have no container tool, so the step runs it with `SPA_SERVER=nginx`,
which builds the SPA and installs it, `nginx.conf` and the header file into the step's own nginx at
the paths the image uses. That mode does not prove the `COPY` lines of the Dockerfile; the release
pipeline's image build stops if the header file is missing.
