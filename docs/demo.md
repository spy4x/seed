# The public demo

The template's own server runs a public demo of the product. Anyone signs up with their own
address, by password or with Google or GitHub, and starts in a workspace full of sample data: a
group they own, and two groups of made-up people where they are an editor and a viewer. The
database is wiped and seeded again every night at midnight Pacific time, so whatever visitors do
lasts a day at most. There is no shared account and no demo-only rule in the API: each visitor
works in groups nobody else can see.

It is off unless `DEMO_MODE=true`. A product started from the template never turns it on: its
server holds real people's data.

## Turning it on

Set `DEMO_MODE=true` in the server's env file (`infra/envs/.env.prod`, which `deno task deploy`
copies). The worker and the SPA read it (`infra/compose/compose.shared.yml`); the API does not.

## What it does

| Part | Where | What |
| --- | --- | --- |
| Population | `apps/worker/demo/fake-data.ts` (`fakeDemoData`), `seed.ts` (`seedDemo`) | 25 fake people, 8 groups of theirs with members, tags, notes and pending invitations, and 40 newsletter subscribers, all on `example.com`, so the admin side and other people's groups look lived in. Picked by the day, so each day looks a little different. The people sign up through the API's own sign-up with random passwords nobody knows. |
| Sample groups | `fake-data.ts` (`fakeWorkspace`), `seed.ts` (`seedWorkspace`), started by the starter-data job (`libs/server/jobs/starter-data.ts`) | Every new account gets three themed groups, with the population's people as members, tags, notes and invitations, and opens the one it owns. |
| Sign-in and sign-up pages | `libs/ui/auth-screen.tsx` (`DEMO_NOTE`), `apps/spa/src/state/demo.ts` | One line above the form: the demo is public, wiped every night, and a new account starts with sample data. The SPA reads `demo` from its `/config.json` (`SPA_DEMO` in `apps/spa/public-env.allow`, which compose sets from `DEMO_MODE`). |
| Wipe | `apps/worker/demo/wipe.ts` | Empties every table except `KEPT_TABLES` (the migration history and the backup status) in one transaction. Ids are not restarted, so nothing cached under an old id describes a new row. |
| Nightly reset | `apps/worker/demo/reset.ts`, `run.ts`, started in `apps/worker/+main.ts` | Checks every minute. When the date in `America/Los_Angeles` changes, it wipes, seeds the population and schedules the nightly cleanup again. After a deploy it seeds at once only when the day's population is missing or an operator account exists. A failed reset is tried again a minute later; a worker that restarts in between keeps the half-seeded demo until the next midnight. |

**Why a job, not sign-up itself.** Every sign-up (password, Google, GitHub) already queues the
starter-data job in its own transaction, and the worker runs it within a second. While the demo is
on, that job writes the sample groups before the welcome note. A slow or failing write never
delays or fails a sign-up, and a failed job is retried. An account that is in any group besides
its first one has its sample groups already and gets nothing more, so a retry or a second sign-in
adds nothing. The population's fake people get none.

**The admin panel is not part of the demo.** Its host still runs, but the demo seeds no operator
account, so nobody outside can sign in to it. A public operator account would show every visitor's
address, IP address and devices to anyone, and each admin action would need its own demo rule.
The admin panel is shown in a video on the website instead. The owner decided this on 2026-10-20:
"My decision is admin panel, not for a demo, but we need a good video about it." In development,
`deno task db:seed` adds `admin@example.com`, an administrator, so the admin app can be tried
locally.

## When the database changes

A change to the database structure (a new, renamed or dropped table or column, a new aggregate)
updates the demo in the same PR:

- **The wipe** empties every table it finds, so a new table needs no change. A table that must
  survive the night goes into `KEPT_TABLES`, with the reason.
- **The seed** writes what a visitor should see. A new feature gets fake rows in
  `apps/worker/demo/fake-data.ts` and `seed.ts`, written through the feature's own repository, so
  the population and every new account's sample groups show it. A renamed or dropped column breaks
  the seed's raw SQL (`group_members`, `users`, `auth_keys`, `subscribers`); fix it there.
- **The tests**: `tests/integration/demo-seed.integration.test.ts` checks that the wipe leaves
  every table but the kept ones empty, that the seed's counts match the fake data, and what a new
  account's sample groups hold. Run it.
