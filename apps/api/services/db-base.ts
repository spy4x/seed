import type postgres from "postgres"
import type { AttachmentUploadBudget } from "@domain/notes"
import {
  anyPicture,
  readablePicture,
  setUserPicture,
  type StoredPicture,
} from "@server/auth/profile-pictures.ts"
import { type LedgerUpload, reserveUpload, settleUpload } from "@server/files/upload-ledger.ts"
import { DbServiceBase, type RowCache, type Sql } from "@spy4x/server/db"
import type { AuthSessionRecord, AuthStore } from "@spy4x/server/auth"
import { createPostgresAuthStore, createPostgresSessionStore } from "@spy4x/server/auth/postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import type { SessionStore } from "@spy4x/server/sign-in"
import {
  type AccountDeletionBlocker,
  type AdminAuditFilter,
  type AdminUserFilter,
  type AuthAuditBase,
  type OnboardingMark,
  type OnboardingStatus,
  type PreferencesDevice,
  type User,
  type UserBase,
  UserMFAStatus,
  type UserRole,
} from "@domain/identity"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresNotificationRepository } from "@server/notifications/postgres-notification-repository.ts"
import { PostgresGroupActivityRepository } from "@server/groups/postgres-activity-repository.ts"
import { PostgresGroupDataMover } from "@server/groups/postgres-group-data-mover.ts"
import { revokeAllInvitationsOf } from "@server/groups/invitation-revocation.ts"
import type { MovableAggregate } from "@server/groups/movable.ts"
import type { PortableAggregate } from "@server/groups/portable.ts"
import { PostgresGroupPorter } from "@server/groups/postgres-group-porter.ts"
import { notePortable } from "@server/notes/note-portable.ts"
import { tagPortable } from "@server/tags/tag-portable.ts"
import { noteMovable } from "@server/notes/note-movable.ts"
import { tagMovable } from "@server/tags/tag-movable.ts"
import { PostgresTagRepository } from "@server/tags/postgres-tag-repository.ts"
import { PostgresAttachmentRepository } from "@server/notes/postgres-attachment-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { PostgresNoteOverview } from "@server/notes/note-overview.ts"
import { PostgresBillingRepository } from "@server/billing/postgres-billing-repository.ts"
import { emailChanges } from "@server/auth/email-verification.ts"
import type { Lockout } from "@spy4x/server/lockout"
import { createPasswordCheckFailures } from "./password-locked.ts"
import { signUpRequests } from "@server/auth/sign-up-requests.ts"
import { signInLinkRequests } from "@server/auth/sign-in-links.ts"
import { enqueueSignInLinkMail } from "@server/jobs/sign-in-link-mail.ts"
import { enqueueSignUpCodeMail } from "@server/jobs/sign-up-code-mail.ts"
import {
  accountDeletionBlockers,
  cancelAccountDeletion,
  isAccountDeletionWaiting,
  lockAccountForDeletion,
  recordAccountDeletion,
} from "@server/auth/account-deletion.ts"
import {
  scheduleAccountDeletionJobs,
  scheduleAccountRestoredMail,
} from "@server/jobs/account-deletion.ts"
import { scheduleStarterData } from "@server/jobs/starter-data.ts"
import { enqueueApiTokenCreatedMail } from "@server/jobs/api-token-mail.ts"
import {
  scheduleSignInMethodMail,
  type SignInMethodChange,
} from "@server/jobs/sign-in-method-mail.ts"
import { touchUserSeen } from "@server/auth/sessions.ts"
import {
  createGuestIdentity,
  deleteGuest,
  dropGuestSwitch,
  findGuestSwitch,
  guestHoldings,
  guestStats,
  type GuestSwitch,
  isGuestUser,
  keepGuest,
  moveGuestGroups,
  recordGuestEvent,
  remindGuest,
  renewGuestSession,
  saveGuestSwitch,
} from "@server/auth/guests.ts"
import type { GuestEventKind, GuestReminderKind } from "@domain/identity"
import {
  findPasskey,
  insertPasskey,
  listPasskeys,
  type NewPasskey,
  passkeyDescriptors,
  type PasskeySummary,
  recordPasskeyUse,
  renamePasskey,
  type StoredPasskey,
} from "@server/auth/passkeys.ts"
import { markOnboarding, readOnboarding } from "@server/auth/onboarding.ts"
import { preferencesStore, recordFirstDevice } from "@server/auth/preferences.ts"
import { type ApiTokenRows, apiTokenRows } from "@server/api-tokens/api-tokens.ts"
import { enqueuePasswordResetMail } from "@server/jobs/password-reset-mail.ts"
import {
  exportAdminUsers,
  isUserBlocked,
  listAdminUsers,
  lockAdminTarget,
  readAdminUser,
  readAdminUserParts,
  readPasswordResetAddress,
  setUserBlocked,
  setUserRole,
  setUserRoleByAddress,
} from "@server/auth/admin-users.ts"
import { readAdminStats } from "@server/auth/admin-stats.ts"
import { type TelegramLinks, telegramLinks } from "@server/auth/telegram.ts"
import { removeAllPushTokensOf } from "./push-token-store.ts"
import { adminGroupRows } from "@server/groups/admin-groups.ts"
import {
  listAdminApiTokens,
  listAdminUserApiTokens,
  readApiTokenOwner,
} from "@server/api-tokens/admin-api-tokens.ts"
import {
  listAdminNotifications,
  listAdminPushDevices,
  removeAdminPushDevice,
} from "@server/notifications/admin-api-tokens.ts"
import type { AdminApiTokenFilter } from "@domain/api-tokens"
import {
  type AdminAuditPageKey,
  listAdminAudit,
  listAdminAuditOperators,
  recordAuditExport,
} from "@server/auth/admin-audit.ts"
import {
  readDatabaseFacts,
  readLastBackup,
  readMigrations,
  readQueueCounts,
} from "@server/jobs/admin-system.ts"
import {
  type AdminJobMatch,
  cancelJob,
  listJobs,
  readJob,
  readJobGroup,
  readJobUser,
  readRepeatingRuns,
  retryFailedJobs,
  retryJob,
  runJobNow,
  runRepeatingNow,
} from "@server/jobs/admin-jobs.ts"
import type { AdminJobFilter } from "@domain/identity"

