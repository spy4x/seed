import type { Context } from "hono"
import type { AuthKey, AuthSessionRecord } from "@spy4x/server/auth"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import {
  SecondFactorStatus,
  type SessionCookie,
  type SessionDevice,
  type SessionManager,
  type SessionStore,
} from "@spy4x/server/sign-in"
import { maskEmail } from "@spy4x/platform/universal/text"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  type AccountDeletionBlocker,
  type AuthAuditBase,
  AuthAuditEventType,
  GUEST_DELETE_WORD,
  GUEST_SESSION_DAYS,
  GuestEventKind,
  GuestReminderKind,
  type GuestSwitchBody,
  type GuestSwitchResult,
  type GuestSwitchState,
  type User,
  UserMFAStatus,
  UserRole,
} from "@domain/identity"
import type { AppDbBase } from "./db-base.ts"
import type { AppAuthState, SignedIn } from "./sign-in.ts"

/** Minutes in a guest's session: a year, renewed by every day of use. */
export const GUEST_SESSION_MINUTES = GUEST_SESSION_DAYS * 24 * 60

/** What {@link GuestOperations.start} did. */
export enum GuestStartOutcome {
  /** A new guest account, signed in on this browser. */
  Started = 1,
  /** The request already carries a guest's session: nothing new, the person goes straight in. */
  AlreadyGuest = 2,
  /** The request already carries a full account's session: nothing was created. */
  SignedIn = 3,
  /** Guest mode is off (`GUEST_MODE=false`). */
  Off = 4,
}

/** The answer of {@link GuestOperations.start}. */
export type GuestStart =
  | { outcome: GuestStartOutcome.Started; signedIn: SignedIn }
  | { outcome: GuestStartOutcome.AlreadyGuest | GuestStartOutcome.SignedIn | GuestStartOutcome.Off }

/** What {@link GuestOperations.switchTo} did. */
export enum GuestSwitchOutcome {
  Switched = 1,
  /** No choice waits: it took longer than ten minutes, or none was started. */
  Expired = 2,
  /** That account's password is owed and was wrong or missing. */
  WrongPassword = 3,
  /** That account has an authenticator app and its code was wrong or missing. */
  WrongCode = 4,
  /** That account can no longer be signed in to (blocked, or waiting to be deleted). */
  Unavailable = 5,
  /** A group of the guest's stops the deletion (`AccountDeletionBlocker`); nothing changed. */
  Blocked = 6,
}

/** The answer of {@link GuestOperations.switchTo}. */
export type GuestSwitchAnswer =
  | { outcome: GuestSwitchOutcome.Switched; signedIn: SignedIn; result: GuestSwitchResult }
  | { outcome: GuestSwitchOutcome.Blocked; blockers: AccountDeletionBlocker[] }
  | {
    outcome:
      | GuestSwitchOutcome.Expired
      | GuestSwitchOutcome.WrongPassword
      | GuestSwitchOutcome.WrongCode
      | GuestSwitchOutcome.Unavailable
  }

/** What {@link GuestOperations.deleteAccount} did. */
export type GuestDeleteAnswer =
  | { deleted: true }
  | { deleted: false; reason: "not-guest" | "wrong-word" }
  | { deleted: false; reason: "blocked"; blockers: AccountDeletionBlocker[] }

/**
 * What the other sign-in paths call when a guest adds a sign-in method or finds it taken: the
 * password sign-up's code, a provider link and a new passkey.
 */
export interface GuestKeeper {
  /**
   * Keeps guest `userId` in the transaction `tx` that just added key `keyId` of `method`: the
   * account stops being a guest, this browser stays signed in, and the audit row says so. `false`
   * for a user who is no guest: nothing is written then.
   */
  keep(c: Context, tx: AppDbBase, userId: number, keyId: number, method: string): Promise<boolean>
  /**
   * Remembers, for ten minutes, that guest `guestId` tried to add `key`'s sign-in method, which
   * belongs to another account, so the page "That sign-in belongs to another account" can offer
   * to switch. `needsPassword` when the person still owes that account's password (the e-mail
   * path: a code proved the mailbox, not the account).
   */
  taken(
    guestId: number,
    key: Pick<AuthKey, "id" | "userId" | "method">,
    needsPassword: boolean,
  ): Promise<void>
}

/** What the sign-in hands this module of its own parts. */
export interface GuestInternals {
  db: AppDbBase
  /** Guest mode is on (`GUEST_MODE` is not `false`). */
  enabled: boolean
  sessionsOver(
    store: SessionStore<AuthSessionRecord>,
    minutes?: number,
  ): SessionManager<AuthSessionRecord>
  /** The length of a full account's session, in minutes: a kept guest's sessions shrink to it. */
  sessionMinutes: number
  cookie: SessionCookie
  auditRow(
    c: Context,
    userId: number,
    eventType: AuthAuditEventType,
    identifier?: string | null,
  ): AuthAuditBase
  deviceOf(c: Context): SessionDevice
  /** Checks another account's password under that account's count; throws `PasswordLockedError`. */
  checkPassword(userId: number, password: string): Promise<boolean>
  /** Checks a code of `user`'s authenticator app; a code is never accepted twice. */
  verifyTotpCode(state: { user: User }, code: string): Promise<boolean>
}

