# Start a product: what belongs to Seed's own website

Seed's repository is both the template and the home of seedsaas.com, Seed's own website. Some of
it describes Seed, names its competitors or sells its author's paid work. A product started from
Seed must not go live with any of that: it would carry someone else's offer and prices, and
claims about competitors the product never checked.

Work through this list in the product's first pull requests, next to the steps in
[Building a product on Seed](products.md#start-a-product). Every place in a file that can hold a
comment is also marked with `Seed's own site: see docs/start-a-product.md`, so this finds what is
left (images, `LICENSE`, `AGENTS.md` and the env file carry no mark):

```sh
git grep -n "Seed's own site"
```

Each item says what the product does: **delete** it, **replace** it with its own, or **set** a
value. A file the product deletes or takes over completely goes into `.seed/skip`, so later syncs
from Seed leave it out. Tests follow the code: `apps/mpa/site.test.ts` and the browser tests in
`e2e/mpa/` check some of these values, and change with them.

## The author and his paid work

- **Set** `AUTHOR_URL` in `apps/mpa/brand.ts`: the author's own site.
- **Delete** `apps/mpa/hire.ts`: the author's prices (`HIRE_PRICES`) and his MVP offer
  (`HIRE_PAGE_URL`). Its other importers change with it: `apps/mpa/routes/[[lang]]/pricing.tsx` (the FAQ
  on how `HIRE_PRICES.mvpFrom` is worked out, and a hire link), `apps/mpa/routes/index.tsx` (the
  link in `WhoBuilds`), `apps/mpa/site.tsx`, `apps/mpa/error-page.tsx`,
  `apps/mpa/components/pricing-ways.tsx` and `apps/mpa/site.test.ts`.
- **Delete** the `/mvp` redirect to that offer, `apps/mpa/routes/mvp.ts`, and its browser test
  `e2e/mpa/mvp.mpa.ts`.
- **Replace** "Hire me", "About Anton" and the "Built in public by" line in the header and footer:
  `NAV_LINKS`, `footerGroups` and `SiteFrame` in `apps/mpa/site.tsx`.
- **Replace** `PERSON_JSON_LD` in `apps/mpa/site.tsx`: the Person (Anton Shubin) and his company
  (NeatSoft PTE LTD) in the structured data. `apps/mpa/routes/index.tsx`, `routes/features.tsx`,
  `routes/pricing.tsx` and `routes/compare.tsx` use it.
- **Replace** the "Who builds Seed" band, `WhoBuilds` in `apps/mpa/routes/index.tsx`.
- **Delete** the founders' band that sends to the MVP offer,
  `apps/mpa/components/founders-handoff.tsx`, and its use, `<FoundersHandoff />` in
  `apps/mpa/routes/index.tsx`.
- **Replace** the "have it built" card with the author's prices,
  `apps/mpa/components/pricing-ways.tsx`.
- **Delete** the hire link on the error page, `apps/mpa/error-page.tsx`, and the `hire-me` event
  in `docs/analytics.md`.

## Seed's own pages and copy

- **Delete** `/compare`: named competitors, their prices and the day they were checked. That is
  `apps/mpa/routes/[[lang]]/compare.tsx`, the card component only it uses,
  `apps/mpa/components/compare-alternatives.tsx`, its entry in `apps/mpa/pages.ts`, its Open
  Graph image `apps/mpa/static/og/compare.png` with the `compare` key of `OG_IMAGES` in
  `apps/mpa/site.tsx`, the `compare-source` event in `docs/analytics.md`, and its browser test
  `e2e/mpa/compare.mpa.ts`. Remove the links to it too, or they lead nowhere: "Compare" in the
  header (`NAV_LINKS`) and footer (`footerGroups`) in `apps/mpa/site.tsx`, "How Seed compares"
  in `apps/mpa/routes/[[lang]]/features.tsx` and "the comparison" in `apps/mpa/routes/index.tsx`.
- **Replace** the page copy and FAQs of the home, features, admin and pricing pages:
  `apps/mpa/routes/index.tsx`, `routes/features.tsx`, `routes/admin.tsx`, `routes/pricing.tsx`.
- **Replace** the `llms.txt` summary. It is the home page's description, `HOME_HEAD` in
  `apps/mpa/routes/index.tsx`; the page list follows `apps/mpa/pages.ts` by itself.
- **Set** the licence line in `llms.txt`: the "Source code" entry in `apps/mpa/routes/llms.txt.ts`
  says the code is under the MIT licence. Name the product's own licence, or drop the line.
- **Replace** the privacy policy and terms, written for seedsaas.com and its demo:
  `apps/mpa/routes/[[lang]]/privacy.tsx`, `apps/mpa/routes/[[lang]]/terms.tsx`.
- **Set** `SITE_NAME` and `REPOSITORY_URL` in `apps/mpa/brand.ts`.
- **Replace** the Open Graph images in `apps/mpa/static/og/`, drawn by
  `apps/mpa/screenshots/og.html`.
- **Replace** the product screenshots and the admin video: `apps/mpa/static/shots/`,
  `apps/mpa/static/video/` and `apps/mpa/media/video/`, taken by `apps/mpa/screenshots/capture.ts`
  and `apps/mpa/admin-video.ts`.
- **Replace** the browser frames titled `app.seedsaas.com/…` in `apps/mpa/routes/index.tsx`,
  `apps/mpa/routes/[[lang]]/features.tsx` and `apps/mpa/components/features-visuals.tsx`.

## The product's name in the apps

The SPA and the admin app say "Seed" in the browser tab, the installed app's name and the brand
mark. **Replace** each with the product's name:

- `apps/spa/index.html`: the `<title>` and the `apple-mobile-web-app-title` meta.
- `apps/spa/vite.config.ts`: `name` and `short_name` in the web app manifest.
- `apps/admin/index.html`: the `<title>` (`Admin · Seed`).
- `libs/ui/frame.tsx`: the `name` of the `BrandMark` in the app frame.
- `libs/ui/admin-frame.tsx`: `ADMIN_PRODUCT`, which names the admin's tab titles and brand mark.

These tests check the name and change with it: `libs/ui/admin-frame.test.tsx`,
`libs/ui/account.test.tsx` (the brand mark), `e2e/pwa.e2e.ts` (the manifest's names) and
`e2e/app-shell-parity.e2e.ts` (the admin tab title).

## Settings

- **Set** the crawler policy, `ROBOTS_POLICY` in `apps/mpa/config.ts`.
- **Set** the analytics ids, `MPA_UMAMI_ORIGIN` and `MPA_UMAMI_WEBSITE_ID`, in the server's env
  file (`infra/envs/.env.example` lists them), as [Analytics](analytics.md) says.
- **Set** the domains and whether the public demo runs: `MPA_DOMAIN`, `DOMAIN` and `DEMO_MODE` in
  the env file ([The public demo](demo.md)).
- **Set** whether the product has signed-in customers: a website and its admin panel only sets
  `SPA=false` in the env file, which keeps the SPA off and closes sign-up ([Without the
  SPA](deploy.md#without-the-spa)), and drops the website's sign-in and sign-up links.
- **Create** the first operator on the server with `deno task operator:create <address>`, which
  needs no mail ([The first operator](deploy.md#the-first-operator)).
- **Set** where release images go, `IMAGE_PREFIX` in `.woodpecker/release.yml`.

## The repository's own files

- **Replace** the README's demo and website links, CI badge, author section and admin video link
  in `README.md`.
- **Replace** the README's pictures in `docs/screenshots/` and the GitHub social preview, whose
  card says `seedsaas.com`: `docs/screenshots/record.ts` records them.
- **Set** the licence holder in `LICENSE`.
- **Replace** `AGENTS.md` with the product's own, as
  [step 3](products.md#start-a-product) says: it applies Seed's `AGENTS.md` except the sections
  "The live demo is not production" and "Financy", which hold for the template only.