/** A user's authenticator-app enrolment, one row of `user_totp`. */
export interface UserTotp {
  userId: number
  /** Base32 secret from `generateTotpSecret`. */
  secret: string
  /** `null` while enrolment is not finished. */
  confirmedAt: Date | null
  /** Time step of the last accepted code, or `null` when none was accepted yet. */
  lastAcceptedStep: number | null
}

/**
 * The aggregates "move all of a group's data" moves, in the order it moves them. A new aggregate
 * joins here (`docs/aggregates.md`, "Making an aggregate movable"): put one that other aggregates
 * point at before the ones that point at it.
 */
export const MOVABLE_AGGREGATES: readonly MovableAggregate[] = [tagMovable, noteMovable]

/**
 * The aggregates a group's export file holds, in the order an import writes them. A new aggregate
 * joins here (`docs/aggregates.md`, "Making an aggregate exportable"): put one that other
 * aggregates point at before the ones that point at it.
 */
export const PORTABLE_AGGREGATES: readonly PortableAggregate[] = [tagPortable, notePortable]

/** A cache that stores nothing: every read goes to the database. */
const noCache: RowCache<User> = {
  wrap: (_key, compute) => compute(),
  set: () => Promise.resolve(),
  delete: () => Promise.resolve(),
}

/** Options for {@link AppDbBase}. */
export interface AppDbBaseOptions {
  sql: Sql
  /**
   * Cache for `users` rows, read only through `user.findOneCached` (display data). Defaults to
   * none. Nothing that decides authentication or a role reads it: see `user.findOne`.
   */
  userCache?: RowCache<User>
}

/**
 * The part of `DbService` that needs nothing but a `sql` client and an optional user cache - no
 * config, no `Deno.env` read. Split out so the integration tests can construct the exact class
 * `apps/api/services/db.ts` uses for `db.group`, `db.user` and the sign-in stores, instead of a
 * lookalike copy that only guards itself: a copy caught nothing when a reviewer cached `group` in
 * the real `DbService` and left the test's own `TestDb` untouched.
 */
export class AppDbBase extends DbServiceBase {
  /**
   * Not a `#private` field: `begin()` hands its callback an `Object.create(this)` clone, and a
   * `#private` field cannot be read through a clone's prototype chain.
   */
  private readonly userCache: RowCache<User>

