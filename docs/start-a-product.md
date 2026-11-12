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
| Delete  | The link cards of Seed's posts         | `libs/server/blog/seed-posts/og/`, drawn by `screenshots/blog-og.ts` and `screenshots/blog-og.html` |
| Replace | Home, features, admin and pricing copy | `routes/index.tsx`, `[[lang]]/features.tsx`, `[[lang]]/admin.tsx`, `[[lang]]/pricing.tsx` |
| Rewrite | Every feature and feature page         | `features-data.tsx`, `[[lang]]/features/[slug].tsx`      |
| Replace | The admin page's list of modules       | `admin-modules.ts`, checked by `admin-modules.test.ts`   |
| Delete  | The `/features/admin` redirect, with `/admin` | `routes/features/admin.ts`                        |
| Replace | The blog's name and its one line       | `BLOG_NAME`, `BLOG_INTRO` in `blog.ts`: `Blog.name`, `Blog.intro` in `i18n/site/` |
| Replace | The `llms.txt` summary                 | `HOME_HEAD` in `routes/index.tsx`                        |
| Set     | The licence line of `llms.txt`         | "Source code" in `routes/llms.txt.ts`                    |
| Replace | The privacy policy and terms           | `[[lang]]/privacy.tsx`, `[[lang]]/terms.tsx`             |
| Set     | Name, icon and repository              | `SITE_NAME`, `SITE_ICON`, `REPOSITORY_URL` in `brand.ts` |
| Set     | The product's name in the translators' guide | "Seed" in `i18n/TRANSLATING.md`: its opening lines and "Terms kept in English" |
| Replace | The newsletter's voice                 | Four keys in `i18n/site/` (below)                        |
| Replace | Open Graph images                      | `static/og/`, drawn by `screenshots/og.html`             |
| Replace | Browser frames titled `app.seedsaas.com/…` | `routes/index.tsx`, `features-data.tsx`, `components/features-visuals.tsx` |

`i18n/site/` is at the repository's root, not under `apps/mpa/`: one file per language.

**`/compare` has more parts.** Also delete:

- its entry in `pages.ts`, and its `OG_IMAGES` key and image `static/og/compare.png`;
- the `compare-source` event in `docs/analytics.md` and `e2e/mpa/compare.mpa.ts`;
- the links to it: "Compare" in `site.tsx`, "How Seed compares" in `[[lang]]/features.tsx` and
  `[[lang]]/features/[slug].tsx`, and "the comparison" in `routes/index.tsx`.

**The blog.** The posts load only in demo mode, but they describe Seed. A product writes its posts
in the admin app, and deletes the `og:blog` task in `apps/mpa/deno.json` with the cards' script.
The Lighthouse run measures a fixture post of its own (`lighthouse/posts/`), so the post it reads
needs no change.

**The Lighthouse pages.** `lighthouse/lighthouserc.json` measures Seed's own addresses besides the
shared ones. Delete those of pages the product deleted, and point the rest at the product's own:

- `/compare` and `/pt-BR/compare`, gone with `/compare`;
- `/admin`, if the product drops the admin panel's page;
- `/features/sign-in`, `/features/realtime` and `/features/shortcuts`: the product's own feature
  slugs from `features-data.tsx`;
- `/docs/api`, `/docs/get-started` and `/docs/capacity`: guides listed in the product's
  `docs-list.ts`.

A pull request measures only `QUICK_PATHS` in `lighthouse/quick.ts` (the home page, `/pricing`,
the fixture blog post and `/docs`); each must stay in `lighthouserc.json`, or the check fails.

**Keep `/changelog` and `/docs`.** They read the product's own history and guides. In
`changelog-overrides.ts`, set `CHANGELOG_START` to the full hash of the commit that copied Seed
in, so `/changelog` lists only the changes after it, and empty `CHANGELOG_OVERRIDES`, whose
numbers are Seed's pull requests. The file is the product's own now:
list `apps/mpa/changelog-overrides.ts` in `.seed/skip`, so Seed's later wording never reaches it.
Replace the "built by one developer" line in `[[lang]]/changelog.tsx`.

