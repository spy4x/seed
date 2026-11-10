# Guest accounts

> Also on the website: [seedsaas.com/docs/guests](https://seedsaas.com/docs/guests).

This page shows how "Try it now" lets a visitor into the app without signing up, and what such a
guest account can and cannot do.

A guest account has no e-mail address and no password. Everything works as in any other account,
except a few actions that need a person who can sign in again. Firebase and Supabase call the same
feature anonymous sign-in.

## Turn it on or off

Guest accounts are on by default. To turn them off:

1. In the env file (`infra/envs/.env`, or `infra/envs/.env.prod` on the server), set:

   ```sh
   GUEST_MODE=false
   ```

2. Restart `deno task dev` on your machine, or deploy to the server:

   ```sh
   deno task deploy
   ```

| Variable     | What it does                                                                  | Default |
| ------------ | ----------------------------------------------------------------------------- | ------- |
| `GUEST_MODE` | `false` turns guests off: the API answers 404 and the SPA hides "Try it now". | on      |

Compose passes the same value to the SPA as `SPA_GUEST`, so you set it once. The line under "Try
it now" links to the terms and the privacy notice on the website at `MPA_DOMAIN`. Without a
website, it names them without links.

## What a visitor gets

1. "Try it now" opens `/try`, which starts the guest once and replaces itself in the browser
   history. Back never makes a second account.
2. The API creates the user, the first group and the starter data in one transaction.
3. The browser gets a session cookie that lasts 365 days. Each day of use pushes it back, at most
   once a day.

A browser that already has a session gets nothing new. One network address can start five guests
an hour; the sixth gets 429 with the wait in `Retry-After`. The app's `robots.txt` disallows `/try`,
and the website's links to it carry `rel="nofollow"`.

## What a guest cannot do

These actions answer 403 with the code `GUEST_NEEDS_SIGN_IN_METHOD`:

- inviting people to a group;
- adding a push device;
- making API tokens, and so using the MCP server;
- importing a group, or uploading a file to import records into one;
- checkout (paying for a plan);
- linking Telegram.

The SPA keeps every button. Pressing one shows the refusal with a "Keep your account" button. The
API enforces the limits, not the screens.

Signing out of a guest account asks first, because nobody can open that account again.

## Keep the account

On `/keep`, a guest adds a sign-in method: Google, GitHub, a passkey, or an e-mail address and a
password. The user id, the groups and the notes stay as they are.

Keeping the account:

1. skips the password step that linking asks for, since a guest has none;
2. ends every session of the guest, including ones in other browsers;
3. signs this browser in with a new session of the normal length;
4. drops the unread reminders.

The SPA reopens its socket on the new cookie without a reload.

### When the method belongs to another account

Nothing changes until the person picks one of three choices on `/keep/taken`:

- move the guest's groups to that other account;
- delete the guest's data;
- keep the guest account as it is.

Nothing is ever merged without that choice. By e-mail address, the move asks for that account's
password first, and for its two-factor code when it has one.

## Reminders

A guest gets one inbox notification for each of these moments:

- after their first note;
- on their third day of use;
- when they try to invite someone.

## Clean-up and deleting

The worker's nightly clean-up deletes two kinds of guest:

- a guest made over 7 days ago who has nothing of their own;
- any guest unused for 365 days.

It checks each guest again just before the delete, so one who wrote something meanwhile stays.

A guest deletes their own account on the Profile by typing the word `delete`. It goes at once,
with no grace period, because nobody could sign in to restore it. A group export works for guests
as for anyone.

## In the admin panel

- A "Guest" badge on the person, and an Account filter on the users list.
- "Delete guest account" on the person's page, for guests only. It is audited.
- The dashboard counts guests started, kept and cleaned up over its 30 days.

Support never restores a guest account: nothing proves whose it was.

## Security

- A guest is a member like any other. Every route checks group membership as usual.
- A guest can join another person's group through an invitation link. On the demo, a guest starts
  in the sample groups.
- Keeping never turns the guest's cookie into the kept account's
  ([#374](https://github.com/spy4x/seed/issues/374)). The guest cookie lived a year without a
  password, so a copy of it, on a shared computer say, stops working once the account is kept.
- Keeping by a method another account owns never signs the guest in to that account without its
  password and code. A provider sign-in proves the provider account.
- Every guest on one client address shares one operation budget: 60 writes and 300 reads a minute
  by default. Opening more guest accounts gives a script no more writes.
- Behind Cloudflare's proxy, every guest that comes through one Cloudflare edge shares that budget
  ([architecture.md](architecture.md), "Operation budget").

## Next

- [Sign in with Google and GitHub](sign-in-providers.md): the providers a guest can keep the
  account with.
- [The public demo](demo.md): how guests start on the demo.
