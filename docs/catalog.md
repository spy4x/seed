# The catalog

A shop's items, edited in the admin panel and read by the public website (#466). An item has a
name and texts in each language the catalog keeps, a price, a category, colours, sizes with an
optional size chart, what is sold out, and photos. The catalog is **off** unless the product turns
it on; the template's own site leaves it off.

## Turning it on

Set these in the API's env (`infra/envs/.env.example`, passed by `infra/compose/compose.shared.yml`):

| Variable            | What                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| `CATALOG`           | `true` turns the catalog on. Anything else, or unset, keeps it off.                    |
| `CATALOG_CURRENCY`  | The ISO 4217 code of every price, such as `VND`. Default `USD`. One per catalog.       |
| `CATALOG_LANGUAGES` | The languages its texts are kept in, comma-separated, the default first. Default `en`. |

On, a bad currency or language stops the API at start, naming the variable. Off, no catalog route
answers (the API does not mount them) and `GET /api/admin/modules` leaves `catalog` out, so the
admin app shows no Catalog entry. The tables exist either way.

## The model

- **Prices** are whole numbers in the currency's smallest unit (cents, or dong), `INT8`.
- **Texts** (names, description, material, fit, care, colour names, photo descriptions) are JSON
  objects keyed by language: `{ "vi": "Áo thun", "en": "T-shirt" }`. The default language's name
  is required; every other text is optional. A reader with no text in their language gets the
  default's (`catalogText`).
- **Status**: a new item is a `draft`. Publishing needs a category and sets `published_at` once;
  hiding takes it off the website and keeps the date for the next publish.
- **Colours and sizes** belong to one item, in its order. Sizes go smallest first.
- **Sold out** is stored per colour × size combination (`catalog_sold_out`). An item without
  colours has the combinations `{ colourId: null, sizeId }`, one without sizes `{ colourId, null }`,
  and one with neither the single `{ null, null }`. The stock in the lists is `in-stock`,
  `some-sold-out` or `sold-out`.
- **Photos** are images of the file store's image pipeline ([files.md](files.md)): the admin app
  sends the bytes to the API, which checks the type by the bytes, stores them at `catalog/<id>` and
  queues `files.image-process`; the worker makes AVIF and WebP widths, the narrowest first, which
  the admin shows about a second after the upload (#514). The first photo is the cover. A photo may name the colour it shows. Deleting a photo or its item deletes the `images`
  row, which queues every object for deletion.

## The size chart and the size calculator

Each size may carry a height range (cm) and a weight range (kg), inclusive whole numbers. They are
set per item, on the item's sizes, because sizes belong to the item. `recommendSize(sizes,
{ heightCm, weightKg })` in `@domain/catalog` answers which size fits, with this rule:

1. A measure no size has a range for is left out. No size has either range: no answer (`null`).
2. A measure that some size has a range for, whose value falls in none of them: `null`. The
   person is outside the chart, and a guess from the other measure would mislead.
3. A size whose ranges hold every measure left: that size, the first one when ranges overlap.
4. Otherwise the height and the weight point at different sizes (the first holding each): the
   answer is `between` the two, the one earlier in the list as `smaller`.

The storefront's calculator is built by each product; Seed's website has none yet.

## Tracking links

An operator shares one item in many places: a Facebook group, a Zalo group, Instagram, friends.
Each place is a **link source**, edited in the admin panel under Catalog → More actions → Link
sources: a name, a source tag (its `utm_source`, lowercase letters, digits and hyphens) and an
order. The item page has a **Share links** card with one row per source and a **Copy link**
button. The first press makes the item's link for that source, `https://<MPA_DOMAIN>/s/<code>`,
and copies it; every later press copies the same link. Pressing twice at once still makes one
link (`catalog_tracking_links` is unique per item and source). Making a link, and every change to
the sources, writes an audit row.

The short link answers on the website (`apps/mpa/routes/s/[code].ts`) with a `302`:

- **With Umami set**, to `<UMAMI_API_URL>/q/<code>`: Umami counts the click and sends the visitor
  back to `/s/<code>?counted=1`, which goes on to the item. Umami's link holds only the short
  address, never the item's, so renaming the item or its source never leaves it pointing at an
  old page.
- **Without Umami, or while it does not answer its heartbeat** (asked at most once a minute, 1.5
  seconds at most), straight to the item: `<MPA_DOMAIN><CATALOG_ITEM_PATH>?utm_source=<source
  tag>&utm_medium=share&utm_campaign=<item slug>`. The Umami tracker on the item page still counts
  the visit by its `utm_source`.

The address is always built on the server from the item's own slug and the website's origin, never
from the request: only a code in the table leads anywhere, and only to the website or the
configured Umami. A link of a hidden or draft item, or one whose source was deleted, answers 404.
Deleting a source deletes its links, after a confirm that says how many.

