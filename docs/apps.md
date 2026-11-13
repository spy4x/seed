# The three apps

> Also on the website: [seedsaas.com/docs/apps](https://seedsaas.com/docs/apps).

What the SPA, the admin app and the public website each do, and how to turn each one on.

## The SPA and the MPA

Seed ships two web apps over the same API, with different jobs.

- **The SPA** (`apps/spa`, Preact and Vite) is the product. Everything a signed-in person does
  happens there: sign-up, sign-in, notes, groups, billing and the profile. Compose serves it at
  `DOMAIN`.
- **The MPA** (`apps/mpa`, Preact on a small Fresh-compatible layer built with Vite:
  [the website's server](website-server.md)) is the product's public website. It holds the home
  page, pricing, the privacy and terms pages, the blog, the newsletter, `robots.txt`,
  `sitemap.xml` and `llms.txt`. Its sign-in and sign-up links open the SPA.

In the SPA, people see each other's changes live over a WebSocket
([ADR 002](decisions/002-realtime-transport-and-sync.md)). It also works offline
([the offline guide](offline.md)).

The MPA renders every page on the server, and every page works with JavaScript turned off. It has
no session and never touches the database. It asks the API over HTTP for the blog's posts, the
contact links, a few settings flags and the newsletter's sign-ups.

The website's end-to-end test runs in CI on every pull request. To run it locally, start Postgres
and Valkey, then run `e2e/mpa/run.sh`; the script's header says what it needs.

## Deploy the website

1. In the env file you deploy, add `mpa` to `COMPOSE_PROFILES`. Separate profiles with commas.
2. Set `MPA_DOMAIN` to the website's host, and point that host's DNS record at the server.
3. Deploy as usual:

   ```sh
   deno task deploy
   ```

Traefik gets the certificate for `MPA_DOMAIN` the same way as for `DOMAIN`.

| Variable        | What it does                                                         |
| --------------- | -------------------------------------------------------------------- |
| `MPA_DOMAIN`    | The website's host. Also points the newsletter's mailed links at it. |
| `API_URL`       | Where the website's server reaches the API. Compose sets it.         |
| `ENV`, `DOMAIN` | The same values as the API's.                                        |

The website refuses to start without any of them. Set `MPA_DOMAIN` only together with the `mpa`
profile: the API and the worker build links to it, and without the website those links lead
nowhere.

Optional settings go with the website. `MPA_REDIRECT_RULE` sends other hosts, such as the
`www` one, to `MPA_DOMAIN`
([Redirect other hosts](certificates.md#redirect-other-hosts-to-the-website)).
`MPA_UMAMI_ORIGIN` and `MPA_UMAMI_WEBSITE_ID` turn on visitor statistics ([Analytics](analytics.md)).
`DEMO_ORIGIN` sends every try link to a demo on its own host
([A demo on its own host](demo.md#a-demo-on-its-own-host)). `INDEXNOW_KEY`, which the worker reads too, tells search engines when a blog post or a catalog item changes
([IndexNow](blog.md#indexnow)). `DEVTO_API_KEY`, read by the worker, copies each live post to
Dev.to once ([the Dev.to cross-post](blog.md#the-devto-cross-post)); the Mastodon, Bluesky,
Hashnode and LinkedIn keys post it there ([automatic posts](blog.md#automatic-posts)).
[Settings](settings.md) lists them all.

The API accepts a form only from `DOMAIN`'s origin. The website first refuses any post that does
not come from its own pages, then sends the post on to the API with `DOMAIN`'s origin.

## The admin app

The admin app (`apps/admin`, Preact and Vite) is the operator area. An operator finds a person by
address or name and filters by role or blocked state. The person's page shows their sign-in
methods, sessions, groups and audit trail.

From there the operator blocks or unblocks the person, or ends all their sessions. A block refuses
every way in (password, Google, GitHub and API tokens), ends the person's sessions and closes their
open pages. Each action is confirmed in a dialog, asks for no password, and writes an audit event naming the operator.
Nobody acts on themselves, or on someone whose role is theirs or higher.

The admin app runs on a host of its own, `ADMIN_DOMAIN`, so its session cookie belongs to that host
alone. It signs in with a password and a code only, never Google or GitHub. The API answers the
operator area (`/api/admin`) on that host only. A person below operator gets 404 from every
operator route.

Roles are `viewer` (everyone, by default), `operator`, `supervisor` and `administrator`. Operator
and above open the admin app. [Give operators access](operator-access.md) says how to make the
first one and how to give a role.

## Deploy the admin app

1. In the env file you deploy, add `admin` to `COMPOSE_PROFILES`.
2. Set `ADMIN_DOMAIN` to the app's host, such as `admin.example.com`, and point that host's DNS
   record at the server.
3. Deploy as usual:

   ```sh
   deno task deploy
   ```

Compose serves the admin app at `ADMIN_DOMAIN` and sends that host's `/api` to the API. Traefik
gets its certificate. In development, with the profile on, the app is at `http://admin.localhost`,
the `ADMIN_DOMAIN` of `infra/envs/.env.example`.

## Without the SPA

A product that is only a website and its admin panel, with no signed-in customers, turns the SPA
off:

1. In the env file, set `SPA=false`.
2. Remove the sign-in and sign-up links from the website's pages: they lead to the SPA.
3. Deploy as usual.

Then:

- Compose runs no SPA container. The SPA's image is still built on a deploy.
- The API keeps its route on `DOMAIN`, for the webhooks and the file store's links.
- The API answers 404 to sign-up and every other route under `/api/auth` on every host but
  `ADMIN_DOMAIN`. Nobody can make an account or sign in there.
- The admin app's sign-in works as before. Its first operator comes from
  [`deno task operator:create`](operator-access.md#the-first-operator).

Any other value of `SPA`, or none, runs the SPA.

## Runtime

The API, the worker, the migration and the website run on Deno unless the env file says
otherwise. One line moves them all to Node or Bun:

```sh
APP_RUNTIME=node   # or bun; deno, empty or no line keeps Deno
```

- `deno task compose`, and so every deploy, then adds
  [`compose.runtime-node.yml`](../infra/compose/compose.runtime-node.yml) (or `-bun`), which builds
  [`apps/api/dockerfile.node`](../apps/api/dockerfile.node) (or `.bun`) for the API, the worker and
  the migration, and [`apps/mpa/dockerfile.node`](../apps/mpa/dockerfile.node) (or `.bun`) for the
  website. The API's image bundles the code with `deno task server:build` at build time; the
  website's builds it with Vite and starts it with [`apps/mpa/start.ts`](../apps/mpa/start.ts).
  Both run on Node 26 or Bun 1.4. Ports, environment variables and the order of the services stay
  the same.
- Any other value stops `deno task compose` before it starts anything.
- The bundles are made when the image is built, so on Node or Bun a code change shows only after
  `deno task compose up -d --build`, in development too. Development with watch mode stays on Deno.
- On Deno the worker may read and write only its image folder and run only `vips`. Node and Bun
  have no such permission limits: there the worker is confined only by its container and its
  non-root user.
- The SPA and the admin app are not affected: they are static files, served the same way.

To start them on a machine without containers, `deno task api:node`, `api:bun`, `worker:node`,
`worker:bun`, `mpa:node` and `mpa:bun` build the bundles and run them. `npm run` and `bun run` take
the same names: the root `package.json` hands each one to `deno task`, so Deno stays the toolchain.
`deno task test:runtimes` starts the API, the worker and the website on all three runtimes and
checks that each answers, as CI does (step `runtimes`).

## Next

- [Deploy to a server](deploy.md)
- [Give operators access](operator-access.md)
- [Settings](settings.md)