  constructor(options: AppDbBaseOptions) {
    super({ sql: options.sql })
    this.userCache = options.userCache ?? noCache
  }

  /**
   * Built per access on purpose. `DbServiceBase.begin()` derives the transactional
   * service with `Object.create(this)` and rebinds `sql`, so a cached repository
   * would keep the pool connection and silently escape the transaction.
   */
  get group(): PostgresGroupRepository {
    return new PostgresGroupRepository(this.sql)
  }

  /** Revokes every pending invitation a person made (#411). Built per access, like `group`. */
  get invitationRevocation() {
    const sql = this.sql
    return {
      allOf: (creatorId: number): Promise<number> => revokeAllInvitationsOf(sql, creatorId),
    }
  }

  /**
   * A person's stored push subscriptions (#409). Built per access, like `group`, so a reset's
   * transaction removes them inside it.
   */
  get pushTokens() {
    const sql = this.sql
    return {
      removeAllOf: (userId: number): Promise<void> => removeAllPushTokensOf(sql, userId),
    }
  }

  /** The read side of a group's activity log. Built per access, like `group`. */
  get groupActivity(): PostgresGroupActivityRepository {
    return new PostgresGroupActivityRepository(this.sql)
  }

  /** A person's inbox. Built per access, like `group`. */
  get notification(): PostgresNotificationRepository {
    return new PostgresNotificationRepository(this.sql)
  }

  /** Moves all of a group's data to another group. Built per access, like `group`. */
  get groupData(): PostgresGroupDataMover {
    return new PostgresGroupDataMover(this.sql, MOVABLE_AGGREGATES)
  }

  /** A group's export file and the import of one. Built per access, like `group`. */
  get groupFiles(): PostgresGroupPorter {
    return new PostgresGroupPorter(this.sql, PORTABLE_AGGREGATES)
  }

  /** The notes repository. Built per access, like `group`, so inside `begin()` it uses the transaction. */
  get note(): PostgresNoteRepository {
    return new PostgresNoteRepository(this.sql)
  }

  /** The numbers behind the notes' overview widgets. Built per access, like `note`. */
  get noteOverview(): PostgresNoteOverview {
    return new PostgresNoteOverview(this.sql)
  }

  /** The tags repository. Built per access, like `note`. */
  get tag(): PostgresTagRepository {
    return new PostgresTagRepository(this.sql)
  }

  get attachment(): PostgresAttachmentRepository {
    return new PostgresAttachmentRepository(this.sql)
  }

  /** Each group's subscription and customer. Built per access, like `group`. */
  get billing(): PostgresBillingRepository {
    return new PostgresBillingRepository(this.sql)
  }

  /**
   * The `@spy4x/server` auth store over `auth_users` and `auth_keys`. Built per access, like
   * `group`, so inside `begin()` it writes through the transaction: given a transaction handle, the
   * store runs its multi-statement writes in a savepoint of it (spy4x/ts-libs#161).
   */
  get authStore(): AuthStore {
    return createPostgresAuthStore(this.sql)
  }

  /**
   * The `@spy4x/server` session store over `auth_sessions`: sessions, what the devices list shows
   * about them, and ending them. Built per access, like `group`, so inside `begin()` it writes
   * through the transaction.
   */
  get sessionStore(): Required<SessionStore<AuthSessionRecord>> {
    return createPostgresSessionStore(this.sql)
  }

  /**
   * When each person was last active (`users.last_seen_at`, `@server/auth/sessions.ts`). Built per
   * access, like `group`.
   */
  get userSeen() {
    const sql = this.sql
    return {
      /** Records that the user was active at `now`, at most every five minutes. */
      touch: (userId: number, now?: Date) => touchUserSeen(sql, userId, now),
    }
  }

  /**
   * Personal API tokens (`@server/api-tokens/api-tokens.ts`). Built per access, like `group`, so
   * inside `begin()` a create and its audit row share the transaction.
   */
  get apiTokens(): ApiTokenRows {
    return apiTokenRows(this.sql)
  }

