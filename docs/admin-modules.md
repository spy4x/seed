# Admin modules

The operator area (`apps/admin`, on `ADMIN_DOMAIN`) is a list of modules. A module is one section of
the icon rail: its entry, its pages, optionally tabs on a person's page, and the API routes those
pages call. Every feature of the product has its counterpart here (see "The admin panel stays in
sync" in `AGENTS.md`), and that counterpart is a module.

## The registered modules

The two registries list the same ids in the same order, which is the icon rail's order. A test on
each side holds them to that (`apps/admin/src/modules/registry.test.ts`,
`apps/api/routes/admin/+routes.test.ts`).

| Id           | Rail entry    | Pages                     | Person tabs                         | API                     |
| ------------ | ------------- | ------------------------- | ----------------------------------- | ----------------------- |
| `dashboard`  | Dashboard     | `/`                       |                                     | `GET /api/admin/stats`  |
| `stats`      | Stats         | `/stats`                  |                                     | `GET /api/admin/website-stats` |
| `users`      | Users         | `/users`, `/users/:id`    | (the page's own five)               | `/api/admin/users/*`    |
| `groups`     | Groups        | `/groups`, `/groups/:id`  |                                     | `/api/admin/groups/*`   |
| `billing`    | Billing       | `/billing`, `/billing/:groupId` |                               | `/api/admin/billing/*`  |
| `newsletter` | Newsletter    | `/newsletter`             |                                     | `/api/admin/newsletter/*` |
| `blog`       | Blog          | `/blog`, `/blog/new`, `/blog/:id` |                                     | `/api/admin/blog/*`     |
| `contact-links` | Contact links | `/contact-links`, `/contact-links/new`, `/contact-links/:id` | | `/api/admin/contact-links*` |
| `catalog`    | Catalog       | `/catalog`, `/catalog/:id`, `/catalog/categories`, `/catalog/categories/:id` | | `/api/admin/catalog*` |
| `audit`      | Audit log     | `/audit`                  |                                     | `/api/admin/audit*`     |
| `jobs`       | Jobs          | `/jobs`, `/jobs/:id`      |                                     | `/api/admin/jobs*`      |
| `system`     | System        | `/system`                 |                                     | `/api/admin/system*`    |
| `api-tokens` | API tokens    | `/api-tokens`             | API tokens, Devices, Notifications  | `/api/admin/api-tokens*` |

An optional module is on only when the product turns it on. Its API module has `enabled(context)`;
off, its routes are not mounted and `GET /api/admin/modules`, which lists the ids of the modules
that are on, leaves it out. Its admin module has `optional: true`, and the app shows it once that
list names it. The catalog is the one optional module (`CATALOG=true`, [catalog.md](catalog.md)).

A module marked "none yet" is registered with a "coming soon" page (and tabs), so the icon rail
shows the whole plan. Its own lane fills it in.

The `api-tokens` module also answers a person's reads and its device removal under
`/api/admin/users/:id/`: `api-tokens`, `devices`, `notifications` and `devices/:deviceId/remove`.

## The files of a module

| Where                                       | What it holds                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/admin/src/modules/<id>/module.tsx`    | The `AdminModule`: `id`, `nav` (name, first page, icon), `routes` and optional `personTabs`. |
| `apps/admin/src/modules/<id>/state.ts`      | The module's own state, when its pages share any, over `context.request`. With its test.      |
| `libs/ui/admin-<id>-screen.tsx`             | The screens: props in, callbacks out, like every `libs/ui` screen. Billing splits them in two: `admin-billing-list.tsx` and `admin-billing-detail.tsx`. |
| `apps/api/routes/admin/<id>.ts`             | The `AdminApiModule`: `id` and `routes(context)`, a Hono app of paths under `/api/admin`.     |
| `libs/server/<area>/admin-<id>.ts`          | The SQL, when the module reads anything.                                                      |

Each page is a view that gets the `AdminContext`: `request` (the API on the app's own origin; a 401
signs the app out), `toasts`, the signed-in `operator`, `navigate` and every module's `personTabs`.
A view keeps its own state; the users module keeps one store per context (`users/module.tsx`), so a
new session starts empty.

A person tab's `render({ context, userId })` returns elements that mount only while the tab is open,
so a component it returns may load its own data when it mounts. Its id must differ from the page's
own tabs (`ADMIN_USER_TABS`) and from every other module's.

## Filling a registered module

Only the module's own files change: replace the "coming soon" page in its `module.tsx` with real
views, and give its API file real routes. Neither registry changes.

## Adding a new module

1. Write the files above.
2. Add one import and one line to `ADMIN_MODULES` (`apps/admin/src/modules/registry.ts`) and to
   `ADMIN_API_MODULES` (`apps/api/routes/admin/registry.ts`), in the same place in both.
3. Test the API routes and add the module's paths to the 404-below-operator loop in
   `apps/api/routes/admin/+routes.test.ts`.

## What the operator gate guarantees

`createAdminRoute` (`apps/api/routes/admin/+routes.ts`) checks, before any module's route runs:
a signed-in session with its second factor, then the operator role or above (anyone below gets
404, as if the area did not exist), then the mutation guards. A module cannot opt out: its routes
are mounted after those checks. A path no module answers is 404 too.

A module never answers the content of a person's notes or any other aggregate's text: the operator
area reads counts and account facts only. One exception: a group's Files tab shows each file's name
and the title of the note it sits in, and lets the operator open or download the file, so they can
find and remove abusive content (#478). Its bytes come through the admin API
(`/api/admin/groups/:id/files/:fileId/thumbnail`, `/open` and `/download`), because the admin host's
`img-src 'self'` cannot load the file store. Every open and every download writes an audit row
naming the operator and the file, which the Audit log shows. The thumbnail route writes no row,
yet it serves the whole original image (the 40 px tile scales it down), so an operator who opens
the thumbnail's address sees the full image without an audit row.
