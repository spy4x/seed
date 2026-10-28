# A person's data export

A signed-in person downloads a copy of everything the product holds about them from Profile →
Account → Your data, or by searching "Download my data". The file is built in the background and
kept for a few days ([#229](https://github.com/spy4x/seed/issues/229)).

## What happens

1. `POST /api/account/data-export` (`apps/api/routes/data-export.ts`) adds a row to
   `data_exports` and queues the `account.data-export` job in the same transaction
   (`libs/server/auth/data-export.ts`). One request per person per 24 hours
   (`DATA_EXPORT_COOLDOWN_HOURS`): a second one answers 429 with `Retry-After`. The person's
   `users` row is locked first, so two requests at once still make one export.
2. The worker (`libs/server/jobs/data-export.ts`) reads every section of
   `DATA_EXPORT_SECTIONS` in one read-only snapshot and writes a ZIP: `data.json` with every
   section, one CSV per section (UTF-8 with a byte order mark, so spreadsheets read accents) and a
   `README.txt`. It stores the ZIP at `data-exports/<export id>.zip` in the file store, then marks
   the row ready, puts a notice in the person's inbox and queues the mail and the expiry in one
   transaction. A retried job finds the row ready and does nothing.
3. The mail goes to the person's first proven address; a person without one gets the inbox notice
   only.
4. `GET /api/account/data-export/download` answers 303 to a signed URL of the newest ready file,
   valid for five minutes, served as an attachment. Only the app's own page may start it
   (`Sec-Fetch-Site: same-origin`), and the route reads only the session's own export: there is
   no id to change.
5. After `DATA_EXPORT_KEEP_DAYS` (7) the expiry job deletes the file and marks the row expired.
   The nightly clean-up also deletes any file under `data-exports/` older than a day past that, in
   case an expiry job was lost (a demo wipe, a restored backup).

A row still not ready a day after it was asked for reads as failed, and the person may ask again.

## What it holds

Only what is about the person or made by them, never another person's data or a secret:

- their profile (with the id of their profile picture, never its bytes), preferences, sign-in methods (without secrets), sessions, account activity
  (without the address and browser of an operator's or the command line's action on them), push
  devices (without the push address and its keys) and their linked Telegram account (its user id
  and when it was linked);
- the groups they belong to, by name and role, never the other members;
- the notes and tags they created in groups they still belong to, never the ones others wrote.
  Notes in a group they left stay out: they can no longer read them in the app either;
- the files they attached to notes in those groups: name, type, size and note, never the bytes
  (they stay in the file store and open from the note) and never the stored key;
- what they did in their groups, without the details that can name other people;
- invitations they sent (without the invited address) and accepted, their notifications, API
  tokens (without the token or its hash), the subscriptions of groups they own, their newsletter
  subscriptions (without the unsubscribe key), their blog posts and their earlier exports.

## Adding a table

A new table that holds a person's data adds a section to `DATA_EXPORT_SECTIONS`
(`libs/server/jobs/data-export-sections.ts`): a name, its columns and the query of the person's
rows. Keep the rule above: filter by the person, and leave out any column that names another
person or holds a secret. `tests/integration/data-export.integration.test.ts` checks that other
people's rows and the known secrets stay out; add the new table's rows there.

## Where it runs

The worker needs the file store's settings (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; [files.md](files.md)). Without them it warns at start,
and the export job fails and is retried, so the request reads as failed after a day.

## In the admin

The person's page in the admin panel has a "Data exports" tab: when each export was asked for, its
state, size and expiry. The operator cannot download the file: it holds the person's data.
