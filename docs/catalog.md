# The catalog

> Also on the website: [seedsaas.com/docs/catalog](https://seedsaas.com/docs/catalog).

This page shows how to turn on a shop's catalog, edited in the admin panel and read by the public
website, and how its tracking links count where visitors come from.

An item has a name and texts in each language the catalog keeps, a price, a category, colours,
sizes with an optional size chart, what is sold out, and photos. The catalog is **off** unless the
product turns it on. Seed's own site leaves it off.

## Turn it on

1. In `infra/envs/.env` (development) or `infra/envs/.env.prod` (the server), set `CATALOG=true`.
2. Set the currency and languages if the defaults do not fit (table below).
3. Restart the stack (`deno task dev`), or deploy (`deno task deploy`).
4. Open **Catalog** in the admin panel.

| Variable            | What it does                                                      | Default |
| ------------------- | ----------------------------------------------------------------- | ------- |
| `CATALOG`           | `true` turns the catalog on. Anything else keeps it off.          | off     |
| `CATALOG_CURRENCY`  | The ISO 4217 code of every price, such as `VND`. One per catalog. | `USD`   |
| `CATALOG_LANGUAGES` | The languages of its texts, comma-separated, the default first.   | `en`    |

With the catalog on, a bad currency or language stops the API at start, naming the variable. With
it off, no catalog route answers and the admin app shows no Catalog entry. The tables exist either
way.

## The model

- **Prices** are whole numbers in the currency's smallest unit (cents, or dong).
- **Texts** are JSON objects keyed by language: `{ "vi": "Áo thun", "en": "T-shirt" }`. The default
  language's name is required; every other text is optional. A reader with no text in their
  language gets the default's.
- **Status.** A new item is a draft. Publishing needs a category and sets `published_at` once.
  Hiding takes the item off the website and keeps the date.
- **Colours and sizes** belong to one item, in its order. Sizes go smallest first.
- **Sold out** is stored per colour and size combination. An item without colours or sizes uses
  `null` for the missing side. Lists show the stock as `in-stock`, `some-sold-out` or `sold-out`.
- **Photos** go through the file store's image pipeline ([Process photos](file-uploads.md#process-photos)). The worker makes
  AVIF and WebP widths, and the admin shows them about a second after the upload. The first photo
  is the cover. A photo may name the colour it shows.

Deleting a photo or its item deletes the stored files too.

## The size chart

Each size may carry a height range (cm) and a weight range (kg), inclusive whole numbers.
`recommendSize(sizes, { heightCm, weightKg })` in `@domain/catalog` answers which size fits:

1. A measure no size has a range for is left out. If no size has either range, the answer is
   `null`.
2. A measure that falls in none of its ranges gives `null`. The person is outside the chart, and a
   guess from the other measure would mislead.
3. Otherwise, the first size whose ranges hold every measure left is the answer.
4. When the height and the weight point at different sizes, the answer is `between` the two, with
   the earlier one as `smaller`.

Each product builds its own storefront calculator; Seed's website has none yet.

## Tracking links

An operator shares one item in many places: a Facebook group, a Zalo group, Instagram. Each place
is a **link source**, with a name and a source tag (its `utm_source`).

1. In the admin panel, open Catalog, then More actions, then **Link sources**, and add a source.
2. Open an item. Its **Share links** card has one row per source.
3. Press **Copy link**. The first press makes the item's link for that source,
   `https://<MPA_DOMAIN>/s/<code>`. Every later press copies the same link.

Making a link, and every change to the sources, writes an audit row. Deleting a source deletes its
links, after a confirm that says how many.

The short link answers on the website with a `302`:

- **With Umami set**, to Umami, which counts the click and sends the visitor on to the item.
- **Without Umami, or while it does not answer**, straight to the item, with `utm_source`,
  `utm_medium=share` and `utm_campaign` set. The item page's Umami tracker still counts the visit.

The address is always built on the server from the item's slug and the website's origin. A link of
a hidden or draft item, or of a deleted source, answers 404.

| Variable            | What it does                                                                  | Default              |
| ------------------- | ----------------------------------------------------------------------------- | -------------------- |
| `MPA_DOMAIN`        | The website's host. Without it, tracking links are off.                       | none                 |
| `CATALOG_ITEM_PATH` | The website's item address, with `{slug}` and optionally `{category}`.        | `/{category}/{slug}` |
| `UMAMI_API_URL`     | Your self-hosted Umami, such as `https://stats.example.com`.                  | none                 |
| `UMAMI_API_TOKEN`   | A token of an Umami user who may create links and read the website. A secret. | none                 |

Set `UMAMI_API_URL` and `UMAMI_API_TOKEN` together or not at all. The admin app's Stats page reads
each source's visits and order clicks back from Umami
([analytics.md](analytics.md#stats-in-the-admin-app)).

### Order buttons

Seed's website draws no order buttons. A product that adds them names their clicks
`order-<channel>`, such as `order-telegram` or `order-zalo`. Umami then shows orders next to
visits:

```html
<a data-umami-event="order-telegram" data-umami-event-item="<item slug>">Order on Telegram</a>
```

## The API

The admin routes are under `/api/admin/catalog`, for operators only, and every write is audited.
The public routes need no session:

| Route                               | What it answers                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/catalog`                  | The settings, categories with a published item, and every published item with its cover, sizes and colours. |
| `GET /api/catalog/items/:slug`      | One published item with its texts, colours, sizes, size chart, sold-out list and photos.                    |
| `GET /api/catalog/photos/:id/:file` | One width of a published photo, such as `960.webp`.                                                         |
| `GET /api/catalog/links/:code`      | `{ location }`: where the website's `/s/<code>` sends the visitor.                                          |

In the list, each item carries its sizes and colours in the item's order, without ids, the size
chart or the other photos: `"sizes": [{ "label": "S", "soldOut": true }]` and
`"colours": [{ "name": { "en": "Red" }, "swatch": "#aa0000", "soldOut": false }]`. A size or a
colour is sold out when every combination holding it is. The item's page has the same `soldOut` on
each of its colours and sizes. The list takes five queries, whatever the number of items.

Photos are JPEG, PNG, WebP or HEIC, up to 20 MB. A category can be deleted only when empty. Item
and source ids are UUID version 7, made by the client. `apps/api/routes/admin/catalog.ts` holds the
admin routes.

## Where the code lives

| Where                                     | What                                                            |
| ----------------------------------------- | --------------------------------------------------------------- |
| `libs/domain/catalog/+lib.ts`             | Shapes, limits, request schemas, field checks, `recommendSize`. |
| `libs/server/catalog/setup.ts`            | The switch and the settings.                                    |
| `libs/server/catalog/postgres-catalog.ts` | The admin's reads and writes, each write with its audit row.    |
| `libs/server/catalog/public-catalog.ts`   | The website's reads: published items only.                      |
| `libs/server/catalog/sample-catalog.ts`   | Sample items for development and the demo.                      |
| `libs/server/catalog/tracking.ts`         | Tracking links: the settings, Umami, where `/s/<code>` leads.   |
| `apps/admin/src/modules/catalog/`         | The admin pages.                                                |
| `apps/mpa/routes/s/[code].ts`             | The website's `/s/<code>` redirect.                             |

## Not built yet

The website's shop pages need builders that `ts-libs` does not have yet: Product and ItemList
JSON-LD, images in a sitemap entry, and an IndexNow client. They come first in `ts-libs`, then here.

## Next

- [Analytics](analytics.md): the Stats page.
- [Process photos](file-uploads.md#process-photos): the image pipeline.
