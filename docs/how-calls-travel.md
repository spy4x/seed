# How calls travel

The path of a call through Seed, file by file: a note write first, then the group and profile calls
and the rules of members, invitations and ownership. Read the step you need; the rest of the page is
for grep.

## How a note write travels

An edit of a note's title, from one tab until another tab of a member shows it.

1. **Store.** The note editor calls `notesStore` (`apps/spa/src/state/notes.ts`), whose `update`
   is `callCommand("note.update", …)` wrapped by `offlineNotes`
   (`apps/spa/src/offline/notes-collection.ts`).
2. **Outbox.** With the offline layer running, `offlineNotes` puts the write in the device's queue
   (IndexedDB, `@spy4x/realtime/outbox`) with an idempotency key, and sends it at once when the
   server is reachable. Without the layer the call goes out directly.
   [How offline writes sync](offline-writes.md) has the queue's rules.
3. **Port.** `callCommand` (`apps/spa/src/modules.ts`) sends it through the user's calls port
   (`apps/spa/src/state/realtime-call.ts`): over the socket while it is open
   (`apps/spa/src/realtime/index.ts`), otherwise as `POST /api/call/note.update`.
4. **Operation.** The API's socket (`apps/api/routes/ws.ts`) and the call route
   (`apps/api/routes/call.ts`) serve one table of operations (`apps/api/services/realtimeHub.ts`).
   `note.update` (`apps/api/features/notes/operations.ts`) parses the payload and puts a
   `NoteUpdateCommand` on the command bus.
5. **Bus.** The session gate (`apps/api/cqrs/session-gate.ts`), then the idempotency and
   entitlement middlewares (`apps/api/cqrs/+init.ts`), then the handler
   (`createNoteUpdateHandler`, `apps/api/features/notes/handlers.ts`), which checks the role.
6. **Postgres.** `PostgresNoteRepository.update` (`libs/server/notes/postgres-note-repository.ts`)
   runs one transaction: it locks the actor's role again (`lockActorRole`), updates the row only at
   the expected version, and stamps the change with `recordGroupChange`
   (`libs/server/groups/group-change-log.ts`), which takes the group's next sequence and writes an
   `outbox_events` row.
7. **Worker.** The worker's outbox processor (`libs/server/jobs/wiring.ts`) reads the committed row
   and announces it with `pg_notify` on the `group_change` channel
   (`libs/server/groups/group-change-notify.ts`).
8. **Hint.** The API listens on that channel (`apps/api/services/group-news.ts`) and
   `notifyGroupChange` (`apps/api/services/realtime.ts`) sends a `change.hint` with the sequence to
   every member's open socket.
9. **Pull.** The other tab's socket module (`apps/spa/src/realtime/index.ts`) takes the hint and
   calls the pull (`apps/spa/src/state/pull.ts`), which reads the group's notes again. A lost hint costs nothing: the next
   reconnect or check reads the same way.

## How a profile or push call travels

`profile.get`, `profile.update`, `push.register`, `push.remove` and `push.list` are served from
`apps/api/features/profile/operations.ts` and `features/push/operations.ts` and dispatched on the
same buses as the REST routes (`/api/users/me`, `/api/push`). The two commands that change devices
carry an idempotency key. Every change emits `UserProfileUpdatedEvent` or `PushDevicesUpdatedEvent`,
whether it came over REST or the socket, and an event handler calls `Realtime.notifyUserChange`,
which sends a `change.hint` (group id `user:<id>`, aggregate `user`, sequence = the clock in
milliseconds) to every socket of that user. The SPA's pull answers that hint with
`profileStore.refresh()`, so a second tab follows without a reload.

