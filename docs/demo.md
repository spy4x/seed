# The public demo

The template's own server runs a public demo: anyone can sign in to the product and to the admin
panel with shared accounts printed on each sign-in page, and find both full of fake data. The
database is wiped and seeded again every night at midnight Pacific time, so whatever visitors do
lasts a day at most.

It is off unless `DEMO_MODE=true`. A product started from the template never turns it on: its
server holds real people's data.

## Turning it on

In the server's env file (`infra/envs/.env.prod`, which `deno task deploy` copies):

```bash
DEMO_MODE=true
SEED_PASSWORD=<the shared password, 8 to 50 characters; it is printed on the sign-in pages>
```

Both the API and the worker read them (`infra/compose/compose.shared.yml`). The API refuses to
start with `DEMO_MODE=true` and no `SEED_PASSWORD`; the worker refuses to start without a valid
`SEED_PASSWORD` and `AUTH_PEPPER`.

## What it does

| Part | Where | What |
| --- | --- | --- |
| Shared accounts | `libs/server/auth/demo-accounts.ts` | `demo@example.com` (a plain user) and `admin@example.com` (an administrator), one password, no second factor. |
| Sign-in pages | `libs/ui/demo-notice.tsx`, `GET /api/demo` (`apps/api/routes/demo.ts`) | A notice above the card with the credentials, a copy button for each, a "Sign in as the demo user" button and a link to the other app. `GET /api/demo` is 404 while the demo is off, and the notice is not drawn. |
| Guard | `apps/api/middlewares/demo-guard.ts` | A shared account cannot change its password, address, second factor or sign-in providers, end sessions, delete itself or mail an invitation. An operator cannot block, sign out, reset or change the role of a shared account. Each refusal is a 403 with a message. |
| Fake data | `apps/worker/demo/fake-data.ts` | 25 people, 8 groups with members, tags and notes, pending invitations, 40 newsletter subscribers, all on `example.com`. The demo user owns one group and is an editor and a viewer in two more. The data is picked by the day, so each day looks a little different. |
| Seed | `apps/worker/demo/seed.ts` | Writes the accounts and the fake data through the API's own sign-up and repositories. `deno task db:seed` runs the same seed in development. |
| Wipe | `apps/worker/demo/wipe.ts` | Empties every table except `KEPT_TABLES` (the migration history and the backup status) in one transaction. Ids are not restarted, so nothing cached under an old id describes a new row. |
| Nightly reset | `apps/worker/demo/reset.ts`, `run.ts`, started in `apps/worker/+main.ts` | Checks every minute. When the date in `America/Los_Angeles` changes, it wipes, seeds and schedules the nightly cleanup again. After a deploy it seeds at once only when the demo is missing. A failed reset is tried again a minute later. |

Visitors may still sign up with their own address: sign-up mails a code as usual, and the account
is wiped with everything else that night.

## When the database changes

A change to the database structure (a new, renamed or dropped table or column, a new aggregate)
updates the demo in the same PR:

- **The wipe** empties every table it finds, so a new table needs no change. A table that must
  survive the night goes into `KEPT_TABLES`, with the reason.
- **The seed** writes what a visitor should see. A new feature gets fake rows in
  `apps/worker/demo/fake-data.ts` and `seed.ts`, written through the feature's own repository, so
  the demo shows it. A renamed or dropped column breaks the seed's raw SQL (`group_members`,
  `users`, `subscribers`); fix it there.
- **The tests**: `tests/integration/demo-seed.integration.test.ts` checks that the wipe leaves
  every table but the kept ones empty and that the seed's counts match the fake data. Run it.
