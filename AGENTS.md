# AGENTS.md — Seed

Read `README.md` and `CONTRIBUTING.md` first. The global agent instructions own Git Flow, review
and cleanup; this file adds what is specific to this repo.

## Three layers of UI

Every piece of UI has one home:

| Layer               | Home                                                                | Examples                                                       |
| ------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Generic primitives  | `spy4x/preact-components` (JSR)                                     | `Button`, `Field`, `Card`, `EnhancedForm`, `AuthForm`, `Shell` |
| Product screens     | `libs/ui` (workspace member, alias `@ui/`)                          | `AuthScreen`, `ProfileScreen`, `AppFrame`, `PublicFrame`       |
| State and transport | the SPA (`apps/spa/src/views`) and the admin app (`apps/admin/src`) | stores, `fetch`, WebSocket, the router                         |

Anything a future product could use goes to preact-components first. `libs/ui` keeps only what
names this template's features. An app's view is wiring: it holds state, calls the API and passes
both to a screen.

The three apps have different jobs. The SPA (`apps/spa`) is the product: everything a signed-in
person does happens there. The admin app (`apps/admin`) is the operator area, on a host of its own.
The MPA (`apps/mpa`, Fresh) is the product's public website: the home page, pricing, the legal pages
and the newsletter. It has no session, links to the SPA for sign-in and sign-up, and renders no
`libs/ui` screen except the newsletter's (`subscribe-screen.tsx`).

**The MPA's pages work without JavaScript.** Every page is rendered on the server, and every action
is a real `<form method="post" action="…">` or `<a href="…">`. The newsletter screens keep that
rule because the MPA renders them; their form actions are listed in `FORM_ACTIONS`
(`libs/ui/progressive.tsx`).

Every `libs/ui` component follows this contract. A part marked **open** is not met yet; its issue
says what is missing. Do not copy the gap into a new screen.

- **For the SPA, and allowed to rely on JavaScript.** Menus, dialogs and disclosures are fine; a
  screen need not render every form open. The exception is the newsletter screens above.
- **Pure.** Props in, callbacks out. No store, no `fetch`, no router, no `window`, `document` or
  `location` at render, no import from an app. Links take an optional `navigate` port instead of a
  router. `tests/ui-boundary.test.ts` walks `libs/ui` and runs preact-components' rule
  (`@spy4x/preact-system/boundary`) over every module, with this repository's app aliases.
- **Built on preact-components' forms.** A form here is `ScreenForm` (`libs/ui/progressive.tsx`):
  `EnhancedForm` with its status taken from the screen's `pending` prop, so a pending form is
  disabled and refuses a second submit. A form takes its submit over with `onSubmit`; only the
  newsletter's pass `action` too. A screen whose whole form the library already has draws that
  instead: the sign-in screens (`AuthScreen`, `AdminSignInScreen`) use preact-system's `AuthForm`,
  and the billing screens use `PlanCard`'s and `PricingTable`'s forms and a `<form>`, each inside a
  `<fieldset>` that `pending` disables, whose submits the app takes over with `onChoose` and
  `onManage`. Any other form is `ScreenForm`.
- **One page header.** Every signed-in page starts with `PageHeader` (from `@spy4x/preact-ui/page-header`):
  the title, the primary action and one "More actions" menu. Do not draw a second one.
- **Laid out by the rules in [docs/design/ui-layout.md](docs/design/ui-layout.md):** one primary
  action per screen, rare actions in a menu or dialog, destructive ones confirmed, mobile first.
- **State comes in as props:** `value`, `errors`, `pending`, `items`, `cursor`. Error and pending
  display is part of the component, so every screen shows the same messages.
- **Accessible by construction.** Every control has a label. Error text is tied to its field with
  `aria-describedby`. Focus moves to the first error, and to the next control after a step change.
  A message the API ties to no field stays under its form.
- **`data-e2e` hooks stay**, so the e2e page objects keep working.
- **Tested.** Each screen has an interaction test that types, submits through its callback and
  checks where focus goes, in a happy-dom page (`libs/ui/*.test.tsx`, such as
  `interactions.test.tsx` and `notes.test.tsx`). The newsletter screens also have a server-render
  test that finds a working form or link for every action (`libs/ui/screens.test.tsx`).

## Adding a feature