  /**
   * The mail that tells a person a token was created (`@server/jobs/api-token-mail.ts`). Built per
   * access, like `group`: `queue` belongs inside the create's `begin()`.
   */
  get apiTokenMail() {
    const sql = this.sql
    return {
      /** Queues the worker job that mails the owner of token `tokenId`. */
      queue: (tokenId: string): Promise<void> => enqueueApiTokenCreatedMail(sql, tokenId),
    }
  }

  /**
   * The mail that tells a person a sign-in method was linked or unlinked
   * (`@server/jobs/sign-in-method-mail.ts`). Built per access, like `group`: `queue` belongs inside
   * the change's `begin()`, beside its audit row.
   */
  /** The passkey part of `passkey` keys (#222). Built per access, like `group`. */
  get passkeys() {
    const sql = this.sql
    return {
      insert: (passkey: NewPasskey): Promise<void> => insertPasskey(sql, passkey),
      list: (userId: number): Promise<PasskeySummary[]> => listPasskeys(sql, userId),
      descriptors: (userId: number) => passkeyDescriptors(sql, userId),
      find: (credentialId: string): Promise<StoredPasskey | null> => findPasskey(sql, credentialId),
      recordUse: (keyId: number, use: { counter: number; backedUp: boolean }): Promise<void> =>
        recordPasskeyUse(sql, keyId, use),
      rename: (userId: number, keyId: number, name: string): Promise<string | null> =>
        renamePasskey(sql, userId, keyId, name),
    }
  }

  get signInMethodMail() {
    const sql = this.sql
    return {
      /** Records the change of `method` on user `userId` and queues the worker job that mails it. */
      queue: (userId: number, change: SignInMethodChange, method: string): Promise<void> =>
        scheduleSignInMethodMail(sql, userId, change, method),
    }
  }

  /**
   * Locks the user's row until the transaction ends. A token create, a password change and a
   * password reset all take it (#293), so a create cannot commit a token made with the old
   * password after the change revoked the others. Inside `begin()` only.
   */
  async lockUser(userId: number): Promise<void> {
    await this.sql`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`
  }

  /**
   * Locks a password key until the transaction ends: the user's, or the one whose subject is the
   * address. A password reset and an address move both take this lock first, so one waits for the
   * other and neither copies a password hash the other is replacing (#140). Inside `begin()` only.
   */
  async lockPasswordKey(where: { userId: number } | { subject: string }): Promise<void> {
    if ("userId" in where) {
      await this.sql`
        SELECT 1 FROM auth_keys
        WHERE method = ${PASSWORD_METHOD} AND user_id = ${where.userId}
        FOR UPDATE
      `
    } else {
      await this.sql`
        SELECT 1 FROM auth_keys
        WHERE method = ${PASSWORD_METHOD} AND subject = ${where.subject}
        FOR UPDATE
      `
    }
  }

  /**
   * The `auth_audits` rows. Built per access, like `group`: each row is written inside the
   * transaction of the action it records, so the action and its row are kept or undone together.
   */
  get authAudit() {
    const sql = this.sql
    return {
      /**
       * Writes one row. The client sends the IP and the user agent, so both are cut to their
       * column width: a long header must never fail the action the row records.
       */
      insert: async (row: AuthAuditBase): Promise<void> => {
        const ip = row.ip?.slice(0, 45) ?? null
        const userAgent = row.userAgent?.slice(0, 300) ?? null
        await sql`
          INSERT INTO auth_audits (user_id, event_type, identifier, ip, user_agent)
          VALUES (${row.userId}, ${row.eventType}, ${row.identifier}, ${ip}, ${userAgent})
        `
      },
    }
  }

  /**
   * Queues the starter data a new account is owed (`@server/jobs/starter-data.ts`). Built per
   * access, like `group`: `queue` belongs inside the sign-up's `begin()`.
   */
  get starterData() {
    const sql = this.sql
    return {
      /** Writes the marker row and queues the worker job that creates the welcome note. */
      queue: (userId: number): Promise<void> => scheduleStarterData(sql, userId),
    }
  }

