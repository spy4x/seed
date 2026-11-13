---
slug: your-first-feature-copy-the-notes-aggregate
language: en
title: "Your first feature in Seed: copy the notes aggregate"
seoTitle: "Add a feature to Seed: copy the notes aggregate"
description: How to add your first feature to a Seed SaaS. Copy the notes aggregate layer by layer, from the domain and the migration to the screens, tests and admin view.
tldr:
  - A feature in Seed is an aggregate, and notes are the worked example to copy.
  - "Nine steps: domain, migration, repository, handlers, transports, screens, SPA, tests, admin."
  - Authorization lives in the handlers, so the socket and the HTTP route answer the same.
  - Every write takes a version and an idempotency key, so nothing is overwritten or done twice.
topic: Guides
intro: "The quickest way to learn Seed is to add a feature to it. I copy the notes aggregate layer by layer, from the database to the admin screen, so you can do the same with yours."
cover: covers/your-first-feature-copy-the-notes-aggregate.webp
coverAlt: "A stack of translucent violet and grey layers beside a copy of it being built, one more layer hovering into place."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T18:00:00Z
newsletter: false
---

To add your first feature to Seed, copy the notes aggregate. A note is Seed's reference feature:
it lives in a group, members read it, editors write it, and it touches every layer from a
Postgres table to a screen. You copy its files in nine steps (domain, migration, repository,
handlers, transports, screens, SPA wiring, tests and the admin view), rename them, and change the
fields and rules. Every file is listed in order in [the aggregate guide](/docs/aggregates).

An _aggregate_ is one kind of thing your product keeps: an invoice, a task, a booking. I chose
notes as the reference exactly because they are boring. No product rules hide in them, so what
you copy is the shape, not someone else's business logic. In this post I'll call the new
aggregate "tasks"; swap in your own noun.

## Which rules does every aggregate follow?

Five, and they are why the files look the way they do:

- **It lives inside a group.** Every row has a `group_id`, and every check starts from the
  actor's membership of that group. Groups are the only tenancy boundary.
- **Authorization is in the handlers.** The REST route and the WebSocket only parse and dispatch,
  so both get the same answer from the same code.
- **Every write moves the group's change sequence** and writes an outbox row in the same
  transaction. The worker turns that row into a hint on every member's socket, and their pages read
  again. That is all live updates need.
- **Every command carries an idempotency key, and every update names the version it saw.** A
  retried request runs once, and a stale edit is refused with the current version instead of
  overwriting a change nobody saw.
- **Screens are props in, callbacks out.** No `fetch` in a screen, ever.

## The nine steps

**1. Domain**, `libs/domain/notes/`. The shape, the request schemas (arktype), the errors and the
authorization rule. The rule is two small functions, and the first detail worth copying is that a
stranger gets "group not found", never "forbidden", so nobody learns a group exists:

```ts
export function assertCanReadNotes(role: GroupRole | null): void {
  if (role === null || !canRead(role)) {
    throw new NoteError("GROUP_NOT_FOUND", "Group not found")
  }
}
```

Register the new folder in the root `deno.jsonc` workspace, or its tests never run.

**2. Migration**, `libs/server/db/migrations/`. The `notes` table holds `group_id`, the fields,
`version`, `change_sequence`, who created and changed it, and `deleted_at`. Name your file after the
newest migration on `main`, not today's date, and append it to `schema.sql`; a test fails if you
forget either.

**3. Repository**, `libs/server/notes/`. Reads and writes, each write in a transaction that records
the group change. The version check is a plain `WHERE version = ${expected}` on the `UPDATE`.

**4. Handlers**, `apps/api/features/notes/handlers.ts`. One per command and query: read the actor's
role, run the rule, call the repository.

**5. Transports**, `apps/api/features/notes/operations.ts`. List the operations once. The socket
and `POST /api/call/<name>` both serve that list, so a new aggregate writes no per-command REST
route, only a list route.

**6. Screens**, `libs/ui/`. A list page and an editor page, each one screen that takes props and
calls back. Copy both.

**7. SPA wiring**, `apps/spa/src/`. A store, two views and the routes. Here you also choose the
offline level: online only, readable offline (the default for a list), or writable offline like
notes.

**8. Tests.** The notes aggregate has them at every level: the transports on real buses, Postgres
integration tests, and browser tests with two members watching each other's changes. Copy them
with the code, not after.

**9. The admin view.** Every feature gets its operator screen in the admin panel, as one module
folder and one API file ([admin modules](/docs/admin-modules)). Seed treats this as part of the
feature, not a follow-up.

## What else comes with a new table?

The guide has short sections for the rest, each only when you need it: moving data between groups,
including it in a group export and in a person's "download my data", a widget on the overview,
starter data for new accounts, and fake rows for the public demo.

## How long does it take?

Longer than a scaffold command, and I think that is fine. Copying nine layers by hand is how you
end up understanding them, and a Seed product is code you own and change, not a framework you
configure. Open the notes files next to your empty folders and go top to bottom; the
[aggregate guide](/docs/aggregates) is the checklist. Haven't got Seed running yet? Start with
[How to install Seed and run it locally](/blog/install-seed-and-run-it-locally).
