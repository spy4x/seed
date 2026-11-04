# Start a product: what belongs to Seed's own website

> Also on the website: [seedsaas.com/docs/start-a-product](https://seedsaas.com/docs/start-a-product).

This page lists what a new product removes or replaces, because it describes Seed, its competitors
or its author's paid work.

You need:

- The product's repository, made as [Building a product on Seed](products.md#start-a-product) says.
- Its own name, domains, licence and privacy policy.

Seed's repository is also the home of seedsaas.com. A product that goes live with that content
would carry someone else's offer and prices, and claims about competitors it never checked.

## Find what is left

Every file that can hold a comment marks such a place with `Seed's own site: see
docs/start-a-product.md`. Images, `LICENSE`, `AGENTS.md` and the env file carry no mark.

```sh
git grep -n "Seed's own site"
```

Each row says what to do: **delete** it, **replace** it with the product's own, or **set** a value.
A file the product deletes or takes over goes into `.seed/skip`, so later syncs leave it out.
Tests follow the code: `apps/mpa/site.test.ts` and `e2e/mpa/` check some of these values.

The paths below are under `apps/mpa/` unless they say otherwise. `[[lang]]/` stands for
`routes/[[lang]]/`.

## The author and his paid work

| Do      | What                              | Where                                                         |
| ------- | --------------------------------- | ------------------------------------------------------------- |
| Set     | The author's own site             | `AUTHOR_URL` in `brand.ts`                                    |
| Delete  | His prices and MVP offer          | `hire.ts`, and its uses (below)                               |
| Delete  | The `/mvp` redirect               | `routes/mvp.ts`, `e2e/mpa/mvp.mpa.ts`                         |
| Replace | "Hire me", "About Anton", "Built in public by" | `NAV_LINKS`, `footerGroups`, `SiteFrame` in `site.tsx` |
| Replace | The author and his company in structured data | `PERSON_JSON_LD` in `site.tsx`                 |
| Replace | The "Who builds Seed" band        | `WhoBuilds` in `routes/index.tsx`                             |
| Delete  | The founders' band                | `components/founders-handoff.tsx`, `<FoundersHandoff />`      |
| Replace | The "have it built" card          | `components/pricing-ways.tsx`                                 |
| Delete  | The hire link and its event       | `error-page.tsx`, `hire-me` in `docs/analytics.md`            |

`hire.ts` is also imported by `[[lang]]/pricing.tsx`, `routes/index.tsx`, `site.tsx` and
`site.test.ts`. The pricing FAQ on how `HIRE_PRICES.mvpFrom` is worked out goes with it.

## Seed's own pages and copy

| Do      | What                                   | Where                                                    |
| ------- | -------------------------------------- | -------------------------------------------------------- |
| Delete  | `/compare`, named competitors' prices  | `[[lang]]/compare.tsx`, `components/compare-alternatives.tsx` |
| Delete  | Seed's blog posts, except `README.md`  | `libs/server/blog/seed-posts/`                           |
| Replace | Home, features, admin and pricing copy | `routes/index.tsx`, `[[lang]]/features.tsx`, `admin.tsx`, `pricing.tsx` |
| Rewrite | Every feature and feature page         | `features-data.tsx`                                      |
| Replace | The `llms.txt` summary                 | `HOME_HEAD` in `routes/index.tsx`                        |
| Set     | The licence line of `llms.txt`         | "Source code" in `routes/llms.txt.ts`                    |
| Replace | The privacy policy and terms           | `[[lang]]/privacy.tsx`, `[[lang]]/terms.tsx`             |
| Set     | Name, icon and repository              | `SITE_NAME`, `SITE_ICON`, `REPOSITORY_URL` in `brand.ts` |
| Replace | The newsletter's voice                 | Four keys in `i18n/site/` (below)                        |
| Replace | Open Graph images                      | `static/og/`, drawn by `screenshots/og.html`             |
| Replace | Browser frames titled `app.seedsaas.com/…` | `routes/index.tsx`, `features-data.tsx`, `components/features-visuals.tsx` |

**`/compare` has more parts.** Also delete:

- its entry in `pages.ts`, and its `OG_IMAGES` key and image `static/og/compare.png`;
- the `compare-source` event in `docs/analytics.md` and `e2e/mpa/compare.mpa.ts`;
- the links to it: "Compare" in `site.tsx`, "How Seed compares" in `[[lang]]/features.tsx` and
  `[[lang]]/features/[slug].tsx`, and "the comparison" in `routes/index.tsx`.

**The blog.** The posts load only in demo mode, but they describe Seed. A product writes its posts
in the admin app. The Lighthouse run measures a fixture post of its own, so it needs no change.

**Keep `/changelog` and `/docs`.** They read the product's own history and guides. In
`changelog-overrides.ts`, set `CHANGELOG_START` to the full hash of the commit that copied Seed
in, so `/changelog` lists only the changes after it, and empty `CHANGELOG_OVERRIDES`, whose
numbers are Seed's pull requests. The file is the product's own now:
list `apps/mpa/changelog-overrides.ts` in `.seed/skip`, so Seed's later wording never reaches it.
Set `PUBLISHED_DOCS` and `DOCS_SITE_ORIGIN` in `docs-site.ts`. Replace the "built by one
developer" line in `[[lang]]/changelog.tsx`.

**The newsletter keys** are `NewsletterPage.lead`, `NewsletterPage.subscribeDescription`,
`HomeNewsletter.lead` and `NewsletterOff.lead`. Replace the Releases on GitHub button too. Their
uses in `subscribers.tsx` and `routes/index.tsx` are marked.

## Pictures and videos

| What                     | Where                                     | Recorded by                                  |
| ------------------------ | ----------------------------------------- | -------------------------------------------- |
| Website screenshots      | `static/shots/`                           | `screenshots/capture.ts`                     |
| The admin video          | `media/video/admin-panel.*`, `static/video/` | `deno task video:admin`                   |
| The three feature loops  | `media/video/*-loop-*`                    | `deno task loops` in `apps/mpa`              |
| README pictures          | `docs/screenshots/`                       | `docs/screenshots/record.ts`                 |

`deno task video:admin` runs `docs/screenshots/admin-video.ts`. Then update the video's length,
size, date and transcript in `admin-video.ts`. The GitHub social preview says `seedsaas.com` too;
replace it.

## The product's name in the apps

| File                         | What says "Seed"                                       |
| ---------------------------- | ------------------------------------------------------ |
| `apps/spa/index.html`        | `<title>` and `apple-mobile-web-app-title`             |
| `apps/spa/vite.config.ts`    | `name` and `short_name` in the web app manifest        |
| `apps/admin/index.html`      | `<title>`                                              |
| `libs/ui/frame.tsx`          | The `name` of the `BrandMark`                          |
| `libs/ui/admin-frame.tsx`    | `ADMIN_PRODUCT`, the admin's tab titles and brand mark |

These tests check the name: `libs/ui/admin-frame.test.tsx`, `libs/ui/account.test.tsx`,
`e2e/pwa.e2e.ts` and `e2e/app-shell-parity.e2e.ts`.

## Settings

| Do     | What                                     | Where                                                   |
| ------ | ---------------------------------------- | ------------------------------------------------------- |
| Set    | The crawler policy                       | `ROBOTS_POLICY` in `apps/mpa/config.ts`                 |
| Set    | Analytics ids ([Analytics](analytics.md)) | `MPA_UMAMI_ORIGIN`, `MPA_UMAMI_WEBSITE_ID` in the env file |
| Set    | Domains and the demo ([demo](demo.md))   | `MPA_DOMAIN`, `DOMAIN`, `DEMO_MODE` in the env file     |
| Set    | A website with no customers              | `SPA=false` ([Without the SPA](apps.md#without-the-spa)) |
| Set    | Where release images go                  | `IMAGE_PREFIX` in `.woodpecker/release.yml`             |
| Set    | The billing guide link                   | `ADMIN_BILLING_SETUP_URL` in `libs/ui/admin-billing-list.tsx` |

Create the first operator on the server; it needs no mail
([The first operator](operator-access.md#the-first-operator)):

```sh
deno task operator:create <address>
```

## The repository's own files

- **Replace** the demo and website links, the CI badge, the author section and the admin video
  link in `README.md`.
- **Set** the licence holder in `LICENSE`.
- **Delete** `AGENTS.seed.md`, which holds the rules of Seed's own repository, and the lines in
  `AGENTS.md` and `CLAUDE.md` that name it. List it in `.seed/skip`, as
  [step 3](products.md#start-a-product) says.
- **Keep** `AGENTS.md`, and add the product's own rules to it.

## Next

- [Building a product on Seed](products.md): take Seed's later changes.
- [Deploy](deploy.md)