  /**
   * Deleting one's own account (`@server/auth/account-deletion.ts`). Built per access, like
   * `group`: `lock`, `request` and `cancel` belong inside `begin()`.
   */
  get accountDeletion() {
    const sql = this.sql
    return {
      /** The groups that stop the user from deleting their account. */
      blockers: (userId: number): Promise<AccountDeletionBlocker[]> =>
        accountDeletionBlockers(sql, userId),
      /** Locks the live user row and their groups; `false` when the user is not live. */
      lock: (userId: number): Promise<boolean> => lockAccountForDeletion(sql, userId),
      /** Writes the waiting request and queues its mail and its delete for good. */
      request: async (userId: number) => {
        const request = await recordAccountDeletion(sql, userId)
        await scheduleAccountDeletionJobs(sql, request)
        return request
      },
      /** Removes the waiting request; `true` when there was one. */
      cancel: (userId: number): Promise<boolean> => cancelAccountDeletion(sql, userId),
      /** `true` while the user has a request waiting. */
      waiting: (userId: number): Promise<boolean> => isAccountDeletionWaiting(sql, userId),
      /** Records that a sign-in restored the account and queues the mail that says so. */
      restored: (userId: number): Promise<void> => scheduleAccountRestoredMail(sql, userId),
    }
  }

  /**
   * Guest accounts (#224, `@server/auth/guests.ts`). Built per access, like `group`, so inside
   * `begin()` every write joins the transaction. Keeping a guest also drops the cached `users` row,
   * whose `guestSince` the profile shows.
   */
  get guests() {
    const sql = this.sql
    const cache = this.userCache
    const transaction = () => {
      if (!("savepoint" in sql)) throw new Error("A guest change must run inside begin()")
      return sql as unknown as postgres.TransactionSql
    }
    return {
      createIdentity: () => createGuestIdentity(sql),
      isGuest: (userId: number) => isGuestUser(sql, userId),
      event: (kind: GuestEventKind) => recordGuestEvent(sql, kind),
      keep: async (userId: number, keyId: number, sessionEnd: Date): Promise<boolean> => {
        const kept = await keepGuest(sql, userId, keyId, sessionEnd)
        if (kept) await cache.delete(userId)
        return kept
      },
      renew: (userId: number, sessionId: number, now?: Date) =>
        renewGuestSession(sql, userId, sessionId, now),
      remind: (userId: number, kind: GuestReminderKind) => remindGuest(sql, userId, kind),
      holdings: (userId: number) => guestHoldings(sql, userId),
      saveSwitch: (userId: number, sw: GuestSwitch) => saveGuestSwitch(sql, userId, sw),
      findSwitch: (userId: number) => findGuestSwitch(sql, userId),
      dropSwitch: (userId: number) => dropGuestSwitch(sql, userId),
      moveGroups: (guestId: number, targetId: number) =>
        moveGuestGroups(transaction(), guestId, targetId),
      delete: async (userId: number): Promise<boolean> => {
        const deleted = await deleteGuest(transaction(), userId)
        if (deleted) await cache.delete(userId)
        return deleted
      },
      stats: (since?: Date) => guestStats(sql, since),
    }
  }

  /**
   * The first-steps checklist and the tour (`@server/auth/onboarding.ts`). Built per access, like
   * `group`.
   */
  get onboarding() {
    const sql = this.sql
    return {
      /** What the person has done so far and what they closed, or `null` for no such person. */
      read: (userId: number): Promise<OnboardingStatus | null> => readOnboarding(sql, userId),
      /** Records that the person closed the checklist or ended the tour. */
      mark: (userId: number, mark: OnboardingMark): Promise<void> =>
        markOnboarding(sql, userId, mark),
    }
  }

  /**
   * A person's display preferences (`@server/auth/preferences.ts`, #163). Built per access, like
   * `group`.
   */
  get preferences() {
    const sql = this.sql
    return {
      /** The versioned record, keyed by the person's id; the write is a compare-and-set. */
      store: preferencesStore(sql),
      /** Keeps the first device's zone and region format: the ones the person signed up with. */
      recordFirstDevice: (userId: number, device: PreferencesDevice): Promise<void> =>
        recordFirstDevice(sql, userId, device),
    }
  }