**The product's own guides.** `/docs` publishes the guides listed in `docs-list.ts`, which holds
nothing else: each guide's import, file, address and line on the index, in groups, and
`DOCS_SITE_ORIGIN`, the address the guides' pointer lines name. `docs-site.ts` draws them and stays
Seed's, so the product keeps taking its fixes.

1. Write the product's guides. They may live in a folder of their own, such as
   `docs/<product>/install.md`; a relative link resolves from the guide's folder, and a link to
   another listed guide opens its page.
2. Replace `docs-list.ts` with the product's guides and its own `DOCS_SITE_ORIGIN`, and list
   `apps/mpa/docs-list.ts` in `.seed/skip`.
3. Start each guide with its pointer line (`pointerLine` in `docs-site.ts`).
4. Replace the `!docs/…` lines in `/.dockerignore` and the `docs/…` lines in
   `/infra/deploy/include.txt` with the product's files; keep `docs/token-api.md` in both. For a
   guide in a folder, `include.txt` also needs a line for the folder, such as `docs/<product>/`,
   since rsync skips a file whose folder it was not told to enter. A sync that changes these two
   lists may conflict; keep the product's lines.
5. In `/.woodpecker/ci.yml`, add the folder, such as `docs/<product>/*.md`, to the Lighthouse
   step's `path` list next to `docs/*.md`, so a pull request that changes a guide measures the
   site.

`apps/mpa/docs-site.test.ts` and `tests/dockerignore.test.ts` check each listed guide: its import,
its pointer line and its lines in both deploy lists.

**The newsletter keys** are `NewsletterPage.lead`, `NewsletterPage.subscribeDescription`,
`HomeNewsletter.lead` and `NewsletterOff.lead`. Replace the Releases on GitHub button too. Their
uses in `subscribers.tsx` and `routes/index.tsx` are marked.

**A website frame of its own.** A product that replaces `SiteFrame` keeps Seed's newsletter
confirm and unsubscribe pages, the ones a mailed link opens, without copying their token flow.
`apps/mpa/token-pages.tsx` builds their handlers from a frame the product passes: how to draw a
page, the screens' `localize`, `onward` and `language`, and its "newsletter off" page. The flow
itself (the API calls, the statuses, `Retry-After`, `Referrer-Policy`, the redirect after a
finished step) stays Seed's, so a sync brings its fixes:

```tsx
const frame: TokenPageFrame = {
  screen: () => ({ localize, onward: { href: `/`, label: `Back to the shop` } }),
  render: (ctx, page, init) => ctx.render(<ShopFrame path={page.path}>{page.screen}</ShopFrame>, init),
  off: (ctx, page, init) => ctx.render(<ShopFrame path={page.path}><Off /></ShopFrame>, init),
}
export const confirmHandlers = createSubscriptionConfirmHandlers(frame)
export const unsubscribeHandlers = createUnsubscribeHandlers(frame)
```

The screens read their words through `I18nContext`, so `render` can wrap `page.screen` in a
provider with the product's translator.

## Pictures and videos

| What                     | Where                                     | Recorded by                                  |
| ------------------------ | ----------------------------------------- | -------------------------------------------- |
| Website screenshots      | `static/shots/`                           | `screenshots/capture.ts`                     |
| The admin video          | `media/video/admin-panel.*`, `static/video/admin-panel-*` | `deno task video:admin`      |
| The three feature loops  | `media/video/*-loop-*`, `static/video/*-loop-*` | `deno task loops` in `apps/mpa` (`screenshots/loops.ts`) |
| README pictures          | `docs/screenshots/`                       | `docs/screenshots/record.ts`                 |

`deno task video:admin`, run from the repository's root, records the video with
`docs/screenshots/admin-video.ts`. It prints the files' length and sizes: write them, the date and
the transcript into `admin-video.ts` (this one under `apps/mpa/`), which the website reads for the
line under the player and the structured data.

The feature loops show Seed's own app. `loops.ts` names them and `components/feature-loop.tsx`
draws them on the website: replace both with the product's own clips, or delete them with the
`loops` task and their uses. The GitHub social preview says `seedsaas.com` too; replace it.

## The product's name, icon and colour in the apps

