# The public demo

The template's own server runs a public demo of the product. Anyone opens it with one click as a
guest ([guest accounts](guests.md)), or signs up with their own address, by password or with
Google or GitHub, and starts in a workspace full of sample data: a
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
| Population | `apps/worker/demo/fake-content.ts` (names, themes, notes), `fake-data.ts` (`fakeDemoData`), `seed.ts` (`seedDemo`), `history.ts` | 140 fake people with Western names, all on `example.com`, and their history counted back from the moment of the seed: sign-ups mostly in the last two months, on a curve that grows towards now, and about a third earlier, up to eight months back, sign-ins on weekday rhythm from their own browsers (IP addresses from the ranges reserved for documentation), open sessions, a few on Google or GitHub, with a second factor, unverified or blocked. 14 groups of different sizes whose members, tags, notes and invitations arrive over weeks, written by several members, and 16 small groups that recent sign-ups started together. About half the people keep a few notes in their own first group, and some renamed it. Ten of them pay: active, past due, cancelled, ending and in trial, with a payment a month, under provider ids marked `_fake`; no provider is called. 90 newsletter subscribers joining over four months, five who left, and three sent issues. Picked by the day, so each day looks a little different. The people sign up through the API's own sign-up with one random password nobody knows. Claire Hartley, whom the admin video follows, is always there, with two namesakes so its search for "hartley" finds three people, with two sessions: Firefox on Windows and Safari on iPhone, and edits in one small shared group. |
| Sample groups | `fake-data.ts` (`fakeWorkspace`), `seed.ts` (`seedWorkspace`), started by the starter-data job (`libs/server/jobs/starter-data.ts`) | Every new account gets three themed groups, with the population's people as members, tags, notes, invitations and a few attached images and PDFs (`sample-files.ts`, put in the file store by the worker), and opens the one it owns. |
| Sign-in and sign-up pages | `libs/ui/auth-screen.tsx` (`DEMO_NOTE`, `DEMO_GUEST_NOTE`), `apps/spa/src/state/demo.ts` | One line above the form: the demo is public, wiped every night, and every new account, guest or not, starts with sample data. A guest's banner gives the wipe's time in the visitor's own time zone. The SPA reads `demo` from its `/config.json` (`SPA_DEMO` in `apps/spa/public-env.allow`, which compose sets from `DEMO_MODE`). |
| Wipe | `apps/worker/demo/wipe.ts` | Empties every table except `KEPT_TABLES` (the migration history, the backup status, the blog's posts, the contact links and the queue of file deletions) in one transaction. It first queues every attached file's object and every profile picture, which the worker's nightly clean-up then deletes from the file store. Ids are not restarted, so nothing cached under an old id describes a new row. |
| Nightly reset | `apps/worker/demo/reset.ts`, `run.ts`, started in `apps/worker/+main.ts` | Checks every minute. When the date in `America/Los_Angeles` changes, it wipes, seeds the population and schedules the nightly cleanup again. After a deploy it seeds at once only when the day's population is missing, an operator account other than the private administrator exists, or `DEMO_ADMIN_PASSWORD` is set and that administrator is missing. A failed reset is tried again a minute later; a worker that restarts in between keeps the half-seeded demo until the next midnight. |

**Why a job, not sign-up itself.** Every sign-up (password, Google, GitHub, a guest) already queues the
starter-data job in its own transaction, and the worker runs it within a second. While the demo is
on, that job writes the sample groups before the welcome note. A slow or failing write never
delays or fails a sign-up, and a failed job is retried. An account that is in any group besides
its first one has its sample groups already and gets nothing more, so a retry or a second sign-in
adds nothing. The population's fake people get none.

**The admin panel is not part of the demo.** Its host still runs, but the demo gives visitors no
operator account, so nobody outside can sign in to it. A public operator account would show every
visitor's address, IP address and devices to anyone, and each admin action would need its own demo
rule. The admin panel is shown in a video on the website instead. The owner decided this on
2026-10-20: "My decision is admin panel, not for a demo, but we need a good video about it."

The owner keeps a private administrator there: set `DEMO_ADMIN_PASSWORD` (8 to 50 characters) in
the server's env file, which is encrypted, and deploy. Every reset then creates `admin@example.com`
with that password first, hashed with the API's `AUTH_PEPPER` (the worker receives both), and it
signs in to the admin app. A changed password takes effect at the next reset. The worker refuses
to start when the password breaks the rule or the pepper is missing. This administrator is the one
operator the reset tolerates: any other makes the worker wipe and seed again within a minute, and
so does the administrator missing while the setting is on. The reset seeds no operator history
or backup for it, so the admin panel shows the demo as it is. Unset, the demo has no operator.

In development, `deno task db:seed` adds `admin@example.com`, an administrator, so the admin app
can be tried locally, with what an operator did over the weeks (blocks, a reset mail, a refund,
time given, exports) and a finished backup, so the System page shows a healthy server. The
development billing provider answers a customer's last payment from the seeded subscription
(`libs/server/billing/fake-payments.ts`): nothing for a trial, every seat's price at the start of
the period, and refunded once the operator's refund is on record. The public demo gets
neither: it has no operator history, and its server's own backup service records the backups.

## When the database changes

A change to the database structure (a new, renamed or dropped table or column, a new aggregate)
updates the demo in the same PR:

- **The wipe** empties every table it finds, so a new table needs no change (the guest tables
  `guest_events`, `guest_switches` and `guest_reminders` are wiped like the rest; the seed writes
  no guests, because every visitor who presses "Try it now" makes one). A table that must
  survive the night goes into `KEPT_TABLES`, with the reason, and references no table the wipe
  empties: `TRUNCATE ... CASCADE` would empty it too.
- **The blog survives the wipe.** `blog_posts` is in `KEPT_TABLES`, because the posts on the
  product's website (seedsaas.com for the template) are real, not demo data, and the demo seeds no
  posts. A post keeps its author's name in `author_name`, with no foreign key to `users`, so the
  wipe never takes it along. The wipe empties the job table and the audit log, so the worker
  queues a scheduled post's `blog.publish` job again after it (`queueDueBlogJobs`), and the
  operators' audit rows about posts last a day. `deno task db:seed` in development adds three
  sample posts ([blog.md](blog.md)).
- **The contact links survive the wipe** for the same reason: `contact_links` holds the
  website's real contact channels, and the demo seeds none. `deno task db:seed` in development
  adds three sample links (`libs/server/contact-links/sample-links.ts`).
- **The seed** writes what a visitor should see. A new feature gets fake rows in
  `apps/worker/demo/fake-data.ts` and `seed.ts`, written through the feature's own repository, so
  the population and every new account's sample groups show it. A renamed or dropped column breaks
  the seed's raw SQL, which writes the past the app's own code cannot (`apps/worker/demo/history.ts`
  and `seed.ts`: `users`, `auth_*`, `group_members`, `audit_events`, `subscriptions`,
  `billing_*`, `subscriber*`, `user_totp`, `backup_status`); fix it there. The seed dates rows after
  writing them, so it then renumbers the `audit_events` and `auth_audits` rows written since it
  started to follow their times (`orderIdsByTime`), because feeds sort by id.
- **Data exports** need no change: the wipe empties `data_exports`, the seed writes none (a ready
  row would have no file behind it), and the nightly clean-up deletes the files the wipe left in
  the file store. A new table that holds a person's data adds a section to the export instead
  ([data-export.md](data-export.md)).
- **Profile pictures** (#228) need no change either: the seed gives nobody a picture, so every
  avatar shows initials, and the wipe queues every picture a visitor uploaded for the clean-up,
  with the original and every processed width in `images` and `image_variants` (#464).
- **The tests**: `tests/integration/demo-seed.integration.test.ts` checks that the wipe leaves
  every table but the kept ones empty, that the seed's counts match the fake data, what a new
  account's sample groups hold, and what the admin's dashboard, billing and newsletter read from
  the seed. Run it.