  /**
   * Profile pictures (#228, `@server/auth/profile-pictures.ts`) and their signed uploads in the
   * ledger every feature shares (`@server/files/upload-ledger.ts`). Built per access, like `group`,
   * so inside `begin()` every write joins the transaction. A change of picture also drops the
   * cached `users` row, which the session and the profile show.
   */
  get pictures() {
    const sql = this.sql
    const cache = this.userCache
    return {
      reserve: (upload: LedgerUpload, budget: AttachmentUploadBudget) =>
        reserveUpload(sql, upload, budget),
      claim: (id: string, userId: number) => settleUpload(sql, id, userId, `picture`),
      release: async (id: string, userId: number): Promise<void> => {
        await settleUpload(sql, id, userId, `picture`)
      },
      set: async (userId: number, picture: StoredPicture | null) => {
        const result = await setUserPicture(sql, userId, picture)
        if (result) await cache.delete(userId)
        return result
      },
      readable: (pictureId: string, viewerId: number) => readablePicture(sql, pictureId, viewerId),
      any: (pictureId: string) => anyPicture(sql, pictureId),
    }
  }

  /**
   * The operator area's reads and writes (`@server/auth/admin-users.ts`, #146). Built per access,
   * like `group`: `lockTarget`, `setBlocked` and the audit row of an action share its `begin()`.
   */
  get admin() {
    const sql = this.sql
    return {
      /** One page of the people who are not deleted, newest first, and how many match in all. */
      list: (filter: AdminUserFilter, pageSize: number) => listAdminUsers(sql, filter, pageSize),
      /** The person as the list shows them, or `null` when there is no live one. */
      find: (userId: number) => readAdminUser(sql, userId),
      /** How the person signs in, their groups and their newest audit rows. */
      parts: (userId: number) => readAdminUserParts(sql, userId),
      /** Locks the live person and reads their role and block. Inside `begin()` only. */
      lockTarget: (userId: number) => lockAdminTarget(sql, userId),
      /** Blocks the person as of `at`, or unblocks them with `null`. */
      setBlocked: (userId: number, at: Date | null) => setUserBlocked(sql, userId, at),
      /** Whether the person is blocked, deleted or not. */
      isBlocked: (userId: number) => isUserBlocked(sql, userId),
      /**
       * Gives the person who signs in with `address` the role, with an audit row naming `actor`,
       * and answers their id and former role, or `null`. Outside `begin()`: it opens its own.
       */
      setRoleByAddress: (address: string, role: UserRole, actor: string) =>
        setUserRoleByAddress(sql, address, role, actor),
      /** Gives the live person `userId` the role. Inside the action's `begin()`. */
      setRole: (userId: number, role: UserRole) => setUserRole(sql, userId, role),
      /** The address a reset link for `userId` goes to, or `null` when none can reach them. */
      resetAddress: (userId: number) => readPasswordResetAddress(sql, userId),
      /** Queues the "Forgot password" mail to `email`, in the caller's transaction. */
      queuePasswordReset: (email: string) => enqueuePasswordResetMail(sql, email),
      /** Every person `filter` matches, `batchSize` rows at a time, for the CSV export. */
      export: (filter: AdminUserFilter, batchSize: number) =>
        exportAdminUsers(sql, filter, batchSize),
      /** The dashboard's counts and 30-day series as of `now` (#424). */
      stats: (now: Date) => readAdminStats(sql, now),
    }
  }

  /**
   * Linked Telegram accounts (#269, `@server/auth/telegram.ts`). Built per access, like `group`,
   * so inside `begin()` it uses the transaction.
   */
  get telegram(): TelegramLinks {
    return telegramLinks(this.sql)
  }

  /** The operator area's group reads and actions (`@server/groups/admin-groups.ts`, #426). */
  get adminGroups(): ReturnType<typeof adminGroupRows> {
    return adminGroupRows(this.sql)
  }

  /**
   * The count of wrong passwords a signed-in account types (#406). Only the pool's is used: each
   * update runs in a transaction of its own. Built per access, like `group`.
   */
  get passwordCheckFailures(): Lockout {
    return createPasswordCheckFailures({ sql: this.sql })
  }

  /** The address change waiting for its code. Built per access, like `group`. */
  get emailChange(): ReturnType<typeof emailChanges> {
    return emailChanges(this.sql)
  }

  /**
   * Sign-ups waiting for their code (#142), and the code mails they ask for. Built per access,
   * like `group`, so a transaction's copy writes inside the transaction.
   */
  get signUpRequest() {
    const sql = this.sql
    return {
      ...signUpRequests(sql),
      /** Queues a code mail to the address of the waiting sign-up `id`. */
      queueCode: (id: string): Promise<void> => enqueueSignUpCodeMail(sql, id),
    }
  }

