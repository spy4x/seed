---
slug: multi-tenant-saas-groups-roles-postgres
language: en
title: "Multi-tenant SaaS: groups, roles and permission checks in Postgres"
seoTitle: "Multi-tenant SaaS in Postgres: groups, roles, permission checks"
description: "How Seed keeps tenants apart in one Postgres database: a group id on every row, four fixed roles, the role checked in every handler and read again under a lock on every write."
tldr:
  - "In Seed the tenant is a group. Every row carries a group_id, and a person's access is one row in group_members with a role from 1 to 4."
  - "Who may do what is a set of small pure functions. Every handler reads the role and calls one; the socket and HTTP share the same handlers."
  - "Every write reads the role again inside its own transaction, under a lock, so a member removed a moment earlier cannot slip one last write in."
  - "There is no row-level security. A stranger gets 404, never 403, and tests check that one group never sees another's data."
topic: Deep dive
intro: "Every SaaS with teams has to answer the same question on every request: is this person allowed to touch this row? Here is how Seed answers it in one Postgres database, with the real code, and the one place it trades safety for simplicity."
relatedFeature: groups
cover: covers/multi-tenant-saas-groups-roles-postgres.webp
coverAlt: "A greenhouse divided into glass rooms, each with its own plants and its own violet door, with a key hanging beside each door."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: true
---

How do you build a multi-tenant SaaS on Postgres so that one team never sees another's data? In
Seed, the tenant is a **group**. Every row that belongs to a tenant carries a `group_id`, a person's
access is one row in `group_members` with a role, and every request checks that role in code before
it reads or writes. Writes check it twice: once in the handler, and again inside the write's own
transaction, under a lock. One shared database, one schema, no row-level security.

