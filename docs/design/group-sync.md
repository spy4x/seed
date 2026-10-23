# Group Sync Technical Design

> **Group kinds were dropped (spy4x/template#129).** Wherever this document says `GroupKind`, `PERSONAL`,
> `SHARED`, `createPersonal`, `createShared` or `PERSONAL_GROUP_IMMUTABLE`, read an ordinary group:
> there is no `kind` column and no personal-group invariant. Sign-up creates a group named
> "Personal". `docs/handoff.md` ("How a group call travels", items 9 and 10) is current.
> Group renames, deletes and restores write audit rows that outlive the group: `audit_events.group_id`
> is nullable with `ON DELETE SET NULL` (`docs/handoff.md`, item 10).

> **Status: superseded in part by [ADR 002](../decisions/002-realtime-transport-and-sync.md).**
>
> This document predates ADR 002 and assumes WebSockets are an optional wakeup
> that no accepted state depends on. That is no longer true: `apps/spa` speaks
> WebSocket for mutations, queries and realtime, and pushed changes are stamped
> with a sequence so a client can detect a gap and fall back to a cursor pull.
>
> Overridden here: every claim that WebSocket is optional, that "no accepted
> state travels only through WebSocket", and that WebSocket-only sync was
> rejected. Still current and still the plan: the committed change log, cursor
> semantics, idempotency and expected-version rules, conflict handling, and the
> requirement that the protocol converge without a socket - which survives as
> the REST pull path.

- Status: approved for implementation
- Owner: designer
- Effort: M
- PRD: `docs/prd/group-sync-platform.md`
- ADR: `docs/decisions/001-deno-platform-template.md`
- Scope: v1 Git template

## 1. Overview

This design adds server-authoritative groups and offline sync to the Deno platform template. It
uses one tenant boundary, the group, for personal and shared data. A removable notes aggregate
proves the protocol without becoming part of the platform API.

The design follows ADR 001: Hono exposes REST, command handlers own mutations, query handlers own
reads, Postgres is authoritative, and Dexie is a disposable browser projection. WebSocket may
prompt an earlier pull, but correctness never depends on it. This is CQRS over current-state tables
plus a synchronization change log, not event sourcing.

### Fixed v1 decisions

- `GroupKind`: `PERSONAL=1`, `SHARED=2`.
- `GroupRole`: `VIEWER=1`, `EDITOR=2`, `ADMIN=3`, `OWNER=4`.
- Signup atomically creates the user, credential, session, personal group, and owner membership.
- All client-created syncable entities use UUID version 7 IDs ([docs/ids.md](../ids.md)); rows
  made before that keep their version 4 ids. DB `BIGINT` values cross JSON as decimal
  strings to avoid JavaScript precision loss.
- Every group resource and query is scoped by `group_id`; v1 does not use Postgres RLS.
- Sync accepts only registered semantic commands. It never accepts class names, SQL-like patches,
  arbitrary event names, or client authorization claims.
- Push rechecks the current session, MFA completion when configured, membership, role, input,
  command receipt, and expected entity version.
- Conflicts never auto-merge note title or body. The local payload remains an editable draft.
- The next successful authenticated manifest purges revoked group projections. A server cannot
  erase data from a device that remains offline; product documentation must state this limit.
- Browser acceptance covers current and previous two major versions of Chromium, Firefox, and
  Safari.
- Push accepts at most 100 commands and 512 KiB of decoded JSON. Pull and bootstrap return at most
  500 changes/items and 1 MiB of encoded JSON per page, whichever limit is reached first.
- Export is outside v1. Rejected and conflict drafts remain locally available as the only
  portability exception.

### Current code constraints

- Root API already uses Hono under `/api` and runs auth parsing for all routes
  (`apps/api/index.ts:17-37`). New routes compose there rather than starting another server.
- Current auth is a signed cookie resolved to DB session, user, and key
  (`apps/api/services/auth/+index.ts:20-40`; `apps/api/services/auth/cookie.ts:7-51`).
- Current MFA guard rejects only `NOT_PASSED_YET` (`apps/api/middlewares/auth-guards.ts:27-37`).
  Group and sync routes must use the stronger configured-MFA rule defined below.
- Signup already has one DB transaction for user, key, and session
  (`apps/api/services/auth/password.ts:55-101`). Personal group creation joins this transaction.
- Existing generic DB mutation helpers filter only by row ID
  (`libs/server/db/+index.ts:121-177`). Group repositories must not use them because every group
  query must include `group_id`.
- Existing CQRS buses dispatch typed classes (`libs/platform/cqrs/command-bus.ts:9-29` and
  `libs/platform/cqrs/query-bus.ts:9-29`). Sync adds a semantic allowlist adapter; it does not expose
  constructors over HTTP.
- Existing in-memory event delivery is queued in a microtask and has no durability
  (`libs/platform/cqrs/event-bus.ts:34-44`). Authoritative writes therefore use a transactional
  outbox; in-memory events remain optional UI notifications only.
- Existing schema uses integer user IDs and enum checks beginning at 1
  (`libs/server/db/schema.sql:16-67`). New group tables reference current integer user IDs and use
  UUIDs only for syncable/group-facing IDs.
- Existing `UserRole` names are application-global and differ from group roles
  (`libs/shared/types/+index.ts:50-55`). `GroupRole` is separate; global role never grants group
  access.
- SPA state currently lives in Signals and uses plain fetch
  (`apps/spa/src/state/session.ts:1-18`; `apps/spa/src/state/api.ts:3-29`). Dexie becomes durable
  storage while Signals remain reactive views.
- Current WebSocket state reconnects independently (`apps/spa/src/state/ws.ts:4-86`). It may call
  manifest/pull after connection, but no accepted state travels only through WebSocket.
- Fresh currently exposes only a server-rendered shell (`apps/mpa/main.ts:1-5` and
  `apps/mpa/routes/index.tsx:4-23`). MPA group and note actions use the same REST contracts.
- Migration files run lexically, one transaction per file
  (`libs/server/db/migrate.ts:50-77`). All forward changes below fit that model.

### Key tradeoffs

Application-enforced tenant filters are simpler than introducing RLS during template migration,
but omission becomes a security risk. Explicit scoped repository signatures and cross-group tests
are mandatory mitigation. A durable current-state change log costs storage, but gives deterministic
offline replay without event sourcing. REST polling uses more requests than a live channel, but it
keeps recovery and correctness independent from connection state.

## 2. Architecture

### Layer impact and ownership

#### `libs/platform`

Owns domain-neutral sync contracts and algorithms:

- command envelope, batch outcome, change envelope, manifest, and cursor shapes;
- canonical semantic payload normalization and SHA-256 hashing;
- signed opaque cursor codec using Web Crypto HMAC;
- semantic command registry interfaces;
- size/count limit helpers and stable error codes.

It imports no group, notes, server, client, Hono, Preact, or app code, preserving the boundary in
`docs/decisions/001-deno-platform-template.md:40-49`.

#### `libs/domain/groups`

Owns `GroupKind`, `GroupRole`, invitation states, role policy, last-owner invariant, group command
and query contracts, and authorization decisions. It depends only on `libs/platform`.

#### `libs/domain/notes`

Owns removable note schemas, aggregate rules, commands, queries, and change projection mapping.
Title and body are sensitive fields. Removing this directory and its app registrations must leave
generic sync tests passing.

#### `libs/server`

Owns Postgres repositories, transaction/unit-of-work adapter, group-scoped query builders, outbox
store, audit store, and cursor signing-key adapter. It may depend on platform and domain contracts.
Repositories require group scope in method signatures and SQL predicates. They never infer scope
from payload data.

#### `apps/api`

Owns Hono middleware, HTTP validation, session/MFA enforcement, Origin checks, request-size limits,
CQRS composition, semantic command registration, and REST response mapping. Handlers contain no raw
SQL and UI components contain no authorization rules.

#### `apps/spa`

Owns Preact views and Signals derived from Dexie live queries. UI sends intent to the local command
queue and displays projection state plus pending/rejected/conflict overlays. It does not write
authoritative-looking state directly into shared Signals.

#### `apps/mpa`

Owns server-rendered public and authenticated pages. It calls the same REST API and submits the same
command metadata. It has no Dexie/offline queue.

#### `apps/worker`

Owns outbox claim/retry and retention cleanup. Sync correctness does not wait for worker output:
authoritative row, change, receipt, audit, and outbox record are committed together by API.
Notification/integration failures are fail-open and retried independently.

### State management

Postgres stores authoritative groups, memberships, invitations, notes, command receipts, ordered
changes, audits, and outbox rows. Each mutable note has a monotonically increasing entity version.
Each group has a monotonically increasing change sequence and authorization revision.

Dexie is partitioned by authenticated `accountId` and stores:

- group manifest entries keyed by `[accountId+groupId]`;
- note projections keyed by `[accountId+groupId+noteId]`;
- per-group signed pull checkpoint and bootstrap state;
- queued commands keyed by `[accountId+commandId]`;
- local drafts keyed by `[accountId+draftId]`;
- one stable UUID `deviceId` for the browser profile.

Signals expose current account, selected group, projection rows, sync status, and command counts.
Dexie transactions update projection, checkpoint, queue status, and purge markers atomically.
Sign-out or account switch closes sync, clears all account-partitioned stores including drafts, then
clears Signals. A stable device ID contains no user content and may remain.

### Data flow

1. Session bootstrap succeeds and confirms configured MFA completion.
2. Client sends manifest with device ID and locally known group IDs/revisions/checkpoints.
3. Client transaction purges returned group IDs before rendering or pushing queued commands.
4. New/invalidated groups bootstrap; established groups pull from signed checkpoints.
5. Offline UI writes a validated semantic command and local pending overlay in one Dexie
   transaction.
6. Online coordinator pushes commands in creation order, grouped by group ID, after a fresh
   manifest.
7. API validates each command and commits accepted mutation, change, receipt, audit, and outbox in
   one Postgres transaction.
8. Client records each outcome. Accepted overlays remain pending until corresponding authoritative
   change is pulled, preventing local payload from masquerading as server state.
9. Pull applies ordered upserts/tombstones and advances checkpoint in one Dexie transaction.
10. Optional WebSocket or service-worker wakeup triggers steps 2-9 earlier; timer, focus, online
    event, and explicit retry remain sufficient.

### Authorization model

- `VIEWER`: list group, bootstrap, pull, and read notes.
- `EDITOR`: `VIEWER` plus create, update, and delete notes.
- `ADMIN`: `EDITOR` plus invite `VIEWER`/`EDITOR`, revoke pending invitations, change
  `VIEWER`/`EDITOR` roles, and remove `VIEWER`/`EDITOR` members.
- `OWNER`: all actions plus grant/revoke `ADMIN`/`OWNER`, remove any non-last owner, and manage other
  owners.
- A shared group may have multiple owners but must always have at least one active owner.
- A personal group has exactly one owner: its user. It cannot accept invitations, change owner,
  remove its owner, or be manually created/deleted.
- Shared-group creator becomes owner in the same transaction as group creation.
- Invitation targets an existing user by normalized username. It lasts seven days. One pending
  invitation per `(group_id, invitee_user_id)` is allowed. Recipient acceptance creates membership
  and marks invitation accepted atomically.
- Membership/invitation changes increment `authorization_revision` in the same transaction, through
  `recordAccessChange` (see "Access changes on open sockets" below).
- Missing group and absent/revoked membership return indistinguishable `GROUP_NOT_FOUND` responses.
  Insufficient role may return `ROLE_INSUFFICIENT` only after membership is established.

### Authentication and request security

Current signed session-cookie auth is accepted. Group routes require:

- a valid active session;
- when `user.mfa=CONFIGURED`, `session.mfa=COMPLETED` exactly;
- same-origin `Origin` or valid Fetch Metadata on state-changing browser requests;
- JSON content type for JSON mutation routes;
- fresh membership/role lookup inside the command transaction.

Client-provided user ID, role, authorization revision, receipt result, cursor content, and entity
version are never trusted. HTTPS is mandatory outside local development.

### Dependency decision

One new runtime dependency is justified: Dexie through a pinned Deno `npm:` specifier. It is
required by the approved PRD, mature, maintained, and isolates IndexedDB transaction/browser quirks.
Raw IndexedDB was rejected because it adds large adapter and migration burden; another wrapper
would not improve size or maintenance. No cursor, hash, UUID, merge, queue, or canonicalization
dependency is added: Deno Web Crypto, the library's `uuidV7()`, and internal bounded algorithms cover
them. Service-worker behavior remains hand-written; no WebSocket or PWA plugin is required.

### Coupling risks

- **Risk:** API handlers import Postgres details. **Control:** handlers depend on scoped repository
  interfaces; only `libs/server` imports the Postgres client.
- **Risk:** platform sync registry imports notes. **Control:** app composition registers a notes
  adapter; `libs/platform` knows only semantic names and generic results.
- **Risk:** UI infers authorization. **Control:** role-based controls are convenience only; every API
  path reauthorizes.
- **Risk:** generic ID-only DB helpers bypass tenant scope. **Control:** prohibit them for all new
  group tables and test generated SQL/repository behavior with foreign-group IDs.
- **Risk:** worker or WebSocket becomes required for convergence. **Control:** committed change log
  is readable immediately over REST; auxiliary failures cannot alter command outcome.

## 3. Components

Signatures below are contracts, not implementation.

### New platform components

#### `SemanticCommandRegistry`

- `register(name: string, adapter: SemanticCommandAdapter): void`
- `resolve(name: string): SemanticCommandAdapter | null`
- `list(): readonly string[]`
- Errors: duplicate registration at startup; unknown names resolve to `null` and map to
  `COMMAND_NOT_ALLOWED`.

#### `SemanticCommandAdapter`

- `validate(payload: unknown): CommandValidationResult`
- `authorize(context: CommandContext): Promise<AuthorizationDecision>`
- `execute(context: CommandContext): Promise<CommandExecutionResult>`
- Errors: typed validation, authorization, conflict, or domain rejection; unexpected errors abort
  current command transaction.

#### `CanonicalPayloadHasher`

- `normalize(envelope: HashableCommandEnvelope): CanonicalJsonValue`
- `hash(envelope: HashableCommandEnvelope): Promise<string>`
- Return hash: lowercase SHA-256 hex.
- Errors: unsupported JSON value, unsafe integer, non-finite number, or schema mismatch.

Normalization recursively sorts object keys and serializes only validated strings, booleans,
nulls, arrays, and safe integers. Versions/revisions are already decimal strings. The hash covers
schema version, group ID, device ID, command name, expected version, entity ID, and validated
payload; it excludes command ID and transport metadata.

#### `SyncCursorCodec`

- `sign(state: CursorState): Promise<string>`
- `verify(cursor: string, expectedGroupId: string): Promise<CursorState>`
- Errors: `CURSOR_INVALID`, `CURSOR_EXPIRED`, `CURSOR_SCOPE_MISMATCH`.

Cursor is base64url payload plus HMAC-SHA-256 signature and key ID. Payload contains protocol
version, purpose (`pull-checkpoint`, `pull-page`, or `bootstrap-page`), group ID, authorization
revision, after sequence/entity ID, fixed high-water sequence where relevant, issued time, and
expiry. Current and previous signing keys are accepted during rotation. Cursor content is opaque
to clients and never substitutes for authorization.

### New group domain components

#### `GroupAuthorizationPolicy`

- `canRead(role: GroupRole): boolean`
- `canMutateNotes(role: GroupRole): boolean`
- `canManageMember(actor: GroupRole, target: GroupRole, next?: GroupRole): boolean`
- `assertPersonalInvariant(group: Group, operation: GroupOperation): void`
- Errors: `GROUP_NOT_FOUND`, `ROLE_INSUFFICIENT`, `PERSONAL_GROUP_IMMUTABLE`, `LAST_OWNER`.

#### `GroupRepository`

- `listForUser(userId: number): Promise<GroupSummary[]>`
- `getForMember(groupId: string, userId: number): Promise<GroupAccess | null>`
- `createShared(input: CreateSharedGroupInput, actorId: number): Promise<Group>`
- `createPersonal(input: CreatePersonalGroupInput, userId: number, tx: UnitOfWork): Promise<Group>`
- `incrementAuthorizationRevision(groupId: string, tx: UnitOfWork): Promise<bigint>`
- Every lookup that returns group-owned content requires both group ID and current user/member scope.

#### `MembershipService`

- `invite(input: InviteMemberInput, actor: Actor): Promise<GroupInvitation>`
- `accept(invitationId: string, actor: Actor): Promise<GroupMembership>`
- `decline(invitationId: string, actor: Actor): Promise<void>`
- `changeRole(input: ChangeMemberRoleInput, actor: Actor): Promise<GroupMembership>`
- `remove(input: RemoveMemberInput, actor: Actor): Promise<void>`
- Errors: typed invitation, role, personal-group, last-owner, and concurrent-change errors.

### New sync application components

#### `ManifestService`

- `build(actor: Actor, input: ManifestRequest): Promise<ManifestResponse>`
- Returns current accessible groups, authorization revisions, bootstrap flags, and `purgeGroupIds`.
- Errors: auth/MFA failure or request count/size violation.

#### `PushService`

- `push(actor: Actor, groupId: string, batch: PushRequest): Promise<PushResponse>`
- Processes commands in request order. Each command has an independent DB transaction; one domain
  rejection does not roll back accepted siblings.
- Errors: envelope-level auth, group, request size/count, or protocol failures. Per-command expected
  failures are returned as outcomes.

#### `PullService`

- `pull(actor: Actor, groupId: string, cursor?: string): Promise<PullResponse>`
- `bootstrap(actor: Actor, groupId: string, cursor?: string): Promise<BootstrapResponse>`
- Returns bounded fixed-snapshot pages and signed next cursors.
- Errors: auth, group, authorization revision, cursor, retention, and response-item-too-large errors.

#### `CommandTransactionCoordinator`

- `execute(actor: Actor, envelope: SyncCommandEnvelope): Promise<CommandOutcome>`
- Validation order: session/MFA, group membership, role, schema/allowlist, canonical hash, existing
  receipt, expected version, domain execution.
- Accepted transaction writes aggregate, group change, receipt, audit, and outbox atomically.
- Conflict/rejection writes receipt and audit atomically but no change/outbox. Unauthorized attempts
  write audit only and never disclose an existing receipt.

#### `OutboxWorker`

- `claim(limit: number, now: Date): Promise<OutboxEvent[]>`
- `handle(event: OutboxEvent): Promise<void>`
- `complete(eventId: string): Promise<void>`
- `retry(eventId: string, nextAt: Date, errorCode: string): Promise<void>`
- Errors never roll back already committed domain work. Consumers deduplicate by outbox event ID.

### New notes example components

#### `NoteRepository`

- `list(groupId: string, page: NotePage): Promise<Note[]>`
- `get(groupId: string, noteId: string): Promise<Note | null>`
- `create(groupId: string, input: NewNote, tx: UnitOfWork): Promise<Note>`
- `update(groupId: string, noteId: string, expected: bigint, patch: NotePatch, tx: UnitOfWork): Promise<Note>`
- `remove(groupId: string, noteId: string, expected: bigint, tx: UnitOfWork): Promise<NoteTombstone>`
- Errors: `NOTE_NOT_FOUND`, `VERSION_CONFLICT`, validation failure. Every SQL predicate includes
  `group_id` and entity ID.

Registered sync commands are exactly:

- `notes.create`: `entityId` UUID, `expectedVersion="0"`, title 1-200 characters, body at most
  100 KiB UTF-8.
- `notes.update`: `entityId` UUID, current positive expected version, complete replacement title and
  body. Patch semantics are intentionally excluded so canonical intent stays stable.
- `notes.delete`: `entityId` UUID and current positive expected version; payload is empty.

### New client components

#### `LocalProjectionStore`

- `open(accountId: number): Promise<void>`
- `applyChanges(groupId: string, page: PullResponse): Promise<void>`
- `replaceBootstrapPage(groupId: string, page: BootstrapResponse): Promise<void>`
- `purgeGroups(groupIds: string[]): Promise<void>`
- `clearAccount(accountId: number): Promise<void>`
- Errors: quota, IndexedDB blocked/version, corrupt local record. Recovery rebuilds from bootstrap.
- Applying an upsert never replaces a higher local entity version with a lower one. It still advances
  the ordered checkpoint, which makes bootstrap followed by concurrent pull safe.

#### `LocalCommandQueue`

- `enqueue(command: LocalCommand): Promise<void>`
- `next(groupId: string, limit: number): Promise<LocalCommand[]>`
- `recordOutcome(commandId: string, outcome: CommandOutcome): Promise<void>`
- `discard(commandId: string): Promise<void>`
- Pending, accepted-awaiting-pull, rejected, conflict, and discarded are distinct states.

#### `SyncCoordinator`

- `sync(reason: SyncReason): Promise<SyncSummary>`
- `manifest(): Promise<ManifestResponse>`
- `push(groupId: string): Promise<PushResponse>`
- `pull(groupId: string): Promise<void>`
- Serializes work per group and coalesces duplicate wakeups. A failed manifest blocks push but leaves
  queued commands intact.

#### `ConflictDraftService`

- `preserve(command: LocalCommand, outcome: ConflictOutcome): Promise<ConflictDraft>`
- `retry(draftId: string, currentVersion: string): Promise<LocalCommand>`
- `discard(draftId: string): Promise<void>`
- Never merges title/body. Retry creates a new command ID and uses the displayed current version
  only after explicit user confirmation.

### Modified components

- `PasswordMethod.signUp`: include personal group and owner membership in the existing DB
  transaction. Any failed insert rolls back all signup rows.
- MFA middleware: require `COMPLETED` whenever user MFA is configured; preserve 1FA routes only for
  finishing MFA and sign-out.
- `DbService`: compose scoped group/note/sync repositories and unit of work. Existing generic
  ID-only methods remain unavailable to new group resources.
- API error mapper: convert typed domain/platform errors into stable JSON error envelopes and hide
  unexpected details.
- SPA bootstrap/sign-out: open account-partitioned Dexie only after auth; purge before rendering;
  clear local account data before completing sign-out.
- WebSocket client: replace direct authoritative updates for syncable resources with a coalesced
  sync wakeup. Existing profile notifications remain auxiliary.
- Fresh pages: call REST through a server-side client that forwards session cookie and request ID.

## 4. Data model

All new tables use `TIMESTAMPTZ`, UTC, and explicit constraints. All group-owned tables include a
non-null `group_id`. No money field is introduced; future money columns must be `BIGINT` cents,
never floating point.

### Forward schema changes

#### `groups`

`⚠ MIGRATION REQUIRED — additive`

- `id UUID PRIMARY KEY`
- `kind INT2 NOT NULL CHECK (kind IN (1,2))`
- `name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100)`
- `owner_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `created_by_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `authorization_revision BIGINT NOT NULL DEFAULT 1 CHECK (authorization_revision >= 1)`
- `next_change_sequence BIGINT NOT NULL DEFAULT 1 CHECK (next_change_sequence >= 1)`
- standard `created_at`, `updated_at`, nullable `deleted_at`
- Unique partial index on `owner_user_id WHERE kind=1 AND deleted_at IS NULL` guarantees one active
  personal group per user.
- Index on `(kind, created_at, id)` supports administration; member list joins do not scan this
  index.

#### `group_members`

`⚠ MIGRATION REQUIRED — additive`

- `group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE`
- `user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `role INT2 NOT NULL CHECK (role BETWEEN 1 AND 4)`
- `added_by_user_id INT4 NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `created_at`, `updated_at`
- Primary key `(group_id, user_id)`.
- Index `(user_id, group_id) INCLUDE (role)` serves group list and manifest.
- Index `(group_id, role)` serves last-owner locking/checks.
- Personal owner invariants are enforced by domain transaction plus a deferred constraint trigger,
  because a simple check cannot inspect both tables.

#### `group_invitations`

`⚠ MIGRATION REQUIRED — additive`

- `id UUID PRIMARY KEY`, `group_id UUID NOT NULL`, invitee/inviter user FKs, `role INT2` limited to
  1-3, `status INT2` (`PENDING=1`, `ACCEPTED=2`, `DECLINED=3`, `REVOKED=4`, `EXPIRED=5`), expiry and
  standard timestamps.
- Unique partial index `(group_id, invitee_user_id) WHERE status=1`.
- Index `(invitee_user_id, status, expires_at, created_at DESC)` serves recipient list.
- Index `(group_id, status, created_at DESC)` serves group administration.

#### `notes`

`⚠ MIGRATION REQUIRED — additive`

- `id UUID NOT NULL`, `group_id UUID NOT NULL`, title/body bounds, `version BIGINT NOT NULL CHECK
  (version >= 1)`, creator/updater user FKs, standard timestamps, nullable `deleted_at`.
- Primary key `(group_id, id)` prevents unscoped identity assumptions.
- Index `(group_id, deleted_at, id)` serves REST/bootstrap keyset pages.
- Index `(group_id, updated_at DESC, id)` serves deterministic note lists.
- Delete retains a row tombstone until the group-change retention boundary passes, then worker may
  hard-delete it. Tombstone payload contains no title/body.

#### `group_changes`

`⚠ MIGRATION REQUIRED — additive`

- `group_id UUID NOT NULL`, `sequence BIGINT NOT NULL`, `entity_type VARCHAR(64) NOT NULL`,
  `entity_id UUID NOT NULL`, `operation INT2` (`UPSERT=1`, `DELETE=2`), `entity_version BIGINT`,
  bounded `payload JSONB`, actor/command IDs, and `created_at`.
- Primary key `(group_id, sequence)` is the ordered feed.
- Unique index `(group_id, command_id)` for accepted command/change correlation.
- Index `(group_id, created_at, sequence)` supports retention cleanup.
- Sequence allocation locks the group row, consumes `next_change_sequence`, and inserts the change
  in the mutation transaction. Rolled-back transactions expose no gap; gaps would still be legal to
  clients because ordering, not continuity, is promised.

#### `command_receipts`

`⚠ MIGRATION REQUIRED — additive`

- `group_id UUID NOT NULL`, `command_id UUID NOT NULL`, actor user ID, device UUID, command name,
  canonical payload hash `BYTEA`, status `INT2` (`PROCESSING=1`, `ACCEPTED=2`, `REJECTED=3`,
  `CONFLICT=4`), nullable stable result `JSONB`, authorization revision, created/updated timestamps.
- Primary key `(group_id, command_id)` serializes retries.
- A new command first inserts a receipt reservation in its transaction. Concurrent `INSERT ... ON
  CONFLICT` waits for that transaction, then compares the committed hash/result; rollback removes
  the reservation. Transaction must change `PROCESSING` before commit; that state is never returned
  over API. This prevents two first deliveries from both mutating.
- Index `(actor_user_id, device_id, created_at DESC)` supports diagnostics.
- Accepted receipts remain for group lifetime. Rejected/conflict receipts remain at least 90 days;
  retries after expiry are freshly evaluated. Receipt cleanup never removes an accepted receipt.

#### `command_audits`

`⚠ MIGRATION REQUIRED — additive`

- `id BIGSERIAL PRIMARY KEY`, requested `group_id UUID NOT NULL` without FK so attempts against
  nonexistent groups remain auditable, actor user ID, device/command/request IDs, command name,
  payload hash, outcome/reason codes, authorization revision if known, and `created_at`.
- It stores no note title/body, session token, credential, or raw command payload.
- Index `(group_id, created_at DESC, id DESC)` and `(actor_user_id, created_at DESC, id DESC)`.
- Audit rows are append-only to app roles. Default retention is 365 days; adopters may increase it.

#### `outbox_events`

`⚠ MIGRATION REQUIRED — additive`

- `id UUID PRIMARY KEY`, `group_id UUID` and `actor_user_id` (both null for a job, both set for a
  group change, enforced by a check), event kind, aggregate ID/version, bounded JSONB
  payload, attempt count, available/claimed/processed timestamps, last error code, and created time.
- Unique `(group_id, aggregate_id, aggregate_version, event_kind)` makes publication idempotent.
- Partial index `(available_at, created_at) WHERE processed_at IS NULL` serves `FOR UPDATE SKIP
  LOCKED` claims.
- Processed rows remain 7 days; the worker's nightly `outbox.cleanup` job removes older ones. Unprocessed rows are never retention-deleted.

### Existing-table and backfill changes

`⚠ MIGRATION REQUIRED — backfill`

After tables and constraints exist, one migration inserts a personal group and `OWNER` membership
for every non-deleted existing user lacking one. It uses the same transaction as migration
recording and validates:

- each active user has exactly one active personal group;
- each personal group has exactly one membership;
- that membership points to the owner and has role 4;
- no shared group is created by backfill.

No existing column changes or drops are required. Existing `users.role` remains application-global;
group authorization reads only `group_members.role`.

### Retention and cursor boundary

Group changes and note tombstones remain for at least 30 days. Cleanup advances a per-group minimum
retained sequence only after deleting an entire safe prefix. A checkpoint below that minimum returns
`CURSOR_EXPIRED` and requires bootstrap. Signed cursor expiry is 30 days and therefore matches the
minimum offline incremental-sync window. Bootstrap has no data-loss implication because it rebuilds
the disposable projection.

### Migration rollout and rollback

1. Deploy additive table/index migration while old application continues using auth tables.
2. Run personal-group backfill and invariant verification in the same release window.
3. Deploy API/auth group support, then sync transport, then clients.
4. Enable retention worker only after pull/bootstrap acceptance tests pass.

Forward migration is additive. Index creation uses ordinary transactional `CREATE INDEX`, matching
the current migrator; production rollout must schedule lock time based on existing user count.

Rollback application: disable new routes/worker and deploy previous app; existing auth remains
compatible. Rollback schema is explicitly destructive: back up new tables, drop foreign-key
dependents in reverse order, then drop group tables. Never run schema rollback while any new client
or worker is active. Restoring from backup is the only recovery for group/note data after those
drops.

## 5. API contracts

### Common protocol

- Base path: `/api`; JSON uses UTF-8.
- Auth: current signed session cookie. Every endpoint below requires authentication and completed
  configured MFA.
- Tenant scope: group path ID plus current DB membership. No body user ID or role is accepted.
- Mutation CSRF: same-origin `Origin`/Fetch Metadata validation.
- IDs: lowercase canonical UUID strings. Version, sequence, and authorization revision values are
  non-negative decimal strings.
- Error envelope: the API's one error body, `{ "error": { "code", "message", "reason"?,
  "fields"?, "details"?, "requestId"? } }` ([api-errors.md](../api-errors.md)). The codes named
  below, such as `LAST_OWNER`, are its `reason`.
- Unknown fields are rejected, consistent with current strict schema configuration
  (`libs/shared/types/+index.ts:1-3`).
- `413 PAYLOAD_TOO_LARGE` applies before full JSON parsing when `Content-Length` exceeds the limit
  and during streaming when decoded bytes exceed it.

### Groups and membership

#### `GET /api/groups`

- Request: optional opaque keyset `cursor`; `limit` defaults 50, maximum 100.
- Response `200`: `{ groups: GroupSummary[], nextCursor: string|null }`; summary includes ID, kind,
  name, current role, authorization revision, and updated time.
- Auth/tenant: returns only active memberships for current user.
- Errors: `400 INVALID_CURSOR`, `401 AUTH_REQUIRED`, `401 MFA_REQUIRED`.

#### `POST /api/groups`

- Request: `{ id: UUID, kind: 2, name: string }`. Clients cannot create personal groups.
- Response `201`: `{ group: GroupSummary }` with caller role `OWNER`. An exact retry by the same
  creator and ID returns the same group with `200`; changed intent returns `409 ID_ALREADY_EXISTS`.
- Auth/tenant: authenticated user becomes owner; transaction creates group/membership/audit/outbox.
- Errors: `400 INVALID_REQUEST`, `409 ID_ALREADY_EXISTS`, auth/MFA errors.

#### `POST /api/groups/{groupId}/invitations`

- Request: `{ username: string, role: 1|2|3 }`.
- Response `201`: invitation without credential identifiers.
- Auth/tenant: `ADMIN` may invite roles 1-2; `OWNER` may invite 1-3.
- Errors: hidden `404 GROUP_NOT_FOUND`, `403 ROLE_INSUFFICIENT`, `409 INVITE_EXISTS`,
  `409 ALREADY_MEMBER`, `422 USER_NOT_INVITABLE`.

#### `GET /api/group-invitations`

- Response `200`: current user's non-expired pending invitations with safe group summary.
- Tenant scope comes from `invitee_user_id`; no arbitrary user filter.

#### `DELETE /api/groups/{groupId}/invitations/{invitationId}`

- Response `204`; invitation becomes `REVOKED`, never hard-deleted in request path.
- Auth/tenant: `ADMIN` may revoke invitations for roles 1-2; `OWNER` may revoke roles 1-3.
- Errors: group concealment, `404 INVITATION_NOT_FOUND`, `403 ROLE_INSUFFICIENT`.

#### `POST /api/group-invitations/{invitationId}/accept`

- Request: empty JSON object.
- Response `200`: `{ group: GroupSummary }`.
- Errors: `404 INVITATION_NOT_FOUND`, `409 INVITATION_EXPIRED`, `409 ALREADY_MEMBER`.

#### `POST /api/group-invitations/{invitationId}/decline`

- Request: empty JSON object. Response `204`.
- Errors: `404 INVITATION_NOT_FOUND`, `409 INVITATION_EXPIRED`.

#### `PATCH /api/groups/{groupId}/members/{userId}`

- Request: `{ role: 1|2|3|4 }`; response `200` with membership.
- Auth/tenant: policy above; transaction locks all current owners before last-owner validation.
- Errors: group concealment, `403 ROLE_INSUFFICIENT`, `409 LAST_OWNER`,
  `409 PERSONAL_GROUP_IMMUTABLE`.

#### `GET /api/groups/{groupId}/members`

- Request: opaque keyset cursor and limit up to 100; response contains active memberships only.
- Role: `VIEWER+`. Output contains user ID, display name, role, and joined time, never credentials.
- Errors: group concealment, auth/MFA, invalid cursor.

#### `DELETE /api/groups/{groupId}/members/{userId}`

- Response `204`.
- Auth/tenant and errors: same policy as role change. Self-leave is allowed for non-owner shared
  members. Group deletion is outside v1.

### Direct notes REST

These routes prove ordinary REST and MPA parity. They dispatch the same notes CQRS handlers as sync.

#### `GET /api/groups/{groupId}/notes`

- Request: opaque keyset cursor and `limit` up to 100.
- Response `200`: `{ notes: Note[], nextCursor: string|null }`; deleted notes are omitted.
- Role: `VIEWER+`.
- Errors: group concealment, auth/MFA, invalid cursor.

#### `POST /api/groups/{groupId}/notes`

- Request: `{ id, commandId, deviceId, expectedVersion:"0", title, body }`.
- Response `201`: `{ note, receipt }`; exact retry returns `200` and same receipt.
- Role: `EDITOR+`.
- Errors: `409 IDEMPOTENCY_MISMATCH`, `409 ID_ALREADY_EXISTS`, validation/auth errors.

#### `PUT /api/groups/{groupId}/notes/{noteId}`

- Request: `{ commandId, deviceId, expectedVersion, title, body }`.
- Response `200`: `{ note, receipt }`.
- Role: `EDITOR+`.
- Errors: `404 NOTE_NOT_FOUND`, `409 VERSION_CONFLICT` with current note/tombstone in details,
  idempotency/auth errors.

#### `DELETE /api/groups/{groupId}/notes/{noteId}`

- Request JSON: `{ commandId, deviceId, expectedVersion }`; response `200` with tombstone/receipt.
- Role: `EDITOR+`.
- Errors match update. DELETE has a JSON body by contract; MPA client uses method override only at its
  own edge, then calls this REST method.

### Sync manifest

#### `POST /api/sync/manifest`

- Request: `{ deviceId: UUID, knownGroups: [{ groupId: UUID, authorizationRevision: string,
  checkpointCursor?: string }] }`; maximum 500 known groups and 256 KiB.
- Response `200`: `{ groups: ManifestGroup[], purgeGroupIds: UUID[], serverTime: ISODate }`.
- Each accessible group includes role, current authorization revision, latest sequence, minimum
  retained sequence, and `bootstrapRequired` when no supplied checkpoint can be verified within
  current authorization revision/retention. Newly accessible groups also require bootstrap.
- `purgeGroupIds` is the subset of client-known IDs no longer accessible. It contains no server
  metadata for those groups.
- Client must finish purge in one local transaction before any push.
- Errors: auth/MFA, request validation/size. Manifest is required after sign-in, online transition,
  visibility/focus wakeup, WebSocket wakeup, and `AUTHORIZATION_CHANGED`.

### Sync bootstrap

#### `GET /api/groups/{groupId}/sync/bootstrap`

- Request query: optional signed bootstrap cursor.
- First page captures current group change high-water. Pages keyset by note UUID while retaining that
  high-water in cursor.
- Response `200`: `{ items: Note[], nextCursor: string|null, pullCursor: string|null,
  authorizationRevision: string }`.
- At most 500 items/1 MiB. Final page includes a pull checkpoint positioned at captured high-water.
  Client then pulls from it; concurrent writes are thereby reconciled.
- Role: `VIEWER+`.
- Errors: group concealment, `409 AUTHORIZATION_CHANGED`, cursor errors,
  `413 RESPONSE_ITEM_TOO_LARGE`.

### Sync push

#### `POST /api/groups/{groupId}/sync/push`

- Request: `{ protocolVersion:1, deviceId:UUID, authorizationRevision:string,
  commands: SyncCommand[] }`.
- Command: `{ commandId:UUID, name:string, entityId:UUID, expectedVersion:string,
  payload:object }`.
- Response `200`: `{ outcomes: CommandOutcome[], authorizationRevision:string }` in request order.
- Outcome is one of `ACCEPTED`, `REJECTED`, or `CONFLICT`; it includes command ID, receipt hash,
  stable reason code, resulting version when known, and authoritative entity/tombstone for conflict.
- Maximum 100 commands/512 KiB. Commands execute in request order with independent transactions.
- Retry with same `(groupId, commandId)`, actor, device, name, and payload hash returns stored outcome
  without a second mutation. Same ID with a different hash/actor/device returns
  `IDEMPOTENCY_MISMATCH`.
- Authorization is checked before receipt lookup, so revoked users never recover old results.
- Envelope errors: group concealment, auth/MFA, `409 AUTHORIZATION_CHANGED`,
  `400 COMMAND_NOT_ALLOWED`, `413 PAYLOAD_TOO_LARGE`.

### Sync pull

#### `GET /api/groups/{groupId}/sync/pull`

- Request query: optional signed pull checkpoint/page cursor.
- First page fixes `highWaterSequence` to the group's latest committed sequence. All following pages
  return `after < sequence <= highWater` in ascending order.
- Response `200`: `{ changes: Change[], nextCursor:string, hasMore:boolean,
  highWaterSequence:string, authorizationRevision:string }`.
- At most 500 changes/1 MiB. A single oversized change cannot be created because command schemas
  bound payloads below response size.
- Upsert contains complete note projection. Delete contains type, ID, version, and tombstone only.
- Final `nextCursor` is a checkpoint after high-water and can start the next fixed-high-water pull.
- Errors: group concealment, auth/MFA, `409 AUTHORIZATION_CHANGED`, `410 CURSOR_EXPIRED` with
  `{ bootstrapRequired:true }`, invalid/scope cursor errors.

### Stable error codes

- `400`: `INVALID_REQUEST`, `INVALID_CURSOR`, `COMMAND_NOT_ALLOWED`, `BATCH_LIMIT_EXCEEDED`.
- `401`: `AUTH_REQUIRED`, `MFA_REQUIRED`, `SESSION_EXPIRED`.
- `403`: `ROLE_INSUFFICIENT` only for a known current member.
- `404`: `GROUP_NOT_FOUND`, `NOTE_NOT_FOUND`, `INVITATION_NOT_FOUND`.
- `409`: `AUTHORIZATION_CHANGED`, `VERSION_CONFLICT`, `IDEMPOTENCY_MISMATCH`,
  `ID_ALREADY_EXISTS`, `INVITE_EXISTS`, `ALREADY_MEMBER`, `LAST_OWNER`,
  `PERSONAL_GROUP_IMMUTABLE`, `INVITATION_EXPIRED`.
- `410`: `CURSOR_EXPIRED`.
- `413`: `PAYLOAD_TOO_LARGE`, `RESPONSE_ITEM_TOO_LARGE`.
- `422`: `COMMAND_REJECTED`, `USER_NOT_INVITABLE`.
- `429`: `RATE_LIMITED`, with `Retry-After`.
- `500`: `INTERNAL_ERROR`, containing no SQL, stack, payload, or authorization detail.
- `503`: `SERVICE_UNAVAILABLE`; no receipt exists unless transaction committed.

## 6. Sequence diagram

### Signup and personal group

1. SPA/MPA sends password signup to Hono.
2. Auth route validates input and opens one Postgres transaction.
3. Password handler inserts user and credential.
4. Group service inserts one `PERSONAL` group with a server UUID.
5. Group service inserts caller membership as `OWNER`.
6. Session manager inserts session using the same transaction.
7. DB constraints verify one personal group/owner membership.
8. Commit makes all rows visible together; any failure rolls back all rows.
9. API sets signed cookie only after commit and returns user.
10. Post-commit signup notification is auxiliary and cannot change signup result.

### Offline command replay

1. User edits note offline; Dexie atomically stores semantic command and pending overlay.
2. Browser reconnects and sends authenticated manifest before push.
3. Client purges revoked groups; commands for those groups become local rejected drafts.
4. Client sends up to 100 commands for one still-accessible group.
5. API verifies session and configured MFA, then opens transaction for first command.
6. Handler reloads membership/role and authorization revision inside transaction.
7. Registry validates allowlisted command; hasher computes canonical payload hash.
8. Transaction inserts a receipt reservation; a concurrent retry waits, then reads its result.
9. Existing reservation either returns exact stored result or rejects a mismatched reuse.
10. Repository locks note and compares expected version.
11. On success, transaction updates note/version and inserts change, receipt, audit, and outbox.
12. On conflict, transaction completes conflict receipt/audit and returns current state without change.
13. Client records outcomes; conflict payload becomes editable local draft with no auto-merge.
14. Client pulls fixed-high-water pages and replaces pending overlays with authoritative projections.

### Revocation and purge

1. Administrator removes member; transaction increments group authorization revision and audits it.
2. Revoked device may remain offline; server cannot remotely erase its local storage.
3. Device next authenticates and sends manifest with locally known group IDs.
4. Server omits inaccessible group and returns its client-supplied ID in `purgeGroupIds`.
5. Dexie transaction deletes group projection, cursors, membership cache, and queued commands.
6. User-authored rejected payloads move to account-scoped draft vault with group name and
   server-derived data removed.
7. UI stops rendering group before any push/pull starts.
8. A direct stale push also rechecks authorization and returns concealed `GROUP_NOT_FOUND`.

### Access changes on open sockets (spy4x/template#110)

This is what is built; the steps above describe the offline device, this the online one.

1. Every change that alters who may see a group, or what they may do in it, calls
   `recordAccessChange` (`libs/server/groups/group-change-log.ts`) in its own transaction instead
   of `recordGroupChange`. Today that is the delete and the restore; removing a member and changing
   a role (spy4x/template#130) call it too. It stamps the change (sequence and outbox row), raises
   `groups.authorization_revision` by one, and names the users who can no longer see the group
   with `pg_notify` on the `group_access_lost` channel.
2. Postgres delivers a notification sent inside a transaction only when that transaction commits,
   and never when it rolls back. The API therefore hears of a loss only after the change is
   visible: the read the page makes when it gets the hint already misses the group.
3. The API (`Realtime.notifyAccessLoss`) sends each named user's sockets the hint of that change.
   Their page reads again and drops the group. The socket stays open.
4. Every other hint for the group goes to `listMemberUserIds`, read from the database for each
   hint: the members of a group that is not deleted. Someone who lost access is no longer in it,
   so they get no further hints. A hint for an earlier change that the worker sends after the loss
   does not reach them either.
5. A restore names nobody: the members get the group back, and the restore's own hint reaches them
   through the outbox like any change.

Edge cases. The member whose only group was deleted gets a new group named "Personal" in the same
transaction; that group is created at revision 1 and its creation hint reaches them, so nothing
else is needed. The purge removes groups whose members lost access at the delete, 30 days before;
it bumps nothing and names nobody. A demoted member who may still read the group has not lost
access: they keep its hints, and every request is checked against their new role.

**Decision: keep the socket, stop hinting.** ADR 002 allows closing a socket that is no longer
entitled. A socket here belongs to a person, not to a group: it serves their other groups, their
profile and their devices, and every request on it is authorized again from the database. Closing
it would cost the person a reconnect and a full read for every group change elsewhere, and would
tell them nothing a hint does not. What the socket must not do is carry news of a group the person
lost, and resolving every hint's recipients again from the database guarantees that without any
per-socket list that could go stale. Closing stays the answer when the session itself is revoked
(sign-out, expiry, a second factor owed).

What remains possible: a hint already resolved a moment before a loss commits can still go out
after it. It carries only the group id and a sequence, and the read it causes is authorized, so it
shows nothing.

### Fixed-high-water pull and interruption

1. Client sends signed checkpoint after sequence 40.
2. Server authorizes, verifies cursor, and fixes high-water at sequence 900.
3. First page returns ascending changes 41-540 and a signed page cursor for 540/900.
4. Concurrent command commits sequence 901; it is excluded from current page set.
5. Network fails before local commit: client retains checkpoint 40 and safely repeats page.
6. Network fails after atomic local commit: client resumes from signed 540/900 cursor.
7. Final page ends at 900 and returns checkpoint 900 with `hasMore=false`.
8. Next pull fixes a new high-water and includes sequence 901.

## 7. Error handling

### Failure-mode matrix

| Failure mode                            | Detection                           | API/UI surfacing                                 | Recovery                                                                                    | User-facing message                                                      |
| --------------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Missing/expired session                 | Auth middleware/DB validation       | `401 AUTH_REQUIRED` or `SESSION_EXPIRED`         | Pause sync; retain queue; sign in                                                           | “Sign in to continue syncing.”                                           |
| Configured MFA incomplete               | User/session status comparison      | `401 MFA_REQUIRED`                               | Route to TOTP; do not manifest/push/pull                                                    | “Complete MFA to access groups.”                                         |
| Revoked/unknown group                   | Fresh membership lookup             | Concealed `404 GROUP_NOT_FOUND`                  | Run manifest; purge local group                                                             | “Access to this group is no longer available.”                           |
| Role downgraded                         | Transactional role policy           | `403 ROLE_INSUFFICIENT` or per-command rejection | Keep editable local draft; refresh manifest                                                 | “Current role cannot apply this change.”                                 |
| Authorization revision changed          | Request/cursor revision mismatch    | `409 AUTHORIZATION_CHANGED`                      | Manifest before retry                                                                       | “Group access changed. Refreshing permissions.”                          |
| Unknown command                         | Registry miss                       | `400 COMMAND_NOT_ALLOWED`                        | Mark rejected; developer fixes client/version                                               | “This change is not supported by this app version.”                      |
| Invalid payload                         | Strict schema/size validation       | `400 INVALID_REQUEST` or per-command rejection   | Keep draft; focus invalid field                                                             | Specific safe validation message                                         |
| Duplicate exact command                 | Receipt/hash match after auth       | Original stable outcome                          | Continue pull; no mutation                                                                  | Existing status, no duplicate warning                                    |
| Reused command ID with different intent | Receipt/hash/actor/device mismatch  | `409 IDEMPOTENCY_MISMATCH`                       | Quarantine command; create new ID only after review                                         | “Local change ID is inconsistent. Review before retry.”                  |
| Stale expected version                  | Locked row/version comparison       | `CONFLICT` outcome with current entity/tombstone | Preserve local draft; explicit retry/discard                                                | “Newer server version exists. Compare and choose.”                       |
| Deleted entity                          | Current tombstone/version           | `NOTE_NOT_FOUND` or conflict tombstone           | Preserve draft; allow copy to a new note                                                    | “Note was deleted on server. Save content as a new note or discard.”     |
| Request too large                       | Header/stream byte counter          | `413 PAYLOAD_TOO_LARGE`                          | Split batch below both limits                                                               | “Too many changes at once. Sync will retry in smaller batches.”          |
| Cursor invalid/tampered                 | HMAC, scope, protocol checks        | `400 INVALID_CURSOR`                             | Discard cursor; bootstrap                                                                   | “Local sync checkpoint is invalid. Rebuilding local data.”               |
| Cursor older than retention             | Min retained sequence               | `410 CURSOR_EXPIRED`                             | Bootstrap then pull                                                                         | “Local data is outdated. Rebuilding from server.”                        |
| Network interruption                    | Fetch timeout/error                 | Local offline/pending state                      | Exponential retry with jitter; online/focus wakeup                                          | “Offline. Changes remain on this device.”                                |
| DB transaction failure                  | Postgres exception/commit result    | `503` or `500`; no success receipt               | Retry same command ID; receipt resolves uncertain commit                                    | “Server unavailable. Change remains pending.”                            |
| Response lost after commit              | Client timeout then retry           | Stored receipt returns accepted outcome          | Pull authoritative change                                                                   | “Sync interrupted. Verifying saved change.”                              |
| Dexie quota/corruption                  | IndexedDB exception/invariant check | Blocking local-storage status                    | Export is unavailable; preserve draft when possible, reset and bootstrap after confirmation | “Local storage failed. Rebuild local data to continue.”                  |
| Outbox consumer failure                 | Worker attempt/error code           | Metrics/logs only; command remains accepted      | Backoff retry, dead-letter alert after threshold                                            | No primary-flow error                                                    |
| WebSocket unavailable                   | Socket close/error                  | Optional connectivity indicator                  | Timer/focus/online REST sync continues                                                      | No correctness warning                                                   |
| Sign-out/account switch cleanup failure | Dexie transaction rejection         | Block transition and rendering                   | Retry clear; offer site-data reset                                                          | “Could not clear local account data. Reset local data before switching.” |

### Transaction and batch rules

- Each push command is independently atomic. Batch response preserves input order and mixed
  outcomes; HTTP `200` means envelope processed, not every command accepted.
- Commands for the same entity execute in batch order, so a later command may use the version
  produced by an earlier accepted command.
- Unexpected error aborts only current command transaction. Remaining commands continue unless DB
  is unavailable; then unprocessed commands receive no receipt and remain pending.
- Audit is required for accepted, rejected, conflict, and authenticated unauthorized attempts. If
  DB is unavailable, structured application logging is best-effort and must not claim durable audit.
- Accepted command success is returned only after aggregate, change, receipt, audit, and outbox
  commit. Optional event publishing occurs afterward and is fail-open.

### Client conflict and rejected-draft rules

All mutable notes fields are sensitive by default. UI shows local editable payload beside current
server state, never field-level auto-merge. “Retry” creates a new command with a new UUID and current
expected version after explicit user action. “Discard” removes draft and pending overlay. “Save as
new” creates a new note UUID. Revocation purges all server-derived group data; only user-authored
payload may survive in the local draft vault, detached from group name, member data, cursors, and
authoritative content. Drafts disappear on sign-out/account switch.

## 8. Testing approach

All tests are deterministic: fixed clocks, seeded UUIDs, controlled cursor keys, explicit DB
transactions, no shared mutable fixtures, and cleanup after each test. Randomized/property cases use
recorded seeds. Unit tests remain colocated for new libraries; integration and e2e tasks follow
repository Deno conventions (`deno.jsonc:45-64`).

### Unit tests — MUST

- Enum values exactly match group kinds, roles, invitation states, command outcomes, and operations.
- Role matrix covers every actor/target/next-role combination, personal-group restrictions, and
  last-owner invariant.
- Configured MFA requires completed session; unconfigured MFA accepts current session.
- Semantic registry rejects unknown and duplicate commands and contains no notes registration in a
  platform-only fixture.
- Canonical hash fixtures prove object-key order independence, Unicode stability, decimal-string
  versions, array order sensitivity, device/name/expected-version binding, and payload mismatch.
- Cursor fixtures prove signature, key rotation, group scope, purpose, revision, expiry, malformed
  base64, and payload tampering.
- Batch limiter enforces 100/512 KiB exactly at and one byte/item over boundaries.
- Response pager enforces 500/1 MiB without reordering or dropping an item.
- Note aggregate validates bounds and increments version exactly once per accepted mutation.
- Conflict draft flow never merges title/body and creates a fresh command ID on explicit retry.
- Signals reflect Dexie state but cannot mark pending payload as authoritative.
- Notes-removal fixture runs platform sync unit suite without importing `libs/domain/notes`.

### Integration tests — MUST

- Signup creates user/key/session/personal group/owner atomically; injected failure at every insert
  leaves zero partial rows. Concurrent duplicate signup creates no duplicate personal group.
- Backfill gives every existing active user exactly one personal group and is rerun-safe.
- Every group/note/sync repository rejects or returns nothing for a foreign-group user. Tests inspect
  behavior with identical entity UUIDs in two groups where schema permits fixtures.
- Shared-group create atomically creates owner. Invitation acceptance and membership/authorization
  revision update are atomic.
- Concurrent attempts to remove/demote owners cannot leave a shared group ownerless.
- One hundred exact retries of each accepted notes command produce one aggregate version/change/
  outbox effect and one accepted receipt.
- Same command ID with changed payload, actor, device, command name, or expected version returns
  idempotency mismatch.
- Accepted command retried after revocation is denied before receipt disclosure.
- Two concurrent updates with one expected version yield exactly one acceptance and one conflict.
- Accepted transaction contains note, ordered change, receipt, audit, and outbox; failure injection
  at each write rolls all back.
- Mixed batch outcomes preserve order and independently commit accepted commands.
- Pull pages hold fixed high-water during concurrent writes, resume at every boundary, contain no
  duplicate/omitted sequence, and defer post-high-water writes.
- Delete emits content-free tombstone. Bootstrap followed by pull converges under concurrent create,
  update, and delete.
- Retention boundary returns incremental pages at minimum sequence and `410` below it; cleanup never
  removes unprocessed outbox or accepted receipts.
- Manifest returns all current groups and only client-known revoked IDs, then revision changes force
  refresh.
- Direct REST and sync commands dispatch the same CQRS rule and produce equivalent receipts/changes.
- No query relies on RLS; app DB role with RLS disabled still passes tenant-isolation suite.

### End-to-end tests — MUST

- Personal journey: 20 note actions survive offline reload, reconnect, replay, and convergence over
  20 deterministic runs with no loss/duplication.
- Authorized shared journey: two users exchange 100 ordered changes and converge over 20 runs.
- Revocation journey: 20 offline actions are rejected; next authenticated manifest removes all
  projection/cursor/member data before render or push; detached local drafts remain; sign-out clears
  them.
- Conflict journey: 20 stale edits never overwrite server state; each offers compare, edit, retry,
  save-as-new, and discard.
- Response-loss journey interrupts before/after every push receipt and pull Dexie commit boundary.
- Account-switch journey exposes zero content or drafts from prior account.
- MPA and SPA perform equivalent note CRUD with matching authorization and final state.
- Disable WebSocket for entire suite; polling/focus/reconnect still converges. Separate smoke test may
  verify wakeup behavior.
- Install PWA, load once, disable network, reload shell, read synchronized notes, queue edits, then
  reconnect.
- WCAG 2.2 AA automation plus keyboard/screen-reader manual checklist covers all notes journeys and
  conflict/rejection statuses.
- Run supported-browser matrix on current and previous two majors of Chromium, Firefox, and Safari.
  If CI cannot install a historical Safari major, run that lane on pinned macOS runners; no browser
  claim is made without execution evidence.
- Remove notes routes/domain/repository/UI registration and verify all generic platform checks,
  signup, groups, auth, manifest, cursor, and empty-sync tests still pass.

### Performance and security acceptance — MUST

- Reference profile: one API instance and Postgres 16 on a 4-vCPU/8-GiB host, 50 concurrent sync
  users, 100 ms RTT, 10 Mbps downstream/2 Mbps upstream, average note change 2 KiB, warm schema but
  cold per-test app caches.
- Measure 100 server changes plus 20 queued commands end-to-end at p95 <=5 seconds across at least
  100 measured runs after 10 warmups. Report hardware, Deno/Postgres/browser versions, and raw
  percentiles.
- Security suite fuzzes UUIDs/cursors/unknown fields, cross-group IDs, missing Origin, role changes,
  MFA states, oversized streaming bodies, and error-envelope disclosure. Target is zero unauthorized
  note disclosures.
- Query plans for group list, manifest, note list, change pull, receipt lookup, invitation list, and
  outbox claim must use declared indexes at representative cardinality.

### Nice-to-have tests

- Soak 24 hours of outbox retries and periodic sync wakeups.
- Browser storage-pressure simulation beyond deterministic quota failure.
- Property test thousands of random command interleavings beyond fixed acceptance seeds.
- Optional WebSocket latency comparison. It cannot gate correctness release.

### Mocking strategy

Unit tests use in-memory interface fakes, fixed clock/UUID providers, and deterministic Web Crypto
keys; they do not mock private implementation methods. Repository integration tests use disposable
Postgres schemas and the real migration path. Client integration tests use a real IndexedDB
implementation in browser contexts rather than a behaviorally incomplete map. E2E uses real Hono,
Postgres, browser service worker, and Dexie; only network timing/failure and optional external
outbox consumers are controlled. External notification handlers use contract fakes and fail-open
assertions.

## 9. Tradeoffs

Option A: Application-enforced tenant scoping without RLS. Pros: matches v1 resolution, simpler
migration, explicit repository behavior, easier template adoption. Cons: one omitted predicate can
leak data. Rejected because RLS v1 would duplicate authorization policy and expand migration/ops
scope; mandatory scoped signatures and isolation tests provide v1 control.

Option A: REST manifest/push/pull as correctness path. Pros: resumable, testable, proxy-friendly,
works without persistent connections. Cons: polling latency and extra requests. Rejected because
WebSocket-only sync cannot guarantee recovery and conflicts with no persistent-connection goal.

Option A: Current-state tables plus ordered change log. Pros: simple reads, bounded domain model,
easy bootstrap, clear deletion semantics. Cons: mutation writes extra change rows. Rejected because
event sourcing adds replay/projection/versioning complexity not needed by v1.

Option A: Server-authoritative expected-version rejection. Pros: deterministic, auditable, never
silently overwrites. Cons: user must reconcile stale edits. Rejected because automatic merge of
sensitive fields can combine intent incorrectly; editable local drafts preserve work safely.

Option A: Per-command transactions inside ordered batches. Pros: mixed outcomes, simple retries,
small lock scope, accepted siblings survive one rejection. Cons: more DB round trips than one batch
transaction. Rejected because all-or-nothing batches make one stale command block unrelated work and
complicate interruption recovery.

Option A: Per-group monotonically increasing sequence with signed fixed-high-water cursors. Pros:
stable pagination, tenant-local indexes, safe resume, no client cursor forgery. Cons: group-row
sequence allocation serializes writes within one group. Rejected because timestamps are not a total
order and global sequence increases cross-tenant coupling; v1 group write load accepts one short
row lock.

Option A: Complete projection payload in each upsert change. Pros: client applies idempotent upsert
without domain reducers or missing patches. Cons: larger feed. Rejected because patch feeds couple
clients to prior local state and make missed-page recovery fragile; 1 MiB paging and note bounds
control size.

Option A: Accepted receipts retained for group lifetime. Pros: accepted command can never apply
twice after ordinary retry delay. Cons: storage grows with commands. Rejected because expiring all
receipts weakens the explicit no-duplicate guarantee; compact receipt rows and group lifecycle bound
storage.

Option A: Dexie for browser persistence. Pros: mandated stack, transactions, indexes, migrations,
maintained browser compatibility. Cons: one npm ecosystem dependency and bundle cost. Rejected
because raw IndexedDB requires substantial error-prone transaction/migration code; other wrappers
offer no clear maintenance or size advantage.

Option A: Existing cookie session with strict configured-MFA completion. Pros: reuses proven auth,
minimal migration, server-side revocation. Cons: requires same-origin CSRF controls and cookie-aware
clients. Rejected because introducing tokens/OAuth in sync scope adds new credential lifecycle with
no v1 benefit.

Option A: Multiple shared-group owners with last-owner protection. Pros: avoids single-owner lockout,
supports explicit transfer by promotion/demotion. Cons: more role-transition concurrency tests.
Rejected because exactly one owner creates avoidable recovery risk and requires a special transfer
operation.

Option A: Purge at next authenticated manifest. Pros: deterministic before replay, works through
ordinary REST, removes known revoked data promptly on reconnect. Cons: no remote erasure while
device is offline. Rejected because claiming immediate remote deletion is technically impossible;
documentation and sign-out/account-switch clearing define honest limits.

## 10. Open questions

No blocking v1 architecture questions remain. Defaults below are operative until changed by a new
ADR or adopter configuration; implementation can proceed without unresolved decisions.

1. **Production retention beyond defaults.** Default is 30-day changes/tombstones, 90-day rejected
   receipts, group-lifetime accepted receipts, 365-day audits, and 30-day processed outbox. Proposed
   next step: validate storage growth after first two adopters, then either keep defaults or record a
   new ADR. Owner: platform maintainer.
2. **Deployment-specific data residency.** Architecture is region-neutral; adopter chooses one
   Postgres region and documents backups before production. Proposed next step: add deployment ADR
   during adopter discovery. Owner: adopter architecture owner.
3. **Future data export/account/group deletion.** Explicitly outside v1; local rejected/conflict
   drafts are preserved only on the same signed-in device. Proposed next step: product/legal PRD
   before adding retention exceptions or destructive endpoints. Owner: product owner.
4. **Promotion to JSR.** No sync/group package is published in Stage 1. Proposed next step: compare
   APIs after two independent applications and two stable releases, then extract only unchanged
   platform pieces. Owner: platform maintainer.

Implementation order: build DB migrations/repositories and auth-integrated groups first; build sync
protocol, notes acceptance aggregate, clients, and worker second.