| File                      | What says "Seed"                                                       |
| ------------------------- | ---------------------------------------------------------------------- |
| `libs/ui/brand.ts`        | `PRODUCT_NAME`: the brand marks, the manifest and the admin tab titles |
| `apps/spa/index.html`     | `<title>` and `apple-mobile-web-app-title`                             |
| `apps/admin/index.html`   | `<title>`                                                              |
| `libs/ui/frame.tsx`       | The `Icon` of the `BrandMark`                                          |

The browser specs read `PRODUCT_NAME`, so they pass unchanged after a rename. These unit tests
check the name: `libs/ui/admin-frame.test.tsx` and `libs/ui/account.test.tsx`.

The pictures carry no mark. Replace each with the product's own, at the same size and name:

| Picture                       | Files                                                          |
| ----------------------------- | -------------------------------------------------------------- |
| The app's favicons            | `apps/spa/public/favicon.svg`, `favicon.ico`, `favicon-96x96.png` |
| The home screen icons         | `apps/spa/public/apple-touch-icon.png`, `img/android/`, `img/pwa/` |
| The admin app's favicon       | `apps/admin/public/favicon.svg`                                |
| The website's favicon         | `apps/mpa/static/favicon.svg`                                  |

**The brand colour.** Seed's purple, hue 305°, is `--color-primary` and `--color-accent` in
`libs/ui/brand.css`, which the app, the admin app and the website all load. Set the product's own
there.

## Settings

| Do     | What                                     | Where                                                   |
| ------ | ---------------------------------------- | ------------------------------------------------------- |
| Set    | The crawler policy                       | `ROBOTS_POLICY` in `apps/mpa/config.ts`                 |
| Set    | Analytics ids ([Analytics](analytics.md)) | `MPA_UMAMI_ORIGIN`, `MPA_UMAMI_WEBSITE_ID` in the env file |
| Set    | Domains and the demo ([demo](demo.md))   | `MPA_DOMAIN`, `DOMAIN`, `DEMO_MODE` in the env file     |
| Set    | A website with no customers              | `SPA=false` ([Without the SPA](apps.md#without-the-spa)) |
| Set    | A product without the notes example      | `NOTES=false` (below)                                   |
| Set    | Where release images go                  | `IMAGE_PREFIX` in `.woodpecker/release.yml`             |
| Set    | The billing guide link                   | `ADMIN_BILLING_SETUP_URL` in `libs/ui/admin-billing-list.tsx` |
| Set    | The Stats guide link                     | `ADMIN_STATS_SETUP_URL` in `libs/ui/admin-stats-screen.tsx` |

`NOTES=false` turns the notes example off while its files stay as Seed has them, so later syncs
merge cleanly. The API then answers 404 to every note, tag and attachment route and to the
personal-token API (`/api/v1`), which serves notes only, and refuses their operations over the
socket and `/api/call` as unknown ones. The changes pull, the admin app's group widgets and files
and the Telegram bot's `/notes` leave them out too; moving a group's data leaves notes and tags
where they are, and a new account gets no welcome note. The tables and migrations stay, as the
catalog's do. Unset or anything but `false` keeps the notes on. The app's screens, the export and
the demo still show notes for now.

Create the first operator on the server; it needs no mail
([The first operator](operator-access.md#the-first-operator)):

```sh
deno task operator:create <address>
```

## The repository's own files

- **Replace** the demo and website links, the CI badge, the author section and the admin video
  link in `README.md`.
- **Set** the licence holder in `LICENSE`. A product under another licence replaces `LICENSE`
  with its own and keeps Seed's MIT notice, which the MIT licence requires for the copied code, in
  a file of its own, such as `LICENSES/MIT-seed.txt`. It also changes "under the MIT licence" in
  the licence line of `routes/llms.txt.ts` (above).
- **Delete** `AGENTS.seed.md`, which holds the rules of Seed's own repository, and the lines in
  `AGENTS.md` and `CLAUDE.md` that name it. List it in `.seed/skip`, as
  [step 3](products.md#start-a-product) says.
- **Keep** `AGENTS.md`, and add the product's own rules to it.

## Next

- [Building a product on Seed](products.md): take Seed's later changes.
- [Deploy](deploy.md)