This post is for developers building a team product who want to see a whole, working answer
rather than a diagram. All of it is in [Seed's code](https://github.com/spy4x/seed), MIT-licensed,
and the excerpts below are the real lines, a little trimmed.

## What is a tenant in Seed?

A group. There is no separate "personal" kind: signing up creates an ordinary group named
"Personal", with you as its only member. So a solo user and a 50-person team go through the same
code, and nothing has to be migrated when a solo user invites a colleague. A person can belong to
as many groups as they like.

Membership is one table
([the migration](https://github.com/spy4x/seed/blob/main/libs/server/db/migrations/2026_08_18_0001_group_core.sql)):

```sql
CREATE TABLE group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INT2 NOT NULL,
    ...
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_members_role_check CHECK (role BETWEEN 1 AND 4)
);
```

Postgres holds two rules itself: a role is 1 to 4, and a partial unique index allows exactly one
owner per group. A transfer of ownership demotes the old owner before it promotes the new one, in
one transaction, because that index won't allow two owners even for a moment. Every row of a
feature (a note, a tag, a file) has its own `group_id` column.

## Which roles are there, and what can each do?

Four, fixed, ordered: viewer (1), editor (2), admin (3), owner (4). Ordered numbers make most rules
one comparison: "editor or above" is `role >= 2`.

| What                    | Viewer | Editor | Admin | Owner |
| ----------------------- | ------ | ------ | ----- | ----- |
| Read notes              | yes    | yes    | yes   | yes   |
| Write notes             | no     | yes    | yes   | yes   |
| Invite viewers, editors | no     | no     | yes   | yes   |
| Rename, see emails      | no     | no     | yes   | yes   |
| Make an admin           | no     | no     | no    | yes   |
| Pay, delete, transfer   | no     | no     | no    | yes   |

An admin manages viewers and editors, never another admin, and nobody but the owner touches the
owner. On the Free plan, an invitation adds a viewer only: giving members other roles is what the
paid plan sells. I'll come back to how a plan and a role stay apart.

## Where does the permission check live?

In small pure functions in the domain library, one per question
([`libs/domain/groups`](https://github.com/spy4x/seed/blob/main/libs/domain/groups/+lib.ts)). The
hardest one, who may change whose role, is the longest:

```ts
export function canManageMember(actor: GroupRole, target: GroupRole, next?: GroupRole): boolean {
  if (!isGroupRole(actor) || !isGroupRole(target) || (next !== undefined && !isGroupRole(next))) {
    return false
  }
  if (actor === GroupRole.OWNER) return true
  if (actor !== GroupRole.ADMIN || target > GroupRole.EDITOR) return false
  return next === undefined || next <= GroupRole.EDITOR
}
```

No database, no request, no framework: a unit test calls it with every combination of roles. A handler
reads the actor's role and passes it to the matching check before it calls the repository:

```ts
assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
```

The transports hold no rules at all. A call arrives over the WebSocket or as
`POST /api/call/<name>`, both reach the same handler, and both get the same answer. That is what
lets [realtime fall back to HTTP](/blog/realtime-websocket-with-http-fallback) without a second set
of permission checks to keep in step.

## Why check the role twice?

Because a role read before a write can be stale by the time the write commits. Picture it: the
owner removes an editor at the same instant the editor saves a note. The handler read "editor" a
millisecond ago, the removal commits, and the note lands in a group its author no longer belongs
to.

So every write to a group calls `lockActorRole` first, inside its own transaction
([`group-change-log.ts`](https://github.com/spy4x/seed/blob/main/libs/server/groups/group-change-log.ts)):

```ts
const active = await sql`
  SELECT 1 FROM groups WHERE id = ${groupId} AND deleted_at IS NULL FOR NO KEY UPDATE
`
if (active.length === 0) throw new GroupNotActiveError(groupId)
const member = (await sql`
  SELECT group_members.role
  FROM group_members
  INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
  WHERE group_members.group_id = ${groupId} AND group_members.user_id = ${actorId}
  FOR SHARE OF group_members
`)[0]
return member?.role ?? null
```

The group row is locked first, in the same order every membership change takes it, so the two
wait for each other instead of deadlocking. The membership row is read `FOR SHARE`: a removal that
committed first is seen, and one that comes later waits until the write is done. The repository
then checks the role it got back, so the second check costs one indexed read in a transaction that
was open anyway.

A test proves it for each kind of note write: it holds a removal or a demotion open, starts the
write, sees the write wait, commits the change, and expects the write to be refused with nothing
saved ("note update: refused when a removal commits while the write waits", in
`tests/integration/group-write-race.integration.test.ts`).

## Why does a stranger get 404 instead of 403?

Because 403 says "this group exists, you just can't have it". A person who is not a member gets
`GROUP_NOT_FOUND`, exactly what a group that never existed answers, so nobody can probe group ids
to learn which ones are real. A member who lacks the role gets 403 `ROLE_INSUFFICIENT`, since they
already know the group is there.

The same rule covers the plan. When a group hits its plan's limit, the answer is **402 Payment
Required**, not 403, so the app can tell "ask the owner to upgrade" from "you don't have the
role". A role decides who may act; a plan decides how much the group gets. Seat billing and its
webhooks have [a post of their own](/blog/per-seat-billing-stripe-webhooks-retries).

## Why not Postgres row-level security?

I considered it, and wrote the trade-off down in the
[group sync design](https://github.com/spy4x/seed/blob/main/docs/design/group-sync.md#9-tradeoffs).
Row-level security would put a second copy of the permission rules in the database, in SQL
policies, next to the copy the handlers need anyway to answer "you're a viewer" with a useful
error. Two copies of one rule drift apart. It also makes every connection carry the current
person, which complicates pooling, background jobs and migrations.

The honest cost: with filters in application code, one query that forgets `group_id` can leak
data. Seed answers that in three ways:

- **Scoped signatures.** A repository method takes the group id as an argument, such as
  `get(groupId, id)`, and its query filters on both. There is no "get a note by id" to misuse.
- **One checklist for every feature.** [docs/aggregates.md](/docs/aggregates) lists the rules a new
  feature copies: it lives in a group, every row has a `group_id`, every write reads the role again.
- **Cross-group tests.** Integration tests run against a real Postgres with a stranger in a group of
  their own, in steps such as "never counts a note of another group" and "a person who is not a
  member is told the group does not exist".

If your product needs a database-level guarantee, say for a compliance audit, row-level security
is a sound choice and you can add it on top. For a starter, I chose one place for the rules.

## What does Seed not do?

- **No custom roles.** Four fixed roles. A product that needs "billing manager" adds a role and its
  checks.
- **No per-record permissions.** A role applies to the whole group; you can't share one note with
  one person.
- **No row-level security**, as above.
- **No separate schema or database per tenant.** Every group shares the tables.

## Try it

Open the [live demo](https://app.seedsaas.com), create a group, invite a second account as a
viewer, and try to edit a note from it. The [groups feature page](/features/groups) has the short
version, and [Your first feature](/blog/your-first-feature-copy-the-notes-aggregate) shows how a
new kind of record inherits all of this by copying the notes code. If your own app checks the role
once, before the transaction, that's the race I'd close first.
