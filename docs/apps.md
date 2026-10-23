# The three apps

The SPA, the admin app and the website: what each does and how to deploy it.

## The SPA and the MPA

The template ships two web apps over the same API, with different jobs.

- **The SPA** (`apps/spa`, Preact and Vite) is the product. Everything a signed-in person does
  happens there: sign-up and sign-in, notes, groups, billing, the profile. People see each other's
  changes live over a WebSocket ([ADR 002](decisions/002-realtime-transport-and-sync.md)), and
  it works offline ([the offline guide](offline.md)). Compose serves it at `DOMAIN`.
- **The MPA** (`apps/mpa`, Fresh) is the product's public website: the home page, pricing read
  from the `PLANS` catalog, privacy and terms pages to adapt, `robots.txt`, `sitemap.xml`,
  `llms.txt` and the newsletter. Every page is rendered on the server and works with JavaScript
  turned off. It has no session; its sign-in and sign-up links open the SPA at `DOMAIN`.

The MPA calls the API over HTTP from the server, only for the newsletter, and never touches the
database itself. It needs `ENV` and `DOMAIN` (the same values as the API), its own host
`MPA_DOMAIN`, and `API_URL`, the address the MPA's server reaches the API at, such as
`http://<PROJECT>-api:8000` (Compose sets it); it refuses to start without any of them. To deploy
it, set `COMPOSE_PROFILES=mpa` in the env file (join it with other profiles by commas) and
`MPA_DOMAIN` to the website's own host, then run `deno task deploy` as usual: Compose builds the
`mpa` service from `apps/mpa/dockerfile.prod` and serves it at `MPA_DOMAIN`, next to the SPA at
`DOMAIN`. The API accepts a form only from `http(s)://DOMAIN`, so the MPA, after refusing any post
that does not come from its own pages, presents its posts to the API with `DOMAIN`'s origin.
`MPA_DOMAIN` needs a DNS record pointing at the server; Traefik gets its certificate as for
`DOMAIN`. The API and the worker read `MPA_DOMAIN` too: when it is set, the newsletter's mailed
confirm and unsubscribe links open the website's pages, which work without JavaScript, so set it
only together with the profile. Without it the links open the SPA. Without the profile nothing about
the deploy changes. The pair `MPA_UMAMI_ORIGIN` and `MPA_UMAMI_WEBSITE_ID` turns on visitor
statistics in a self-hosted Umami: [analytics.md](analytics.md). The MPA's end-to-end test runs in
CI on every pull request, and locally with `e2e/mpa/run.sh` against a running Postgres and Valkey
(see the header of that script).

## The admin app

The admin app (`apps/admin`, Preact and Vite) is the operator area: people who run the product
find a person by address or name, filter by role and by blocked state, and open their page with
their sign-in methods, sessions, groups and audit trail. From there they block or unblock the
person, or end all their sessions. A block refuses every way in (password, Google, GitHub and API
tokens), ends the person's sessions and closes their open pages. Each action is confirmed in a
dialog, asks for no password, and writes an audit event naming the operator.
Nobody acts on themselves or on someone whose role is theirs or higher.

It runs on a host of its own, `ADMIN_DOMAIN`, so its session cookie belongs to that host alone. It
signs in with a password and a code only; Google and GitHub are not offered there. The API answers
the operator area (`/api/admin`) on that host only, and there only the operator area and sign-in.
A person below operator gets 404 from every operator route; the app's own check only says so.

Roles are `viewer` (everyone, by default), `operator`, `supervisor` and `administrator`; operator
and above open the admin app. To give someone a role, run
`deno task user:role <address> <role>` with the database variables set, such as
`deno task compose exec worker deno task user:role ada@example.com operator` on the server. It
finds the person by the address they sign in with and exits with 1 when nobody does. A change
writes an audit row on the person naming the script (`cli:user-role`). In the admin app, an
administrator can give a role below their own; an administrator is made only with the script,
the development seed, or, on the public demo, `DEMO_ADMIN_PASSWORD` ([demo.md](demo.md)).

To deploy it, add `admin` to `COMPOSE_PROFILES` in the env file and set `ADMIN_DOMAIN` to the
app's host, such as `admin.example.com`, then run `deno task deploy`. Compose builds the `admin`
service from `apps/admin/dockerfile.prod`, serves it at `ADMIN_DOMAIN` and sends that host's `/api`
to the API. `ADMIN_DOMAIN` needs a DNS record pointing at the server; Traefik gets its certificate.
In development, with the profile on, Compose serves it at `http://admin.localhost`, the
`ADMIN_DOMAIN` that `infra/envs/.env.example` sets.
