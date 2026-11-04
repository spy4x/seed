# Admin modules

> Also on the website: [seedsaas.com/docs/admin-modules](https://seedsaas.com/docs/admin-modules).

This page adds a section to the admin app, the operator area on `ADMIN_DOMAIN`. Every feature of
the product has its counterpart there, and that counterpart is a module.

You need:

- The feature built ([the aggregate reference](aggregates.md)).
- The rule it follows: "The admin panel stays in sync" in `AGENTS.md`.

A module is one section of the icon rail: its entry, its pages, optional tabs on a person's page,
and the API routes those pages call.

## The registered modules

Two registries list the same ids in the same order, the rail's order. A test on each side holds
them to it: `apps/admin/src/modules/registry.test.ts` and `apps/api/routes/admin/+routes.test.ts`.

| Id              | Pages                                                       | API under `/api/admin` |
| --------------- | ----------------------------------------------------------- | ---------------------- |
| `dashboard`     | `/`                                                         | `GET /stats`           |
| `stats`         | `/stats`                                                    | `GET /website-stats`   |
| `users`         | `/users`, `/users/:id`                                      | `/users/*`             |
| `groups`        | `/groups`, `/groups/:id`                                    | `/groups/*`            |
| `billing`       | `/billing`, `/billing/:groupId`                             | `/billing/*`           |
| `newsletter`    | `/newsletter`                                               | `/newsletter/*`        |
| `blog`          | `/blog`, `/blog/new`, `/blog/:id`                           | `/blog/*`              |
| `contact-links` | `/contact-links`, `/contact-links/new`, `/contact-links/:id` | `/contact-links*`      |
| `catalog`       | `/catalog`, `/catalog/:id`, `/catalog/categories` and `/:id` | `/catalog*`            |
| `audit`         | `/audit`                                                    | `/audit*`              |
| `jobs`          | `/jobs`, `/jobs/:id`                                        | `/jobs*`               |
| `system`        | `/system`                                                   | `/system*`             |
| `api-tokens`    | `/api-tokens`                                               | `/api-tokens*`         |

The `api-tokens` module also adds three tabs to a person's page: API tokens, Devices and
Notifications. It answers them under `/api/admin/users/:id/`.

**Optional modules.** An optional module is on only when the product turns it on. Its API module
has `enabled(context)`, and its admin module has `optional: true`. When it is off, its routes are
not mounted and `GET /api/admin/modules` leaves it out. The catalog is the one optional module
(`CATALOG=true`, [catalog.md](catalog.md)).

## The files of a module

| Where                                    | What it holds                                                      |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `apps/admin/src/modules/<id>/module.tsx` | The `AdminModule`: `id`, `nav`, `routes` and optional `personTabs` |
| `apps/admin/src/modules/<id>/state.ts`   | State the module's pages share, over `context.request`, with a test |
| `libs/ui/admin-<id>-screen.tsx`          | The screens: props in, callbacks out                               |
| `apps/api/routes/admin/<id>.ts`          | The `AdminApiModule`: `id` and `routes(context)`, a Hono app       |
| `libs/server/<area>/admin-<id>.ts`       | The SQL, when the module reads anything                            |

`nav` holds the rail entry's name, first page and icon.

Each page is a view that gets the `AdminContext`:

| Field        | What it is                                                     |
| ------------ | -------------------------------------------------------------- |
| `request`    | The API on the app's own origin. A 401 signs the app out       |
| `toasts`     | The app's toasts                                               |
| `operator`   | The signed-in operator                                         |
| `navigate`   | The router's navigate                                          |
| `personTabs` | Every module's tabs for a person's page                        |

A view keeps its own state. The users module keeps one store per context, so a new session starts
empty.

A person tab's `render({ context, userId })` mounts only while the tab is open, so it may load its
own data then. Its id must differ from the page's own tabs (`ADMIN_USER_TABS`) and from every
other module's.

## Add a module

1. Write the files above. `apps/admin/src/modules/coming-soon.tsx` holds a placeholder page while
   the views are not built.
2. Add one import and one line to `ADMIN_MODULES` in `apps/admin/src/modules/registry.ts`.
3. Add the same line, in the same place, to `ADMIN_API_MODULES` in
   `apps/api/routes/admin/registry.ts`.
4. Test the API routes.
5. Add the module's paths to `ROUTES` in `apps/api/routes/admin/+routes.test.ts`. A loop over it
   checks that anyone below operator gets 404.

## What the operator gate guarantees

`createAdminRoute` (`apps/api/routes/admin/+routes.ts`) runs these checks before any module's
route:

1. A signed-in session, with its second factor when it has one.
2. The operator role or above. Anyone below gets 404, as if the area did not exist.
3. The mutation guards.

A module cannot opt out: its routes are mounted after those checks. A path no module answers is 404
too.

## What an operator may see

A module answers counts and account facts only, never a note's text or any other aggregate's
content.

One exception helps the operator remove abusive content. A group's Files tab shows each file's name
and the title of its note. The operator can open or download the file through the admin API, since
the admin host's `img-src 'self'` cannot load the file store.

| Route under `/api/admin/groups/:id/files/:fileId` | Audit row |
| ------------------------------------------------- | --------- |
| `/open`                                           | yes       |
| `/download`                                       | yes       |
| `/thumbnail`                                      | no        |

The thumbnail route serves the whole original image; the 40 px tile only scales it down. So an
operator who opens the thumbnail's address sees the full image without an audit row.

## Next

- [Add your first feature](first-feature.md)
- [Connect a feature to the app](aggregate-extras.md)