A new product aggregate copies the notes aggregate, file by file:
[docs/aggregates.md](docs/aggregates.md) lists every file in order. Do not invent a second shape.
Every id is a UUID version 7; a secret is the owner's decision: [docs/ids.md](docs/ids.md).

## The admin panel stays in sync

Every feature of the product's apps (the SPA, the mobile and desktop apps, and any app added later)
has a counterpart in the admin panel, the operator area: the admin app (`apps/admin`) on its own
host (`ADMIN_DOMAIN`). A change that adds or modifies a feature in one of those apps adds or
modifies its admin counterpart in the same PR, so the two never drift apart.

**Open:** the Android app ([#202](https://github.com/spy4x/seed/issues/202)) and the desktop
app ([#203](https://github.com/spy4x/seed/issues/203)) are not built yet.

## The public website stays in sync

The public website (`apps/mpa`, seedsaas.com) describes the product's features: the home page's
feature cards, `/features`, `/pricing` and `/compare`, and the components they render
(`apps/mpa/components/`). A change that adds, modifies or removes a feature updates every page that
names it in the same PR, so the site never lists a feature the product lacks and never leaves out
one it has. The owner asked for this on 2026-10-19: "create the rule".

`deno task lighthouse` (CI step `lighthouse`) measures the website against the Lighthouse budget
of the global agent rules. The pages it measures are listed in
`apps/mpa/lighthouse/lighthouserc.json`.

## Product screenshots

The public website (`apps/mpa/static/shots/`) and the README (`docs/screenshots/`) show pictures of
the product. When a change alters a photographed screen significantly (the shell, a screen's
layout, its primary action, the palette), re-capture both sets in a PR of their own with the
`recapture-shots` skill (`.claude/skills/recapture-shots/SKILL.md`), once the change is merged. A
small change (a wording, a spacing nudge) does not need it. When unsure, ask the owner. The owner
asked for this on 2026-10-16: "do that automatically when screens/UI/UX change significantly (not
every small change). If unsure if screenshots to be remade - ask me." On 2026-10-17 the owner
agreed that the skill covers the README pictures too.

The admin panel video on the website's `/admin` page (`apps/mpa/media/video/`) shows the admin
app's screens too. When a change alters a screen the video shows significantly, re-record the
video with `deno task video:admin` in the same follow-up PR as the screenshots, and update
`apps/mpa/admin-video.ts` (its length, size, upload date and transcript) to match. The skill says
how. On 2026-10-20 the owner, asked whether the video should join this rule, answered: "Add."

## The public demo

The template's server runs a public demo of the product (not the admin panel) with fake data,
sample data for every new account and a nightly wipe, turned on by `DEMO_MODE=true`:
[docs/demo.md](docs/demo.md).
A change that adds, edits or removes a table, a column or anything else in the database structure
updates the demo's wipe and seed in the same PR, as that doc's "When the database changes" says,
so the demo keeps working and shows the new feature. The owner asked for this on 2026-10-19: "a local AGENTS.md instruction (or a
reference to a separate doc) about how it works and that we should update wipe/seed script when we
add/edit/remove tables or schema or db structure overall."

## Handoff

[docs/handoff.md](docs/handoff.md) holds the map of the repository, the decisions already made and
the traps in this codebase. Read its "Traps in this codebase" before changing the API or the tests.

## The live demo is not production

The template's own server, which runs the live demo the README links to, is not in production
yet: nobody depends on it and nothing of this project on it has to be kept. The owner said so on
2026-10-14. An agent may change that server without asking: deploy to it, edit its env file
(`infra/envs/.env.prod`, which `deno task deploy` copies there), change or reset its database, and
delete this project's data under `.volumes/`. Other projects run on the same server and are not
ours to touch.

This holds for the template only. A product started from the template deletes this section: its
server holds real people's data.

## Products built on Seed

A product starts as a copy of Seed and keeps taking Seed's later changes as a patch:
[docs/products.md](docs/products.md) says how. Keep that recipe working: a change to it, or to
what a product must record, updates that doc in the same PR.

## Financy

Financy is being rebuilt on Seed, as the first product built on it. Seed decides how Financy's
code looks; Financy says which features it needs. A feature any product would need is built here
first and Financy takes it with a sync. Do not port Financy's old structure into Seed.
