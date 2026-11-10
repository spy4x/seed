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
([analytics.md](analytics.md#stats-in-the-admin-app)). With Stats on, the item's **Share links**
card shows the last 30 days too: the item's views and order clicks in its header, with a **See in
Stats** button, and each source's visits and order clicks on the item's page under its link. The
numbers load after the item, and the links and **Copy link** work while they load, while Stats is
off and while Umami does not answer.

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
| `apps/mpa/catalog.ts`                     | The website's reads, addresses, texts and sitemap entries.      |
| `apps/mpa/components/catalog.tsx`         | The tiles, the category links and the price.                    |
| `apps/mpa/routes/[[lang]]/catalog/`       | The catalog and category pages.                                 |
| `apps/mpa/routes/[[lang]]/[category]/`    | The item page.                                                  |
| `apps/mpa/routes/catalog/photos/`         | The photos, served from the website's host.                     |

## The website's pages

While the catalog is on, the website (`apps/mpa`) shows it. The pages are rendered on the server and
work without JavaScript.

| Address               | What it shows                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/catalog`            | Every published item as a tile: the cover, the name, the price, the sizes and colours, and "Sold out". Links to each category.                                |
| `/catalog/<category>` | That category's items. A category with no published item is the 404 page.                                                                                     |
| `/<category>/<slug>`  | One item: its photos, cover first, the price, the colours and sizes with the sold-out ones marked, the description, material, fit and care, and a breadcrumb. |

- **The item's address** is `CATALOG_ITEM_PATH`'s default, `/{category}/{slug}`, where tracking
  links lead. Every other page of the website wins over it, so a category whose slug is the name of
  a page (`blog`, `docs`, `features`, `pricing`, `catalog`, `s`, `video`) or a language code (`de`) is never
  reached at that address. Pick category slugs that are none of these.
- **Colours and sizes** are links (`?colour=<id>&size=<id>`). Once both are picked, the page says
  whether that choice is in stock. The canonical address stays the item's.
- **Languages.** The address without a language prefix always exists; `/de/catalog` and the like
  exist only for languages both the website and the catalog keep. A text missing in the page's
  language is shown in the catalog's default language.
- **Prices** are formatted for the page's language in the catalog's currency.
- **Photos** are served from the website's own host, at `/catalog/photos/<id>/<width>.<avif|webp>`,
  read from the API's photo address. An item without a ready photo shows a neutral placeholder.
- **Structured data.** The catalog and category pages publish an `ItemList` of their items, and
  every catalog page a `BreadcrumbList`. An item with photos publishes a `Product` with one
  `Offer`, or a `ProductGroup` with one variant per colour and size, each `InStock` or `OutOfStock`.
  Google's product result needs a photo, so an item without one publishes none.
- **Sitemap and `llms.txt`.** The sitemap lists the catalog, category and item pages, each item with
  its cover as an image entry. `llms.txt` has a Catalog section with the catalog and each category.

While the catalog is off (`/api/catalog` answers 404), every one of these addresses is the 404
page, and neither the sitemap nor `llms.txt` names the catalog. The website has no menu link to the
catalog: a product adds its own.

## Next

- [Analytics](analytics.md): the Stats page.
- [Process photos](file-uploads.md#process-photos): the image pipeline.