/** The guest operations the routes call. */
export interface GuestOperations extends GuestKeeper {
  enabled: boolean
  /**
   * Starts a guest account for a request with no full session (#224): an auth user with only the
   * guest key, a profile marked a guest, the first group and its starter data, a session of a
   * year and the cookie. A request that already carries a session creates nothing.
   */
  start(c: Context, current: AppAuthState | null, firstGroupId?: string): Promise<GuestStart>
  /**
   * Renews a guest's session at most once a day and sends its cookie again, counting the day of
   * use; on the third day, queues the reminder. Called for every request with a session.
   */
  renew(c: Context, state: AppAuthState): Promise<void>
  /** Sends `kind`'s reminder to guest `userId`, once ever. Fails open: a reminder is a nicety. */
  remind(userId: number, kind: GuestReminderKind): Promise<void>
  /** The choice that waits after a taken sign-in method, or `null` when none does. */
  switchState(state: AppAuthState): Promise<GuestSwitchState | null>
  /**
   * Answers that choice: signs the browser in to the other account, after that account's password
   * and code when they are owed, moves the guest's groups there (`move`) or not (`delete`), then
   * deletes the guest. Nothing is moved or deleted before every check passed.
   */
  switchTo(c: Context, state: AppAuthState, body: GuestSwitchBody): Promise<GuestSwitchAnswer>
  /** "Keep the guest account": forgets the choice and changes nothing else. */
  cancelSwitch(state: AppAuthState): Promise<void>
  /**
   * Deletes a guest's account at once, with everything in it, when `word` is
   * {@link GUEST_DELETE_WORD}: a guest has no password to confirm with, and nothing to restore.
   */
  deleteAccount(c: Context, state: AppAuthState, word: string): Promise<GuestDeleteAnswer>
}

