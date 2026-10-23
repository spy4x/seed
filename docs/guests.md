# Guest accounts

A visitor presses "Try it now" and is in the app at once, in an account with no e-mail address and
no password: a guest account. Everything works as in any account, except the few actions that need
a person who can sign in again. Adding a sign-in method keeps the account: the user id, the groups
and the notes stay as they are. Firebase and Supabase call the same feature anonymous sign-in.

It is on by default. `GUEST_MODE=false` in the env file turns it off: the API refuses to start a
guest (404) and the SPA hides every "Try it now" (`SPA_GUEST`, set from `GUEST_MODE` by
`infra/compose/compose.shared.yml`). The line under "Try it now" links to the website's terms and privacy notice at `MPA_DOMAIN`
(`SPA_SITE`); without a website it names them without links.

## How it works

| Part | Where | What |
| --- | --- | --- |
| Start | `POST /api/auth/guest` (`apps/api/routes/auth-guest.ts`, `apps/api/services/guest-sign-in.ts`) | Creates the user, a sign-in key of the method `guest` (a session needs a key), the first group and the starter data, in one transaction, and sets the HttpOnly session cookie for 365 days. A browser with a session gets `already-guest` or `signed-in` and nothing is made. Five starts an hour per network address (`guestStart` in `apps/api/middlewares/auth-rate-limits.ts`); the sixth gets 429 with the wait in `Retry-After` and in the body. |
| Renewal | `parseAuth` in `apps/api/services/sign-in.ts`, `renewGuestSession` in `libs/server/auth/guests.ts` | A guest's session is pushed back to 365 days at most once a day, and each such day counts in `users.guest_visit_days` for the third-visit reminder. |
| `/try` | `apps/spa/src/views/GuestViews.tsx`, `libs/ui/guest-screens.tsx` | Posts once as it opens and replaces itself in the history, so Back never makes a second account. It draws working, too many, failed, off and already signed in. The app's `robots.txt` disallows it, and the website's links to it carry `rel="nofollow"`. |
| Keeping | `/keep` | Google, GitHub, a passkey, or an e-mail address and password through the sign-up code page. The password step that linking asks for is skipped for a guest, who has none. Keeping writes a `guest_events` row, repoints the guest's sessions to the new key, caps their expiry at the normal session length, and drops the unread reminders. |
| Taken | `/keep/taken`, `GET`, `POST` and `DELETE /api/auth/guest/switch` | When the method belongs to another account, nothing changes until the person picks: move the guest's groups to that account, delete the guest's data, or keep the guest account. The e-mail path asks for that account's password, and its code when it has two-factor sign-in on, before anything moves. Nothing is ever merged without that choice. |
| Limits | `apps/api/middlewares/guest-limits.ts`, the push check in `apps/api/services/realtimeHub.ts` | Inviting, push devices, API tokens (and so MCP), group imports and checkout answer 403 with the code `GUEST_NEEDS_SIGN_IN_METHOD`. The SPA keeps every button and shows the refusal with "Keep your account" (`apps/spa/src/state/api.ts`, `GuestRefusalDialog`). |
| Reminders | `remindGuest` in `libs/server/auth/guests.ts` | One inbox notification each: after the first note, on the third day of use, and on an invite attempt. |
| Clean-up | `cleanUpGuests`, in the worker's nightly cleanup (`libs/server/jobs/cleanup.ts`) | Deletes a guest made over 7 days ago who has nothing of their own, and any guest unused for 365 days. Each delete is checked again under a row lock, so a guest who wrote something since the list was read stays. Running it twice deletes nobody twice. |
| Delete | `POST /api/auth/guest/delete`, the Profile | A guest types the word `delete` and the account goes at once: there is no grace period, because nobody could sign in to restore it. A group export works for guests as for anyone. |
| Admin | `libs/ui/admin-users-screen.tsx`, `admin-user-screen.tsx`, `admin-dashboard-screen.tsx` | A "Guest" badge, an Account filter, "Delete guest account" on the person's page (`POST /api/admin/users/:id/guest/delete`, guests only, audited on the operator's row), and the counts started, kept and cleaned up over the dashboard's 30 days. Support never restores a guest account: it has no sign-in method to prove whose it was. |

Signing out of a guest account asks first, since the account cannot be opened again.

## Security

- A guest is a member like any other: every route and handler checks membership as before. A
  guest can join another person's group by accepting an invitation link, and on the demo a guest
  starts in the sample groups.
- Starting a guest never takes over a session: a browser with any session gets nothing new.
- Keeping by a provider or an e-mail address that another account owns never signs the guest into
  it without that account's password (and code); a provider sign-in proves the provider account.
- The limits are enforced by the API, not by the screens.