  /** Sign-in links (#391): the requests, and queueing a link's mail. */
  get signInLink() {
    const sql = this.sql
    return {
      ...signInLinkRequests(sql),
      /**
       * Queues a link to `email`, already normalised, that opens `next` after sign-in, asked for
       * by the guest `requestedBy` or by someone with no guest account (`null`).
       */
      queue: (email: string, next: string | null, requestedBy: number | null = null) =>
        enqueueSignInLinkMail(sql, email, next, requestedBy),
    }
  }

  get user() {
    const cache = this.userCache
    const cached = this.buildMethods<User, UserBase, Partial<UserBase>>(`users`, cache)
    const fresh = this.buildMethods<User, UserBase, Partial<UserBase>>(`users`, noCache)
    return {
      ...cached,
      /**
       * One row straight from Postgres. Everything that decides authentication or a role reads
       * through this (`mfa`, `role`): Valkey is a separate service that another process may be able
       * to write to, so what it holds must never decide who is allowed in. It costs one indexed
       * query by primary key per call.
       */
      findOne: fresh.findOne,
      /**
       * The same row through the Valkey cache, up to 30 days old or forged. For display only:
       * never let `mfa` or `role` from this row decide anything.
       */
      findOneCached: cached.findOne,
      /**
       * Turns two-factor off, on a row waiting to be deleted too: `updateOne` skips a deleted row,
       * and a password reset during the wait must still reach it, or no sign-in could restore it.
       * `mfa` from the cache decides nothing (see `findOneCached`), so it is not refreshed here.
       */
      clearSecondFactor: async (id: number): Promise<void> => {
        await this.sql`
          UPDATE users SET mfa = ${UserMFAStatus.NOT_CONFIGURED}, updated_at = now() WHERE id = ${id}
        `
      },
      /** Creates the profile row of a new auth user; `users.id` is the auth user's id. */
      createForAuthUser: (id: number, data: UserBase): Promise<User> =>
        this.createOne<User>(
          cache,
          this.sql<User[]>`
            INSERT INTO users ${this.sql(this.sanitize({ id, ...data }))}
            RETURNING *
          `,
        ),
    }
  }

  get userTotp() {
    const sql = this.sql
    const columns = () =>
      sql`
        user_id AS "userId", secret, confirmed_at AS "confirmedAt",
        last_accepted_step AS "lastAcceptedStep"
      `
    return {
      find: async (userId: number): Promise<UserTotp | null> =>
        (await sql<UserTotp[]>`SELECT ${columns()} FROM user_totp WHERE user_id = ${userId}`)[0] ??
          null,
      /** Starts (or restarts) an unfinished enrolment. Never touches a confirmed one. */
      savePending: async (userId: number, secret: string): Promise<boolean> =>
        (await sql`
          INSERT INTO user_totp (user_id, secret) VALUES (${userId}, ${secret})
          ON CONFLICT (user_id) DO UPDATE
            SET secret = EXCLUDED.secret, last_accepted_step = NULL, updated_at = NOW()
            WHERE user_totp.confirmed_at IS NULL
          RETURNING user_id
        `).length === 1,
      /**
       * Finishes enrolment with the step of the code that proved it. Conditional, so a step that
       * is not later than the last accepted one changes nothing.
       */
      confirm: async (userId: number, step: number): Promise<boolean> =>
        (await sql`
          UPDATE user_totp
          SET confirmed_at = NOW(), last_accepted_step = ${step}, updated_at = NOW()
          WHERE user_id = ${userId} AND confirmed_at IS NULL
            AND (last_accepted_step IS NULL OR last_accepted_step < ${step})
          RETURNING user_id
        `).length === 1,
      /**
       * Records the step of an accepted code on a confirmed enrolment. Conditional, so of two
       * requests carrying the same code only one succeeds.
       */
      acceptStep: async (userId: number, step: number): Promise<boolean> =>
        (await sql`
          UPDATE user_totp SET last_accepted_step = ${step}, updated_at = NOW()
          WHERE user_id = ${userId} AND confirmed_at IS NOT NULL
            AND (last_accepted_step IS NULL OR last_accepted_step < ${step})
          RETURNING user_id
        `).length === 1,
      /** Removes the enrolment, finished or not. */
      remove: async (userId: number): Promise<void> => {
        await sql`DELETE FROM user_totp WHERE user_id = ${userId}`
      },
      deleteConfirmed: async (userId: number): Promise<boolean> =>
        (await sql`
          DELETE FROM user_totp WHERE user_id = ${userId} AND confirmed_at IS NOT NULL
          RETURNING user_id
        `).length === 1,
    }
  }