/** Builds the guest operations over the sign-in's own parts. */
export function createGuestOperations(own: GuestInternals): GuestOperations {
  const { db } = own
  const sessionEnd = () => new Date(Date.now() + own.sessionMinutes * 60_000)

  const keeper: GuestKeeper = {
    async keep(c, tx, userId, keyId, method) {
      if (!(await tx.guests.keep(userId, keyId, sessionEnd()))) return false
      await tx.authAudit.insert(own.auditRow(c, userId, AuthAuditEventType.GUEST_KEPT, method))
      return true
    },
    async taken(guestId, key, needsPassword) {
      await db.guests.saveSwitch(guestId, {
        targetUserId: key.userId,
        targetKeyId: key.id,
        method: key.method,
        needsPassword,
      })
    },
  }

  return {
    ...keeper,
    enabled: own.enabled,

    async start(c, current, firstGroupId = uuidV7()) {
      if (current) {
        return {
          outcome: current.user.guestSince
            ? GuestStartOutcome.AlreadyGuest
            : GuestStartOutcome.SignedIn,
        }
      }
      if (!own.enabled) return { outcome: GuestStartOutcome.Off }
      const created = await db.begin(async (tx) => {
        const identity = await tx.guests.createIdentity()
        const user = await tx.user.createForAuthUser(identity.userId, {
          firstName: "",
          lastName: "",
          mfa: UserMFAStatus.NOT_CONFIGURED,
          role: UserRole.VIEWER,
          lastLoginAt: new Date(),
          guestSince: new Date(),
        })
        await tx.group.createFirst({ id: firstGroupId, name: "Personal" }, user.id)
        // The same starter data as a sign-up: the worker writes the welcome note.
        await tx.starterData.queue(user.id)
        await tx.guests.event(GuestEventKind.Created)
        await tx.authAudit.insert(own.auditRow(c, user.id, AuthAuditEventType.GUEST_STARTED))
        const started = await own.sessionsOver(tx.sessionStore, GUEST_SESSION_MINUTES).create({
          userId: user.id,
          keyId: identity.keyId,
          secondFactor: SecondFactorStatus.NotRequired,
        }, own.deviceOf(c))
        return { user, ...started }
      })
      await own.cookie.set(c, created.session, created.cookieValue)
      return {
        outcome: GuestStartOutcome.Started,
        signedIn: { user: created.user, session: created.session },
      }
    },

    async renew(c, { user, session }) {
      if (!user.guestSince) return
      const renewed = await db.guests.renew(user.id, session.id)
      if (renewed === null) return
      const value = await own.cookie.read(c)
      if (value) await own.cookie.set(c, { ...session, expiresAt: renewed.expiresAt }, value)
      // The day the account was made counts as the first; each renewal adds one more day.
      if (renewed.visitDays === 2) await this.remind(user.id, GuestReminderKind.ThirdVisit)
    },

    async remind(userId, kind) {
      try {
        await db.guests.remind(userId, kind)
      } catch (error) {
        console.error("error: cannot send a guest reminder", error)
      }
    },

    async switchState({ user }) {
      if (!user.guestSince) return null
      const waiting = await db.guests.findSwitch(user.id)
      if (!waiting) return null
      const target = await db.user.findOne({ id: waiting.targetUserId })
      if (!target) return null
      const key = await db.authStore.findKeyById(waiting.targetKeyId)
      const address = key?.email ?? (await readAddress(db, waiting.targetUserId))
      const holdings = await db.guests.holdings(user.id)
      return {
        method: waiting.method,
        maskedEmail: address ? maskEmail(address) : null,
        needsPassword: waiting.needsPassword,
        needsCode: target.mfa === UserMFAStatus.CONFIGURED,
        groups: holdings.groups,
        notes: holdings.notes,
      }
    },

    async switchTo(c, { user }, body) {
      if (!user.guestSince) return { outcome: GuestSwitchOutcome.Expired }
      const waiting = await db.guests.findSwitch(user.id)
      if (!waiting) return { outcome: GuestSwitchOutcome.Expired }
      const target = await db.user.findOne({ id: waiting.targetUserId })
      if (!target || target.blockedAt || await db.admin.isBlocked(target.id)) {
        return { outcome: GuestSwitchOutcome.Unavailable }
      }
      // Every check first: a wrong password or code must leave the guest exactly as it was.
      if (waiting.needsPassword) {
        if (body.password === undefined) return { outcome: GuestSwitchOutcome.WrongPassword }
        if (!(await own.checkPassword(target.id, body.password))) {
          return { outcome: GuestSwitchOutcome.WrongPassword }
        }
      }
      const hasCode = target.mfa === UserMFAStatus.CONFIGURED
      if (hasCode) {
        if (body.otp === undefined) return { outcome: GuestSwitchOutcome.WrongCode }
        if (!(await own.verifyTotpCode({ user: target }, body.otp))) {
          return { outcome: GuestSwitchOutcome.WrongCode }
        }
      }
      const done = await db.begin(async (tx) => {
        await tx.lockUser(user.id)
        // Read again under the lock: a second request for the same choice finds none.
        const still = await tx.guests.findSwitch(user.id)
        if (!still || still.targetKeyId !== waiting.targetKeyId) return null
        const movedGroups = body.choice === "move"
          ? await tx.guests.moveGroups(user.id, target.id)
          : 0
        if (!(await tx.guests.delete(user.id))) return { blockers: true as const }
        const started = await own.sessionsOver(tx.sessionStore).create({
          userId: target.id,
          keyId: waiting.targetKeyId,
          secondFactor: hasCode ? SecondFactorStatus.Completed : SecondFactorStatus.NotRequired,
        }, own.deviceOf(c))
        await tx.authAudit.insert(
          own.auditRow(c, target.id, AuthAuditEventType.SIGNED_IN, waiting.method),
        )
        return { movedGroups, ...started }
      })
      if (done === null) return { outcome: GuestSwitchOutcome.Expired }
      if ("blockers" in done) {
        return {
          outcome: GuestSwitchOutcome.Blocked,
          blockers: await db.accountDeletion.blockers(user.id),
        }
      }
      await own.cookie.set(c, done.session, done.cookieValue)
      return {
        outcome: GuestSwitchOutcome.Switched,
        signedIn: { user: target, session: done.session },
        result: { secondFactorPending: false, movedGroups: done.movedGroups },
      }
    },

    async cancelSwitch({ user }) {
      await db.guests.dropSwitch(user.id)
    },

    async deleteAccount(c, { user }, word) {
      if (!user.guestSince) return { deleted: false, reason: "not-guest" }
      if (word.trim().toLowerCase() !== GUEST_DELETE_WORD) {
        return { deleted: false, reason: "wrong-word" }
      }
      const deleted = await db.begin((tx) => tx.guests.delete(user.id))
      if (!deleted) {
        return {
          deleted: false,
          reason: "blocked",
          blockers: await db.accountDeletion.blockers(user.id),
        }
      }
      own.cookie.clear(c)
      return { deleted: true }
    },
  }
}

/** The proven address of `userId` from its keys, or `null`. */
async function readAddress(db: AppDbBase, userId: number): Promise<string | null> {
  const keys = await db.authStore.listKeys(userId)
  const withAddress = keys.find((key) => key.method === PASSWORD_METHOD && key.email) ??
    keys.find((key) => key.email !== null)
  return withAddress?.email ?? null
}
