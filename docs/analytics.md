# Website analytics

The public website (`apps/mpa`) can count visits and clicks in a self-hosted
[Umami](https://umami.is). It is off until you turn it on. Umami sets no cookies and stores no
personal data, and the tracker honours Do Not Track. The demo app (the SPA) counts nothing.

## Turn it on

1. Add the website in your Umami and copy its id.
2. Set both values in the env file and deploy (`deno task deploy`):

   ```
   MPA_UMAMI_ORIGIN=https://stats.example.com
   MPA_UMAMI_WEBSITE_ID=<the website id>
   ```

   Set both or neither: the website refuses to start with one alone. The id is written into every
   page, so it is not a secret.
3. Create the goals and funnels below in Umami (Reports). Their names are the convention; Umami
   matches nothing by name.
4. Update the privacy page (`apps/mpa/routes/privacy.tsx`) if your setup differs: it describes
   this one.

With both values set, every page loads two deferred scripts: Umami's `/script.js` from
`MPA_UMAMI_ORIGIN`, and the website's own `/analytics.js`. The content security policy then
allows that origin in `script-src` and `connect-src`, and nowhere else
([security-headers.md](security-headers.md)). The tracker counts only on `MPA_DOMAIN`
(`data-domains`), so a local copy run with production values sends nothing. Umami drops known bots
on its server. Pages work the same without either script.

A page whose address carries a `token` (a newsletter mail's confirm or unsubscribe link) loads
neither script, so the token never reaches Umami. The page it redirects to after the click has no
token, and is counted.

## How events are sent

- **Clicks on links and buttons the website draws**: Umami's own `data-umami-event` attribute,
  with properties as `data-umami-event-<name>`. Umami sends them; no code of ours runs.
- **Links the shared header and footer draw**, which take no attributes: `/analytics.js` names a
  click on a link without `data-umami-event` from where it goes (the list below).
- **Forms, a page shown, and the video**: `/analytics.js`, from the markers
  `data-analytics-submit` (with `data-analytics-field`), `data-analytics-view` and
  `data-analytics-video`.

Event names are kebab-case. Umami stores the page of every event, so a name never repeats the page.

## Events

<!-- Seed's own site: see docs/start-a-product.md (hire-me, compare-source) -->

| Event                     | Properties                    | When                                                                                 |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `try-demo`                | `from`                        | A link to the demo's sign-up: header, hero, closing band, 404 page, footer           |
| `sign-in`                 | `from`                        | The footer's link to the demo's sign-in                                              |
| `github`                  | `from`                        | A link into the GitHub repository that names no other event                          |
| `read-code`               | `from`                        | A link to a part of the code or its docs ("Read the code", the deploy guide)         |
| `hire-me`                 | `from`                        | A button or link to antonshubin.com's MVP page                                      |
| `compare-source`          | `product`                     | A source link of a compared product on `/compare`                                    |
| `on-this-page`            | `section`                     | A link of the "On this page" list (`/features`, `/privacy`, `/terms`)                |
| `outbound-link`           | `url`, `from`                 | Any other link to another site                                                       |
| `internal-link`           | `to`, `from`                  | A link within the website that names no event (header, footer, cards, text links)    |
| `pricing-plan`            | `planId`                      | A demo plan's "Try in the demo" form on `/pricing`                                   |
| `newsletter-subscribe`    |                               | A newsletter form submitted (home page, footer, `/subscribe`)                        |
| `newsletter-sent`         | `path`                        | The page that says the confirm mail is on its way                                    |
| `newsletter-confirmed`    | `path`                        | The page after the confirm link worked                                               |
| `newsletter-unsubscribed` | `path`                        | The page after an unsubscribe                                                        |
| `not-found`               | `path`                        | The 404 page                                                                         |
| `error-page`              | `path`                        | The 500 page                                                                         |
| `admin-video-play`        |                               | The first play of the admin panel video in a page view                               |
| `admin-video-progress`    | `percent` (25, 50, 75, 100)   | Each quarter of the video watched, once per page view                                |
| `admin-video-ended`       |                               | The video played to its end                                                          |
| `admin-video-download`    | `from` (`player`, `transcript`) | A link to the MP4                                                                  |
| `admin-transcript-jump`   |                               | "Read what the video shows" on `/admin`                                              |
| `features-admin-video`    | `from` (`lead`, `still`)      | A link from `/features` to the video on `/admin`                                     |
| `home-admin-card`         |                               | The admin card on the home page                                                      |

`from` names the place on the page: `header`, `footer`, `hero`, `cta` (the closing band), or a
section's own name. For a link `/analytics.js` names, it is `header`, `footer`, or the `id` of the
nearest element that has one.

## Goals and funnels

These exist in the Umami of seedsaas.com. A product built on Seed creates its own.

| Report                                                  | What it counts                                    |
| ------------------------------------------------------- | ------------------------------------------------- |
| Goal: `try-demo`                                        | Clicks on "Try the demo", from every place        |
| Goal: `github`                                          | Clicks through to the repository                  |
| Goal: `newsletter-sent`                                 | Newsletter sign-ups the API accepted              |
| Goal: `newsletter-confirmed`                            | Newsletter sign-ups confirmed from the mail       |
| Goal: `admin-video-ended`                               | The admin panel video watched to the end          |
| Funnel: any page (`/*`) → `try-demo`, 60 minutes        | Of all visitors, how many try the demo            |
| Funnel: `/admin` → `admin-video-play` → `admin-video-ended`, 60 minutes | Of the visitors to `/admin`, how many start and finish the video |

The demo's sign-up page is not a funnel step: the SPA loads no tracker, so Umami never sees it.
`try-demo` is the last step the website can see.

## Where the code is

| What                                          | File                                     |
| --------------------------------------------- | ---------------------------------------- |
| The two env values, read and checked          | `apps/mpa/config.ts`                     |
| The policy's extra origin                     | `apps/mpa/middleware.ts`                 |
| The two script tags                           | `apps/mpa/routes/_app.tsx`               |
| Forms, pages shown, the video, unnamed links  | `apps/mpa/static/analytics.js`           |
| Tests                                         | `apps/mpa/config.test.ts`, `apps/mpa/app.test.ts`, `apps/mpa/site.test.ts`, `e2e/mpa/analytics.mpa.ts` |