  /** The operator area's audit log (`@server/auth/admin-audit.ts`, #429). Built per access. */
  get adminAudit() {
    const sql = this.sql
    return {
      /** Up to `limit` entries after `after` that match `filter`, newest first, and the next key. */
      list: (filter: AdminAuditFilter, limit: number, after: AdminAuditPageKey | null) =>
        listAdminAudit(sql, filter, limit, after),
      /** Everyone with the operator role or above, for the operator filter. */
      operators: () => listAdminAuditOperators(sql),
      /** Records that the operator downloaded `rows` entries as a file. */
      recordExport: (operatorId: number, rows: number, requestId: string | null) =>
        recordAuditExport(sql, operatorId, rows, requestId),
    }
  }

  /** The operator area's System page (`@server/jobs/admin-system.ts`, #429). */
  get adminSystem() {
    const sql = this.sql
    return {
      database: () => readDatabaseFacts(sql),
      queue: () => readQueueCounts(sql),
      lastBackup: () => readLastBackup(sql),
      migrations: () => readMigrations(sql),
    }
  }

  /**
   * The operator area's Jobs module (`@server/jobs/admin-jobs.ts`, #394). Built per access, like
   * `group`: each action belongs inside `begin()`, beside its audit row.
   */
  get adminJobs() {
    const sql = this.sql
    return {
      list: (filter: AdminJobFilter, match: AdminJobMatch | null) => listJobs(sql, filter, match),
      job: (id: string) => readJob(sql, id),
      user: (table: string, aggregateId: string) => readJobUser(sql, table, aggregateId),
      group: (groupId: string) => readJobGroup(sql, groupId),
      repeating: (kinds: readonly string[]) => readRepeatingRuns(sql, kinds),
      /** Inside `begin()` only, as every action below. */
      retry: (id: string, operatorId: number, requestId: string | null) =>
        retryJob(sql, id, operatorId, requestId),
      retryAll: (operatorId: number, requestId: string | null, limit: number) =>
        retryFailedJobs(sql, operatorId, requestId, limit),
      runNow: (id: string, operatorId: number, requestId: string | null) =>
        runJobNow(sql, id, operatorId, requestId),
      runRepeatingNow: (kind: string, operatorId: number, requestId: string | null) =>
        runRepeatingNow(sql, kind, operatorId, requestId),
      cancel: (id: string, operatorId: number, requestId: string | null) =>
        cancelJob(sql, id, operatorId, requestId),
    }
  }

  /**
   * The operator area's API tokens, push devices and notifications of people (#427). Built per
   * access, like `group`, so inside `begin()` a remove and its audit row share the transaction.
   */
  get adminApiTokens() {
    const sql = this.sql
    return {
      /** One page of every live person's tokens in the filter's state, with the counts. */
      list: (filter: AdminApiTokenFilter, pageSize: number, now: Date) =>
        listAdminApiTokens(sql, filter, pageSize, now),
      /** The person's newest tokens, revoked and expired ones among them. */
      listForUser: (userId: number, limit: number, now: Date) =>
        listAdminUserApiTokens(sql, userId, limit, now),
      /** Whose the token is, or `null` when there is no such token. */
      owner: (tokenId: string) => readApiTokenOwner(sql, tokenId),
      /** The person's live push devices, without what can push to them. */
      devices: (userId: number) => listAdminPushDevices(sql, userId),
      /** Removes the person's device and answers the devices left, or `null` for no such device. */
      removeDevice: (userId: number, deviceRowId: number) =>
        removeAdminPushDevice(sql, userId, deviceRowId),
      /** The person's newest notifications, kind and read state only, and their counts. */
      notifications: (userId: number, limit: number) => listAdminNotifications(sql, userId, limit),
    }
  }
}