A subscription records the session that stored it (`user_push_tokens.session_id`, #181). These
steps remove the subscriptions of the sessions they end, in the same transaction, so a device signed
out from elsewhere gets no more notifications: "sign out other devices", ending one device, a
password change or first password that signs the others out, turning on two-factor, an address
change, an administrator's block or sign-out, a reset (every subscription), unlinking a sign-in
method (the subscriptions of the sessions that method signed in, found before its key is deleted,
#572), and a sign-in by password, link, provider or passkey that replaces this browser's earlier
session of another person. Account deletion and a plain sign-out remove none. A step that gives this
device a new session of the same person (a password change, an address move, signing in again over
its own session) moves its subscription to it.

## How a group call travels

1. `apps/spa/src/realtime/index.ts` opens `/api/ws`. The upgrade runs the same session gate as
   REST and the `Origin` check, then `apps/api/services/realtime.ts` remembers which session each
   socket belongs to.
2. `group.create`, `group.list`, `group.get`, `group.select` and `group.selected` are dispatched on
   the same command and query buses REST uses, from `apps/api/features/groups/operations.ts`. Each
   frame reads the session again from the database, so a signed-out or expired session is refused.
   Authorization stays in the buses.
3. A command needs an idempotency key. `@spy4x/server/idempotency` (ts-libs) stores it for 7 days
   per user and runs the command once; a repeat returns the first result, and a repeat while the
   first still runs waits, then answers `conflict`. The worker sweeps expired keys hourly.
4. Every committed group change bumps `groups.next_change_sequence` and writes an outbox row in
   the same transaction. The worker drains the outbox and sends `pg_notify`; the API turns it into
   a `change.hint` with the sequence for every member's open sockets. `pg_notify` reaches only the
   API instances listening at that moment; a push missed that way is caught by the pull after the
   next reconnect.
5. A job is an outbox row with `aggregate_type = 'job'`, no group and no payload:
   [jobs.md](jobs.md) says how to add one (`defineJob` in `libs/server/jobs/registry.ts`), queue a
   run (`enqueueJob`) and make it repeat. A failing job backs off up to 15 minutes and after 20
   attempts is given up (`JOB_RETRY` in `libs/server/jobs/job-failures.ts`): the row is closed and
   keeps the error's class in `last_error_code` until the cleanup removes it a week later. The
   worker logs each failed attempt with the row's kind, the attempt, the stage and the error's
   class, never its message, and the last one as `abandoned`. Two things are not logged. An attempt
   lost with a worker that died mid-run is retried after its lease without a line, unless it was
   the last one, which is logged with stage `lease`. And the line is written after the row is
   closed, so a worker that dies between the two leaves the closed row as the only trace, for those
   seven days. The nightly cleanup (`outbox.cleanup`, 03:00 UTC) removes outbox rows processed more
   than 7 days ago and runs every purge, each as its own step (`cleanupSteps` in
   `libs/server/jobs/cleanup.ts`); a step that throws is logged and stops no other step. Rows that a
   worker from before this (10 attempts, never closed) had given up are closed by migration
   `2026_11_01_0001_close_given_up_outbox_rows.sql`. A cancelled run (from the admin's Jobs module)
   is closed with `cancelled_at` set; the worker writes a fresh run of a cancelled repeating job
   when it starts.
6. A listener on the in-process event bus that throws is isolated, logged as one JSON line with the
   event and listener names and the request id, and counted in `event_listener_failures_total`
   (a `createCounter` from `@spy4x/platform/universal/metrics`). Register listeners with `subscribe`
   (not `eventBus.on`) so the name is known, and mark each best-effort or durable in
   `apps/api/cqrs/+init.ts`. Nothing exports the counter yet (`renderPrometheus` prints it). Once
   the API serves it, add a scrape job to `infra/configs/vmagent.yml` and a rule to
   `infra/configs/alerts.yml` (docs/stack.md, "Monitoring"). An outbox row has no payload, so a
   listener that needs the event's data cannot be durable until it has one. An audit record is
   therefore never a listener: sign-up, sign-in, sign-out and the profile change write their
   `auth_audits` row with `tx.authAudit.insert` in the command's transaction, so a failed row undoes
   the action and a kept action always has its row (spy4x/template#191). A new audited action does
   the same.
7. The SPA treats a hint as a reason to read. `pull` (`apps/spa/src/state/pull.ts`) reads again
   what the hint names: the groups list (over REST, `GET /api/groups`, or as the socket's
   `group.list` query), then the open group's notes, tags and members. It is the same read the page
   makes at start-up and after every reconnect, so a lost frame costs one read.
8. The selected group is per person, not per group: a `user_settings` row holds `selected_group_id`
   and a `version`. It is read through `getSelected`, which checks membership at read time and, when
   nothing is stored or the stored group is gone, deleted or was left, answers with their oldest
   group. That read stores nothing and announces nothing, so it can never
   overwrite a choice committed at the same moment; only `select` writes. A `select` emits
   `GroupSelectedEvent`; its listener calls `Realtime.notifyUserChange`, the same one-person hint
   the profile and push devices use (cursor `user:<id>`), and the SPA answers that hint by reading
   the profile and the selection again. The event bus is in-process, so only the API instance that
   took the `select` reaches the person's sockets; another instance's sockets catch up on their next
   reconnect. Notes live at `/notes` and show the selected group's notes. An old
   `/groups/:groupId/notes` link only redirects: to `/notes` when that group is already the selected
   one, otherwise to `/groups`. It never selects, because a link another site controls must not
   switch a person's group (the API refuses a select that is not a post from the app's own page).
   The create form names the group on screen. `/groups` lists the groups, each row one link to the
   group's page, with the person's role and "Current" on the current group. `/groups/new` and
   `/groups/:groupId` are the same editor: `GroupEditorScreen` in `libs/ui`. Its form holds the
   name, description, emoji and colour; a create sends them in one `group.create`, and a save sends
   a rename (`PATCH /api/groups/:id`, `group.rename`) and the details (`group.updateDetails`), each
   only when it changed. An editor or a viewer sees the details as text. A "Delete group" section,
   for the owner only, holds the confirmation text and the delete (`DELETE /api/groups/:id`,
   `group.delete`). Each later issue (members, roles and leaving spy4x/template#130; invitations
   spy4x/template#131; ownership spy4x/template#132; moving notes spy4x/template#133; moving all of
   a group's data spy4x/template#260; the extra fields spy4x/template#134) adds its own section to
   that screen, shown only to the roles that may use it.
9. **Deleting a group.** A delete is soft: `groups.deleted_at` is set and the row, its members and
   its notes stay. The server refuses it with `LAST_GROUP` (409) when it is the actor's last active
   group, and the settings page then shows the button disabled with the reason. A member whose only
   group it was gets a new group named "Personal" in the same transaction. Every read of groups
   filters `deleted_at`, so the selection falls back to the oldest remaining group at read time;
   nothing has to clear a stored choice. The delete is an access change: it raises the group's
   `authorization_revision` and names every member on the `group_access_lost` channel at its
   commit, so each member's socket gets the delete's hint and their pages read again.
   `listMemberUserIds` leaves a deleted group out, so no later hint for it reaches anyone. The
   restore raises the revision too. The owner restores it from the "Deleted groups" section of
   `/groups` (`POST /api/groups/:id/restore`, `group.restore`, `POST /groups/:id/restore`; the list
   is `GET /api/groups/deleted`, `group.deleted`) for `GROUP_RESTORE_DAYS` (30) days, by the
   database clock. The nightly `outbox.cleanup` job also runs `purgeDeletedGroups`, which removes
   groups past that for good, with their notes and members, so a group may live up to a day longer
   than 30 days but can no longer be restored. The settings page of a deleted group is a 404.
10. **There is no group kind.** Every group is an ordinary one; sign-up makes one named
    "Personal" (`createFirst`, `ensureFirst`), and the create body is `{ id, name }`. Migration
    `2026_10_07_0001_group_kind_removed.sql` dropped `groups.kind` and rewrote no row.

    **Audit.** Rename, delete and restore each write an `audit_events` row (kind `group.renamed`,
    `group.deleted`, `group.restored`, with the actor and request id) in the same transaction as
    the change. Migration `2026_10_08_0001_audit_outlives_group.sql` makes `audit_events.group_id`
    nullable with `ON DELETE SET NULL`, so the purge leaves the rows behind with the group id
    emptied; they are the record of who deleted what.

    **A note and a delete racing.** A delete can land while a note write is on its way.
    `recordGroupChange` refuses a deleted group inside the write's transaction
    (`GroupNotActiveError`, answered as `GROUP_NOT_FOUND`), and the note write rolls back; the
    delete records its own change with `allowDeleted`. The delete's row locks are `FOR NO KEY
    UPDATE`, because `FOR UPDATE` conflicts with the key-share lock a note insert takes on its
    foreign keys and the two deadlock.

## Members, invitations and ownership

Member removal, role changes and leaving (spy4x/template#130) call `recordAccessChange` in their
transaction, with the removed member in its list of users who lost access (a demoted member keeps
access). Note writes and rename read the actor's role again inside their own transaction with
`lockActorRole` (`libs/server/groups/group-change-log.ts`): it locks the group row, then the
membership `FOR SHARE`, so a write racing a removal or demotion waits for it and is then refused
(spy4x/template#230). The member commands lock the group row too, then the memberships of the actor
and the target with `lockMemberRoles` (`FOR UPDATE`), and check the rule on those rows. Keep the
group row first in both: the other order deadlocks a write against a member change (the "lock order"
tests in `tests/integration/group-write-race.integration.test.ts`). `recordAccessChange` and
`recordGroupChange` take a transaction, never the pool. Members' sign-in addresses go only to the
owner and admins (`canSeeMemberEmails`); other members get no `email` field.

Invitations (spy4x/template#131): only `sha256(token)` is stored (`group_invitations.token_hash`),
so a link is shown once, in the answer to its create, and never again: the create sends no
`Idempotency-Key`, since the idempotency store would keep the token. The link is `/invite/:token`;
the API takes the token only in a JSON body, never in a URL it logs, and the SPA sends no referrer
from the invitation page. Pending invitations take no seat: the create is refused by the entitlement
gate when the members alone fill the plan's `maxMembers`, and the accept counts the members again
under the group row's lock (`PostgresInvitationRepository.accept`). An address-bound invitation is
accepted only by an account that proved that address (`provenAddressOwner`). Create, accept and
revoke write their audit rows in their own transaction. Creates are capped per user per hour, mails
per address per hour, and previews and answers per IP (`invitation-rate-limits.ts`). A member who is
removed or leaves loses every pending invitation they made, and one who is demoted loses those above
what they may now invite with, in the same transaction (`revokeInvitationsOf`).
`group_invitation_acceptances` records who accepted each invitation, so a removed member cannot
rejoin through the invitation link they used. On a plan without `memberRoles` an invitation adds a viewer
only, on create and on accept; the role picker says so. Invitations are the only way into a group
through the product. The nightly cleanup deletes invitations that have been dead (expired, revoked,
declined or used up) for over 30 days.

Ownership transfer (spy4x/template#132): `POST /api/groups/:id/transfer` takes `{ userId, name,
password }`, over HTTP only, never the socket, so the password does not cross a long-lived channel.
It spends the per-user budget a password change spends (`strictByUser`), checks the role, then the
typed name, then the password, so a refused request spends no password check. One transaction
demotes the old owner to admin before it promotes the new one: the partial unique index
`group_members_one_owner_key` allows one owner row per group and cannot be deferred. The old owner's
admin links are revoked, and their viewer and editor links stay; the new owner's links stay. The new
owner gets a web push. A subscription that still renews refuses the transfer
(`SUBSCRIPTION_RENEWS`); after it, the old owner's billing customer is handed over and the new owner
checks out with their own ([billing for operators](billing-operator.md#transfer-of-ownership)).

Moving all of a group's data (spy4x/template#260): `POST /api/groups/:id/move-all` takes `{
toGroupId }`, and the socket command `group.moveAll` takes `{ groupId, toGroupId }`. One transaction
locks both groups in id order, checks edit rights in both on the locked rows, records a change in
each (`group.data_moved_out`, `group.data_moved_in`), runs every aggregate in `MOVABLE_AGGREGATES`
(`apps/api/services/db-base.ts`) and writes one audit event per group; any failure rolls back the
lot. A group with nothing to move is refused (`NOTHING_TO_MOVE`), moving into the same group is
`SAME_GROUP`, and notes deleted earlier stay behind. The target's note cap is read by the gate and
counted by the repository, which refuses with the plan refusal. The settings menu offers it as "Move
all data to...", then the delete confirmation. A new aggregate registers as described in
[Delete, move and export an aggregate](aggregate-lifecycle.md), "Register it for move all data".
