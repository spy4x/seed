# AGENTS.md — Seed

The global agent instructions own Git Flow, review and cleanup; this file adds what is specific
to this repo. Every doc is listed in [docs/README.md](docs/README.md).

In Seed's own repository, also read `AGENTS.seed.md`. A product deletes that file and this line.

## Commands

```sh
deno task check                       # lint, fmt, types and every unit test
deno task fix                         # lint and fmt fixes
deno task dev                         # the development stack in compose
deno task e2e:local e2e/notes.e2e.ts  # one browser spec, on a stack of its own
deno test --no-prompt --allow-env=WS_NO_BUFFER_UTIL,WS_NO_UTF_8_VALIDATE libs/ui/notes.test.tsx
```

The last runs one test file; a test that reads files also needs the grant the `test` task in
`deno.jsonc` gives it. [docs/development.md](docs/development.md) lists every task.

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
The MPA (`apps/mpa`, Preact on a small Fresh-compatible layer built with Vite) is the product's public website: the home page, pricing, the legal pages
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
one it has.

`deno task lighthouse` (CI step `lighthouse`) measures the website against the Lighthouse budget
in the global `design` skill. The pages it measures are listed in
`apps/mpa/lighthouse/lighthouserc.json`.

## The public demo

The template's server runs a public demo of the product (not the admin panel) with fake data,
sample data for every new account and a nightly wipe, turned on by `DEMO_MODE=true`:
[docs/demo.md](docs/demo.md).
A change that adds, edits or removes a table, a column or anything else in the database structure
updates the demo's wipe and seed in the same PR, as that doc's "When the database changes" says,
so the demo keeps working and shows the new feature.

## Blog

A product writes its posts in the admin app. How to write a post: the shared `blog-post` skill.

## Handoff

[docs/handoff.md](docs/handoff.md) holds the map of the repository, the decisions already made and
the traps in this codebase. Read its "Traps in this codebase" before changing the API or the tests.

## Products built on Seed

A product starts as a copy of Seed and keeps taking Seed's later changes as a patch:
[docs/products.md](docs/products.md) says how. Keep that recipe working: a change to it, or to
what a product must record, updates that doc in the same PR.
