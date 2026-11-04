# Sign-out and the device's data

> Also on the website: [seedsaas.com/docs/offline-sign-out](https://seedsaas.com/docs/offline-sign-out).

This page explains what the SPA deletes from the browser when a person signs out, what it keeps
when the server ends the session, and when it asks before signing out.

## At start: who is signed in

The app asks `/api/auth/me` before it renders. Only a 401 means nobody is signed in: the app shows
the sign-in page and deletes the remembered person's copies, all but their queue of unsent writes.

Every other answer says nothing about the session. That includes a proxy's 502 or bare 404 during a
deploy, a 403, a 500, a 429, a 2xx without a profile, and no answer at all. The app then opens as
the remembered person, on their saved copy. The first call the server answers with 401 or
`unauthorized` signs the page out.

With nobody remembered, the sign-in page shows.

## Signing out deletes everything

The owner decided on 2026-10-18: "when a user signs out - delete everything from local storage and
local db. Simple as that." (#206)

When the person ends the session themselves, `wipeDevice` in `apps/spa/src/modules.ts` deletes:

- every IndexedDB database of the app, the queues of unsent writes included;
- every `localStorage` key but the ones in the table below;
- every `sessionStorage` key but `sign-in-code:sent` and `sign-up-code:sent`, so the code step
  keeps its wait for a new code after a reload.

That covers the account menu's sign-out, the two-factor step's sign-out, a sign-out still owed to
the server, and an account deletion. A write still in the queue is lost, so the app asks first
([below](#signing-out-with-unsent-changes)). What the server owns comes back at the next sign-in.

| Kept key                            | Why                                                                 |
| ----------------------------------- | ------------------------------------------------------------------- |
| `auth:sign-out-owed`                | A sign-out the server has not accepted yet.                         |
| `offline:owed-deletion`             | A person whose copies the device has not deleted yet.               |
| `offline:kept-queue`                | The person whose queue a server-ended session kept.                 |
| `offline:signed-out`                | Marks a chosen sign-out, which another tab respects.                |
| `theme`, `install-prompt-dismissed` | The device's own answers.                                           |
| `last-sign-in`                      | The masked hint the sign-in page shows. "Not you? Forget" drops it. |

**Deletion takes a moment.** Before it starts, the person's id goes into `offline:owed-deletion`.
It is removed only after the device deleted the copies. A page closed in between leaves the id, and
every start deletes what is owed first. A browser that refuses to delete logs a warning, and the
next start tries again.

**A late answer is not saved.** Each copy is closed by its deletion, so an answer still on its way
stores nothing. `offline/device-copies.test.ts` checks this on IndexedDB.

## A session the server ended keeps the queue

The owner chose on 2026-11-01 to keep the work of a person whose session expired, or was ended on
another device, while they were away (#612).

When the page ends up signed out and the person did not choose it, `wipeDeviceKeepingQueue` deletes
everything but that person's two queue databases. It writes their id to `offline:kept-queue`.

- **The same person signs in again:** their queue is sent as usual, and the key is removed.
- **Someone else signs in:** the kept queue is deleted before the new person's layer opens.
- **Nobody else can reach it:** every queue is named by its owner's id (`offline:user:<id>:…`).
- **The local-data module is off:** nothing is kept.

`signOutChosen` in `state/session.ts` says which case it is. A chosen sign-out wins over a session
end seen in another tab (#613): `wipeDevice` sets `offline:signed-out`, and the other tab's wipe
then deletes the queue too.

The same deletion runs when another person's cookie arrives on a page that never signed the last
person out, such as after a provider sign-in's redirect.

## Signing out with no network

The page signs out at once and records `auth:sign-out-owed` in `localStorage`. The app sends the
sign-out first thing at the next start, and when the browser comes back online. The flag clears
only when the server answers with success, or when someone signs in. Until then, the server's
session stays valid.

## Signing out with unsent changes

When the person signs out from the account menu while the queue holds writes, a dialog asks first.
It says how many changes are unsent, and that signing out now deletes them.

| Button              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| Send, then sign out | The default. Sends the queue, shows the progress, then signs out.   |
| Review changes      | Shown once only refused writes are left. Opens their group's notes. |
| Sign out anyway     | Signs out at once and deletes the queue.                            |
| Cancel              | Stays signed in. Escape and the backdrop do the same.               |

Offline, "Send, then sign out" waits and says so. It signs out once the queue is empty.

Right after start, the check waits up to 3 seconds for the layer to read the queue
(`QUEUE_READ_DEADLINE_MS`). A device that cannot read its queue in time signs out.

The two-factor step's sign-out and "sign out other devices" never ask. Neither does a sign-out by
the server: nobody chose it, and the queue stays for the person's next sign-in.

The check is `watchUnsentChanges` in `modules.ts`. `views/UnsentSignOut.tsx` draws the dialog.

## Next

- [How offline writes sync](offline-writes.md).
- [Offline in the SPA](offline.md).
