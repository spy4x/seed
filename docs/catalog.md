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
  queues `files.image-process`; the worker makes AVIF and WebP widths. The first photo is the
  cover. A photo may name the colour it shows. Deleting a photo or its item deletes the `images`
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

## Where it lives

| Where                                           | What                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `libs/domain/catalog/+lib.ts`                   | Shapes, limits, request schemas, field checks, `recommendSize`, errors.  |
| `libs/server/catalog/setup.ts`                  | `readCatalogSetup`: the switch and the settings.                         |
| `libs/server/catalog/postgres-catalog.ts`       | The admin's reads and writes, each write with its audit row.            |
| `libs/server/catalog/public-catalog.ts`         | The website's reads: published items only.                               |
| `libs/server/catalog/sample-catalog.ts`         | Three categories and six items for development and the public demo.      |
| `apps/api/routes/admin/catalog.ts`              | `/api/admin/catalog*`, behind the operator gate.                         |
| `apps/api/routes/catalog.ts`                    | `/api/catalog*`, public, mounted only while the catalog is on.           |
| `apps/admin/src/modules/catalog/`               | The admin pages: the list, the item editor, the categories.              |
| `libs/ui/admin-catalog.tsx`, `admin-catalog-item.tsx` | Their screens.                                                     |

## The API

Admin, operator only, every write audited (`catalog.*` kinds in the audit log):

- `GET /api/admin/catalog`: the settings, every category and every item.
- `GET /api/admin/catalog/items/:id`; `POST /api/admin/catalog/items` (a client-made UUID v7
  `id` and the fields); `POST .../items/:id` (the fields at `version`); `.../status`
  (`published` or `hidden`); `.../delete`.
- `POST .../items/:id/photos?id=<photo id>`: one photo's bytes, its type as `Content-Type` (JPEG,
  PNG, WebP or HEIC, up to 20 MB). The same photo id again answers the first photo.
- `POST .../items/:id/photos/order` (`{ ids }`), `.../photos/:photoId` (`{ alt, colourId }`),
  `.../photos/:photoId/delete`; `GET .../photos/:photoId/thumbnail` (the narrowest WebP, for the
  admin's lists: its host loads images from itself only).
- `POST .../categories`, `.../categories/order`, `.../categories/:id`, `.../categories/:id/delete`
  (only an empty one).

Public, no session:

- `GET /api/catalog`: the settings, the categories that hold a published item, and every
  published item with its cover.
- `GET /api/catalog/items/:slug`: one published item with its texts, colours, sizes and size
  chart, what is sold out and its photos with every width.
- `GET /api/catalog/photos/:id/:file`: one width, such as `960.webp`, of a published item's photo.

## Not built yet

The website's shop pages (the list, the item page with Product, Offer, ItemList and BreadcrumbList
structured data, the image sitemap and the `llms.txt` entries) need builders that the shared
library `ts-libs` does not have yet: Product and ItemList JSON-LD, images in a sitemap entry, and
an IndexNow client. They come first in `ts-libs`, then here. Seed has no IndexNow ping today.
