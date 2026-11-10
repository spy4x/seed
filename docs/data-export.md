# A person's data export

> Also on the website: [seedsaas.com/docs/data-export](https://seedsaas.com/docs/data-export).

This page shows how a person downloads a copy of everything the product holds about them, and how
to add a new table to that copy.

A signed-in person asks for it on Profile → Account → Your data, or by searching "Download my
data". The file is built in the background and kept for a few days
([#229](https://github.com/spy4x/seed/issues/229)).

**You need:** the file store running, with its settings in the env file ([files.md](files.md)).

## What happens

1. The person asks. The API records the request and queues a job for the worker.
2. The worker reads the person's data in one consistent snapshot and writes a ZIP to the file
   store.
3. The person gets an inbox notice, and a mail at their first proven address. A person without a
   proven address gets the inbox notice only.
4. The person downloads the ZIP from the app. The link works for five minutes and saves the file as
   an attachment.
5. After 7 days the file is deleted and the request reads as expired.

One request per person per 24 hours: a second one answers 429 with `Retry-After`. A request still
not ready a day after it was made reads as failed, and the person may ask again.

| Setting                      | What it does                              | Value |
| ---------------------------- | ----------------------------------------- | ----- |
| `DATA_EXPORT_COOLDOWN_HOURS` | Hours between two requests of one person. | 24    |
| `DATA_EXPORT_KEEP_DAYS`      | Days a finished file is kept.             | 7     |

Both are constants in `libs/domain/identity/data-export.ts`, not env variables.

## What the ZIP holds

The ZIP has three kinds of file:

- `data.json`, with every section;
- one CSV per section, in UTF-8 with a byte order mark, so spreadsheets read accents;
- `README.txt`, which explains the files.

A group's owner downloads the group's own spreadsheets apart from this, from the group: one CSV per
aggregate, also in UTF-8 with a byte order mark, its headings in the person's language
([Make it exportable](aggregate-lifecycle.md#make-it-exportable)).

It holds only what is about the person or made by them, never another person's data or a secret:

- their profile, with the id of their picture but never its bytes;
- their preferences, sign-in methods (without secrets) and sessions;
- their account activity, without the address and browser of an action an operator or the command
  line took on them;
- their push devices, without the push address and its keys;
- their linked Telegram account: its user id and when it was linked;
- the groups they belong to, by name and role, never the other members;
- the notes and tags they created in groups they still belong to, never the ones others wrote;
- the files they attached to those notes: name, type, size and note, never the bytes or the
  stored key;
- what they did in their groups, without the details that can name other people;
- invitations they sent (without the invited address) and accepted;
- their notifications, and their API tokens without the token or its hash;
- the subscriptions of groups they own;
- their newsletter subscriptions, without the unsubscribe key;
- the imports they started in groups they still belong to: the file's name and size and what
  the import saved, never the file or its rows;
- their blog posts and their earlier exports.

Notes in a group they left stay out, because they can no longer read them in the app either.
Attached files stay in the file store and open from the note.

## Add a table to the export

A new table that holds a person's data adds a section to the export.

1. Open `libs/server/jobs/data-export-sections.ts`.
2. Add an entry to `DATA_EXPORT_SECTIONS` with a name, its columns and the query of the person's
   rows.
3. Filter the query by the person. Leave out any column that names another person or holds a
   secret.
4. Add the new table's rows to `tests/integration/data-export.integration.test.ts`. That test checks
   that other people's rows and the known secrets stay out.

## Safety

- Two requests at once still make one export: the API locks the person's row first.
- A retried job finds the export ready and does nothing.
- The download reads only the session's own export. There is no id in the address to change.
- Only the app's own page may start a download (`Sec-Fetch-Site: same-origin`).
- The nightly clean-up deletes any export file a day past its 7 days, in case an expiry job was
  lost to a demo wipe or a restored backup.

## When it fails

The worker needs the file store's settings: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Without them it warns at start. The export job then
fails and is retried, so the request reads as failed after a day.

## In the admin panel

The person's page has a "Data exports" tab. It lists when each export was asked for, its state,
its size and when it expires. The operator cannot download the file, because it holds the person's
data.

## Next

- [The file store](files.md): where the ZIP is kept.
- [Adding an aggregate](aggregates.md): every file a new feature copies, the export section among them.
