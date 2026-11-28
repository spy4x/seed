# The weekly digest

A person can turn on one e-mail a week that says what others changed in their groups: notes
created, notes edited and people who joined. It is off until they turn it on. The setting's screen
is [#1172](https://github.com/spy4x/seed/issues/1172); this page is the server
([#210](https://github.com/spy4x/seed/issues/210)).

## The setting

The realtime operations `weekly-digest.get` and `weekly-digest.save` read and save it
(`apps/api/features/weekly-digest/`). A save is `{ on: false }` or
`{ on: true, weekday, hour, timeZone }`: an ISO weekday (1 is Monday), an hour from 0 to 23 and an
IANA zone, checked by `weeklyDigestSettingSchema` (`libs/domain/notifications/weekly-digest.ts`).
The answer adds `nextAt`, when the next digest goes out.

Turning it on writes one `weekly_digests` row; turning it off deletes it. A change while on keeps
the row's `id` and the start of the next digest's window; turning it off and on again makes a new
`id`, so a mail job queued before that sends nothing.

## When it is sent

`next_at` is the next chosen weekday and hour in the person's zone, computed in SQL by
`weekly_digest_next_at()`. Postgres reads an hour that a daylight-saving change skips with the
offset from before the change (02:00 on the spring-forward night is 03:00 summer time), and an hour
that happens twice as the second one, so each week has exactly one slot.

The repeating job `notifications.weekly-digest-schedule` runs at `5 * * * *`. In one transaction
per batch of 500 it moves every due row's `next_at` to the next slot after now and queues one
`notifications.weekly-digest-mail` job for it. A second run finds nothing due, and a worker that
was down for weeks queues one mail, not one per missed week.

## What it says

The mail job counts, from the row's `window_from` to now, in the groups the person is a member of
now and that are not deleted: notes others created, notes made before the window that others last
edited in it, and people other than the person who joined. The person's own changes are left out,
and so is every group they have left. It never reads the audit log. The 20 groups with the most
changes are listed, each with a link; the rest are counted as "and N more".

The window then starts at this run, whether a mail went out or not. Nothing is sent, and the
window still moves, when nobody else changed anything, mail is off, the person has no proven
address, or `SUBSCRIBERS_SECRET` is not set. A deleted or blocked account gets nothing. A failed
send throws, so the job is retried with the window unchanged.

The mail goes to the person's first proven address, in their saved language
(`WeeklyDigestMail.*` in `i18n/mail/`).

## Unsubscribe

Every digest carries a signed link in its body and in the `List-Unsubscribe` and
`List-Unsubscribe-Post` headers (the headers only for an `https:` address). The token is a signed
payload (`@spy4x/platform/signed-payload`) of purpose `weekly-digest.unsubscribe` that holds the
user id, signed with `SUBSCRIBERS_SECRET`; the previous secrets still verify after a rotation. It never expires
and can only turn the digest off.

`/api/weekly-digest/unsubscribe` needs no session:

- `GET` redirects to the app's page `/digest/unsubscribe?token=…`, which asks before it posts.
- `POST` (a mail client's one-click, or that page's form) turns the digest off and answers
  `{ "state": "done" }` for any valid token, whether the digest was on or not, so it tells nothing
  about an account. Any other token gets 404 and changes nothing. It shares the newsletter's
  per-address budget for token links.
- Without `SUBSCRIBERS_SECRET` both answer 503.

## Account deletion, export and the demo

The row goes with its account (`ON DELETE CASCADE`), the data export has a `weekly_digest`
section, and the demo's wipe empties the table while its seed turns nobody's digest on
([demo.md](demo.md)).