| Variable            | What                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `MPA_DOMAIN`        | The website's host. Without it, tracking links are off: the item page shows no Share links card and the Link sources page says why. |
| `CATALOG_ITEM_PATH` | The website's item address, with `{slug}` and optionally `{category}`. Default `/{category}/{slug}`. |
| `UMAMI_API_URL`     | The self-hosted Umami, such as `https://stats.example.com`. Set with the token or not at all. |
| `UMAMI_API_TOKEN`   | A token of an Umami user who may create links. A secret: env only, never logged.          |

The Umami client is `@spy4x/integrations/umami` (`ts-libs`). How many clicks each link had is
[#485](https://github.com/spy4x/seed/issues/485).

### Order buttons

Seed's website draws no order buttons. A product whose item page has them names their clicks so
Umami's report on a `utm_source` shows orders next to visits: `order-telegram` and `order-zalo`
(and `order-<channel>` for another), with `data-umami-event="order-telegram"` and the item's slug
as `data-umami-event-item`.

## Where it lives

| Where                                           | What                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `libs/domain/catalog/+lib.ts`                   | Shapes, limits, request schemas, field checks, `recommendSize`, errors.  |
| `libs/server/catalog/setup.ts`                  | `readCatalogSetup`: the switch and the settings.                         |
| `libs/server/catalog/postgres-catalog.ts`       | The admin's reads and writes, each write with its audit row.            |
| `libs/server/catalog/public-catalog.ts`         | The website's reads: published items only.                               |
| `libs/server/catalog/sample-catalog.ts`         | Three categories, six items and four link sources for development and the demo. |
| `libs/server/catalog/tracking.ts`               | Tracking links: the env, Umami, and where `/s/<code>` leads.             |
| `apps/api/routes/admin/catalog.ts`              | `/api/admin/catalog*`, behind the operator gate.                         |
| `apps/api/routes/catalog.ts`                    | `/api/catalog*`, public, mounted only while the catalog is on.           |
| `apps/admin/src/modules/catalog/`               | The admin pages: the list, the item editor, the categories, the sources. |
| `libs/ui/admin-catalog.tsx`, `admin-catalog-item.tsx`, `admin-catalog-sources.tsx` | Their screens.                          |
| `apps/mpa/routes/s/[code].ts`                   | The website's `/s/<code>` redirect.                                      |

## The API

Admin, operator only, every write audited (`catalog.*` kinds in the audit log):

- `GET /api/admin/catalog`: the settings, every category, every item, the link sources, and
  whether tracking links are on.
- `GET /api/admin/catalog/items/:id` (the item and its tracking links); `POST /api/admin/catalog/items` (a client-made UUID v7
  `id` and the fields); `POST .../items/:id` (the fields at `version`); `.../status`
  (`published` or `hidden`); `.../delete`.
- `POST .../items/:id/photos?id=<photo id>`: one photo's bytes, its type as `Content-Type` (JPEG,
  PNG, WebP or HEIC, up to 20 MB). The same photo id again answers the first photo.
- `POST .../items/:id/photos/order` (`{ ids }`), `.../photos/:photoId` (`{ alt, colourId }`),
  `.../photos/:photoId/delete`; `GET .../photos/:photoId/thumbnail` (the narrowest WebP, for the
  admin's lists: its host loads images from itself only).
- `POST .../categories`, `.../categories/order`, `.../categories/:id`, `.../categories/:id/delete`
  (only an empty one).
- `POST .../items/:id/links` (`{ sourceId }`): the item's link for that source, made the first
  time. `409 TRACKING_OFF` without `MPA_DOMAIN`.
- `POST .../sources` (a client-made UUID v7 `id`, `name`, `slug`), `.../sources/order`,
  `.../sources/:id` (at `version`), `.../sources/:id/delete` (with its links).

Public, no session:

- `GET /api/catalog`: the settings, the categories that hold a published item, and every
  published item with its cover.
- `GET /api/catalog/items/:slug`: one published item with its texts, colours, sizes and size
  chart, what is sold out and its photos with every width.
- `GET /api/catalog/photos/:id/:file`: one width, such as `960.webp`, of a published item's photo.
- `GET /api/catalog/links/:code` (`?counted=1` after Umami): `{ location }`, where the website's
  `/s/<code>` sends the visitor.

## Not built yet

The website's shop pages (the list, the item page with Product, Offer, ItemList and BreadcrumbList
structured data, the image sitemap and the `llms.txt` entries) need builders that the shared
library `ts-libs` does not have yet: Product and ItemList JSON-LD, images in a sitemap entry, and
an IndexNow client. They come first in `ts-libs`, then here. Seed has no IndexNow ping today.
