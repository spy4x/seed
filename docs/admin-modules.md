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
| `users`      | Users         | `/users`, `/users/:id`    | (the page's own five)               | `/api/admin/users/*`    |
| `groups`     | Groups        | `/groups`, `/groups/:id`  |                                     | `/api/admin/groups/*`   |
| `billing`    | Billing       | `/billing`, `/billing/:groupId` |                               | `/api/admin/billing/*`  |
| `newsletter` | Newsletter    | `/newsletter`             |                                     | `/api/admin/newsletter/*` |
| `blog`       | Blog          | `/blog`, `/blog/new`, `/blog/:id` |                                     | `/api/admin/blog/*`     |
| `audit`      | Audit log     | `/audit`                  |                                     | `/api/admin/audit*`     |
| `jobs`       | Jobs          | `/jobs`, `/jobs/:id`      |                                     | `/api/admin/jobs*`      |
| `system`     | System        | `/system`                 |                                     | `/api/admin/system*`    |
| `api-tokens` | API tokens    | `/api-tokens`             | API tokens, Devices, Notifications  | `/api/admin/api-tokens*` |

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
area reads counts and account facts only.
