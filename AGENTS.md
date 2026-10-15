# AGENTS.md — template

Read `README.md` and `CONTRIBUTING.md` first. The global agent instructions own Git Flow, review
and cleanup; this file adds what is specific to this repo.

## Shared libraries

Before writing a component, helper or library here, search
[spy4x/ts-libs](https://github.com/spy4x/ts-libs) and
[spy4x/preact-components](https://github.com/spy4x/preact-components) for it. The global rule
["Shared libs before local code"][shared-libs] says what belongs in each library; code only this
repo needs stays here.

Reusable code follows the global rule ["Library first, never move it later"][shared-libs]: the
library change is reviewed, merged and released before this repo imports it. There is no local
stand-in.

[shared-libs]: https://github.com/spy4x/dotfiles/blob/main/ai-harnesses/AGENTS.md

## Three layers of UI

Every piece of UI has one home:

| Layer               | Home                                       | Examples                                                       |
| ------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Generic primitives  | `spy4x/preact-components` (JSR)            | `Button`, `Field`, `Card`, `EnhancedForm`, `AuthForm`, `Shell` |
| Product screens     | `libs/ui` (workspace member, alias `@ui/`) | `AuthScreen`, `ProfileScreen`, `AppFrame`, `PublicFrame`       |
| State and transport | the SPA (`apps/spa/src/views`)             | stores, `fetch`, WebSocket, the router                         |

Anything a future product could use goes to preact-components first. `libs/ui` keeps only what
names this template's features. An app's view is wiring: it holds state, calls the API and passes
both to a screen.

The two apps have different jobs. The SPA (`apps/spa`) is the product: everything a signed-in
person does happens there. The MPA (`apps/mpa`, Fresh) is the product's public website: the home
page, pricing, the legal pages and the newsletter. It has no session, links to the SPA for sign-in
and sign-up, and renders no `libs/ui` screen except the newsletter's (`subscribe-screen.tsx`).

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
- **Built on preact-components' `EnhancedForm`.** Every form here is `ScreenForm`
  (`libs/ui/progressive.tsx`): `EnhancedForm` with its status taken from the screen's `pending`
  prop, so a pending form is disabled and refuses a second submit. A form takes its submit over
  with `onSubmit`; only the newsletter's pass `action` too.
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

Every feature of the product's apps (the SPA, the mobile and desktop apps, and any app added
later) has a counterpart in the admin panel, the operator area in the SPA under `/admin`. A change
that adds or modifies a feature in one of those apps adds or modifies its admin counterpart in the
same PR, so the two never drift apart.

**Open:** the admin panel is not built yet ([#146](https://github.com/spy4x/template/issues/146)),
and neither are the Android app ([#414](https://github.com/spy4x/template/issues/414)) and the
desktop app ([#413](https://github.com/spy4x/template/issues/413)).

## Handoff

[docs/handoff.md](docs/handoff.md) holds the state of the migration, the decisions already made and
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

## Financy

Financy is an older product and is rebuilt on this template only when the template is finished.
The template decides how Financy's code looks; Financy only says which features it needs. Do not
port Financy's structure into the template.
