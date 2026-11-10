/**
 * Sign-in and sign-up by a mailed code, wired from `createSignIn`. Not
 * `@server/auth/sign-in-codes.ts`, which stores the request and its code.
 *
 * @module
 */
import type { Context } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { AuthConflictError, type AuthKey, ChallengeOutcome } from "@spy4x/server/auth"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { createSignedPayloadCodec } from "@spy4x/platform/signed-payload"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { AuthAuditEventType, SIGN_IN_LINK_METHOD } from "@domain/identity"
import type { AppDbBase } from "./db-base.ts"
import {
  SIGN_IN_CODE_TTL_MINUTES,
  SIGN_IN_CODES,
  signInCodeExpiry,
  type SignInCodeRequest,
} from "@server/auth/sign-in-codes.ts"
import { signUpCookieSchema } from "./sign-up.ts"
import type { AppAuthState, SignedIn, SignInOptions } from "./sign-in.ts"
import type { SignInParts } from "./sign-in-parts.ts"

/** What {@link SignInCodeOperations.completeSignInCode} did with a code. */
export enum SignInCodeOutcome {
  /** The code's address belongs to an account: it is signed in, its second factor still owed. */
  SignedIn = 1,
  /** No account used the address: a new one is made with it proven, and signed in. */
  Created = 2,
  /** A guest's code to a new address: the address became the guest's, now kept. */
  GuestKept = 3,
  /**
   * A guest's code to an address another account owns: nothing changed, and the switch page asks
   * what happens to the guest's work.
   */
  GuestTaken = 4,
  /**
   * No request waits in this browser, it expired or its guesses ran out, the browser's guest is
   * not the one who asked, or the account is blocked or gone. One answer for all; the request ends.
   */
  Refused = 5,
  /**
   * An account signs in with the address by password but never proved it: the code proves the
   * mailbox, not that account, so nothing happens. A password reset proves it.
   */
  Unconfirmed = 6,
  /** Not the request's code: the guess is counted and the request keeps waiting. */
  WrongCode = 7,
}

/** The answer of {@link SignInCodeOperations.completeSignInCode}. */
export type SignInCodeRedemption =
  | {
    outcome: SignInCodeOutcome.SignedIn | SignInCodeOutcome.Created | SignInCodeOutcome.GuestKept
    signedIn: SignedIn
    /** The address the code proved. */
    email: string
    /** The page to open next, as the request stored it. */
    next: string | null
  }
  | { outcome: SignInCodeOutcome.GuestTaken; next: string | null }
  | {
    outcome: SignInCodeOutcome.Refused | SignInCodeOutcome.Unconfirmed | SignInCodeOutcome.WrongCode
  }

/** The cookie that ties a browser to the sign-in code it waits for. */
export const SIGN_IN_CODE_COOKIE = "sign_in_code"

/** The sign-in code operations the routes call. */
export interface SignInCodeOperations {
  /**
   * Asks for a sign-in code to `email`, already normalised: writes the request and
   * its mail job, and names the request in this browser's cookie. The same work for every address;
   * the code decides what happens once entered. A guest who asks is recorded, so that guest keeps
   * their account through the code. `language` is the asking page's, for the mail.
   */
  requestSignInCode(
    c: Context,
    email: string,
    next: string | null,
    language?: string | null,
  ): Promise<void>
  /** The address of the sign-in code this browser waits for, or `null`. */
  waitingSignInCode(c: Context): Promise<{ email: string } | null>
  /**
   * Mails a new code for this browser's request, ending the old one, and starts its time again.
   * The guesses already spent stay spent. `false` when no request waits.
   */
  resendSignInCode(c: Context): Promise<boolean>
  /** Forgets this browser's request and its cookie. */
  cancelSignInCode(c: Context): Promise<void>
  /**
   * Checks `code` against this browser's request and, when right, signs in to the account that
   * owns its address, or makes one with the address proven. An account with an authenticator app
   * still owes its code. A guest who asked keeps their account with the address, or is offered the
   * switch when another account owns it; any other guest is refused and keeps their session. A full
   * account's session the browser held before is replaced. The right code ends every request and
   * code of the address. Where sign-up is by invitation, a code that would make a new account
   * throws `SignUpClosedError` unless `invitation` admits the address; the request is spent.
   *
   * @param firstGroupId The id of a new account's first group. Defaults to a random UUID.
   */
  completeSignInCode(
    c: Context,
    code: string,
    invitation?: string | null,
    firstGroupId?: string,
  ): Promise<SignInCodeRedemption>
}

/** Builds the sign-in code operations over the sign-in's own parts. */
export function createSignInCodeOperations(own: SignInParts): SignInCodeOperations {
  const {
    db,
    options,
    cookie,
    sessionsOver,
    signInSecondFactor,
    waitingForCode,
    restoreIfWaiting,
    guests,
    createProfile,
    joinInvitedGroup,
    replaceSession,
    auditRow,
    deviceOf,
    isMissingProfile,
  } = own
  const signInCodeCookie = waitingCookie(
    options,
    SIGN_IN_CODE_COOKIE,
    "/api/auth/code",
    "app.sign-in-code",
    SIGN_IN_CODE_TTL_MINUTES,
  )

  /** The sign-in request this browser's cookie names, while it works, or `null`. */
  async function waitingSignInRequest(c: Context, now: Date): Promise<SignInCodeRequest | null> {
    const id = await signInCodeCookie.idOf(c)
    return id ? await db.signInCode.find(id, now) : null
  }

  /**
   * The key a sign-in code signs user `userId` in through, added the first time. It holds
   * no secret and no address: the code proved the mailbox, and the account's own keys hold its
   * address. Its sessions show as e-mail sessions, and a code sign-up's key carries the new
   * address itself (see {@link signInByCode}).
   */
  async function codeKeyOf(tx: AppDbBase, userId: number): Promise<AuthKey> {
    const keys = await tx.authStore.listKeys(userId)
    return keys.find((key) => key.method === SIGN_IN_LINK_METHOD) ??
      await tx.authStore.addKey(userId, {
        method: SIGN_IN_LINK_METHOD,
        subject: uuidV7(),
        email: null,
        secret: null,
        provenAt: null,
      })
  }

  /**
   * What a right code does, for the request's normalised address `email`:
   *
   * - **An owner of the proven address** is signed in, as a password would sign them in: a blocked
   *   account is refused, one waiting to be deleted is restored (or owes its code first), and an
   *   authenticator app is still owed. A guest is offered the switch to that account instead.
   * - **A password key that claims the address without having proven it** is left alone: the code
   *   proves the mailbox, not that account, whose password may be someone else's.
   * - **Nobody** has the address: a new account is made with a code key that carries it, proven;
   *   a guest keeps theirs with that key instead. Where sign-up is by invitation, the new account
   *   accepts `invitation` in the same transaction (`joinInvitedGroup`).
   *
   * When someone proves the address between the read and the write, the write fails and this runs
   * once more, then finds that owner.
   */
  async function signInByCode(
    c: Context,
    request: SignInCodeRequest,
    now: Date,
    invitation: string | null,
    firstGroupId: string,
    retried = false,
  ): Promise<SignInCodeRedemption> {
    const { email, next } = request
    const state = c.get("auth") as AppAuthState | null | undefined
    const guest = state?.user.guestSince ? state : null
    const owner = await db.authStore.findUserIdByProvenEmail(email)
    if (owner === null) {
      if (await db.authStore.findKey(PASSWORD_METHOD, email)) {
        return { outcome: SignInCodeOutcome.Unconfirmed }
      }
      const codeKey = {
        method: SIGN_IN_LINK_METHOD,
        subject: uuidV7(),
        email,
        secret: null,
        provenAt: now,
      }
      try {
        if (guest) {
          const kept = await db.begin(async (tx) => {
            await tx.lockUser(guest.user.id)
            const key = await tx.authStore.addKey(guest.user.id, codeKey)
            const started = await guests.keep(c, tx, guest.user.id, key.id, SIGN_IN_LINK_METHOD)
            if (!started) return null
            const user = await tx.user.findOne({ id: guest.user.id })
            if (!user) throw new Error("User not found")
            return { user, ...started }
          })
          if (!kept) return { outcome: SignInCodeOutcome.Refused }
          await cookie.set(c, kept.session, kept.cookieValue)
          return {
            outcome: SignInCodeOutcome.GuestKept,
            signedIn: { user: kept.user, session: kept.session },
            email,
            next,
          }
        }
        const created = await db.begin(async (tx) => {
          const signedUp = await tx.authStore.createUserWithKey(codeKey)
          const started = await sessionsOver(tx.sessionStore).create({
            userId: signedUp.user.id,
            keyId: signedUp.key.id,
            secondFactor: SecondFactorStatus.NotRequired,
          }, deviceOf(c))
          const user = await createProfile(
            c,
            tx,
            signedUp.user.id,
            SIGN_IN_LINK_METHOD,
            firstGroupId,
          )
          await joinInvitedGroup(tx, invitation, user.id)
          return { user, ...started }
        })
        await replaceSession(c, state, created)
        return {
          outcome: SignInCodeOutcome.Created,
          signedIn: { user: created.user, session: created.session },
          email,
          next,
        }
      } catch (error) {
        if (error instanceof AuthConflictError && !retried) {
          return await signInByCode(c, request, now, invitation, firstGroupId, true)
        }
        throw error
      }
    }

    if (guest) {
      const key = await db.begin((tx) => codeKeyOf(tx, owner))
      await guests.taken(guest.user.id, { id: key.id, userId: owner, method: key.method }, false)
      return { outcome: SignInCodeOutcome.GuestTaken, next }
    }
    const authUser = await db.authStore.findUser(owner)
    if (!authUser || authUser.deletedAt !== null) return { outcome: SignInCodeOutcome.Refused }
    if (await db.admin.isBlocked(owner)) return { outcome: SignInCodeOutcome.Refused }
    const waiting = await waitingForCode(owner)
    let secondFactor: SecondFactorStatus
    if (waiting) {
      secondFactor = SecondFactorStatus.Pending
    } else {
      if (!(await restoreIfWaiting(c, owner))) return { outcome: SignInCodeOutcome.Refused }
      try {
        secondFactor = await signInSecondFactor(authUser)
      } catch (error) {
        if (isMissingProfile(error)) return { outcome: SignInCodeOutcome.Refused }
        throw error
      }
    }
    // The session, the last sign-in time and the audit row are kept or undone together.
    const started = await db.begin(async (tx) => {
      const key = await codeKeyOf(tx, owner)
      const begun = await sessionsOver(tx.sessionStore).create({
        userId: owner,
        keyId: key.id,
        secondFactor,
      }, deviceOf(c))
      const user = waiting ??
        await tx.user.updateOne({ id: owner, data: { lastLoginAt: new Date() } })
      if (!user) throw new Error("User not found")
      await tx.authAudit.insert(
        auditRow(c, owner, AuthAuditEventType.SIGNED_IN, SIGN_IN_LINK_METHOD),
      )
      return { user, ...begun }
    })
    await replaceSession(c, state, started)
    return {
      outcome: SignInCodeOutcome.SignedIn,
      signedIn: { user: started.user, session: started.session },
      email,
      next,
    }
  }
  return {
    async requestSignInCode(c, email, next, language) {
      const state = c.get("auth") as AppAuthState | null | undefined
      const id = uuidV7()
      await db.begin(async (tx) => {
        await tx.signInCode.create({
          id,
          email,
          next,
          requestedBy: state?.user.guestSince ? state.user.id : null,
          language,
          expiresAt: signInCodeExpiry(new Date()),
        })
        await tx.signInCode.queueCode(id)
      })
      await signInCodeCookie.set(c, id)
    },

    async waitingSignInCode(c) {
      const request = await waitingSignInRequest(c, new Date())
      return request ? { email: request.email } : null
    },

    async resendSignInCode(c) {
      const now = new Date()
      const request = await waitingSignInRequest(c, now)
      if (!request) return false
      // The new code ends the old one when the worker issues it; the guesses spent stay spent.
      await db.begin(async (tx) => {
        await tx.signInCode.extend(request.id, signInCodeExpiry(now), now)
        await tx.signInCode.queueCode(request.id)
      })
      await signInCodeCookie.set(c, request.id)
      return true
    },

    async cancelSignInCode(c) {
      const id = await signInCodeCookie.idOf(c)
      if (id) await db.signInCode.remove(id)
      signInCodeCookie.clear(c)
    },

    async completeSignInCode(c, code, invitation = null, firstGroupId = uuidV7()) {
      const now = new Date()
      const request = await waitingSignInRequest(c, now)
      const end = async (): Promise<SignInCodeRedemption> => {
        if (request) await db.signInCode.remove(request.id)
        signInCodeCookie.clear(c)
        return { outcome: SignInCodeOutcome.Refused }
      }
      if (!request) return await end()
      // A guest uses only a code the guest asked for: one who signed in as a guest after asking
      // in this browser would otherwise attach the address to an account nobody asked about.
      const state = c.get("auth") as AppAuthState | null | undefined
      if (state?.user.guestSince && request.requestedBy !== state.user.id) return await end()
      const guessed = await SIGN_IN_CODES.attempt(db.authStore, request, code, now)
      if (guessed === ChallengeOutcome.WrongGuess) return { outcome: SignInCodeOutcome.WrongCode }
      if (guessed !== ChallengeOutcome.Matched) return await end()
      // Spent outside any transaction, so every code of the address is gone whatever follows.
      await SIGN_IN_CODES.forget(db.authStore, request.email)
      await db.signInCode.removeFor(request.email)
      signInCodeCookie.clear(c)
      return await signInByCode(c, request, now, invitation, firstGroupId)
    },
  }
}

/**
 * A signed cookie that names one waiting request of a mailed code, sent only to the
 * routes under `path`, so only the browser that asked can enter the code. A cookie this API did
 * not sign, or one changed since, names nothing.
 */
export function waitingCookie(
  options: Pick<SignInOptions, "cookieSecret" | "secureCookie">,
  name: string,
  path: string,
  purpose: string,
  ttlMinutes: number,
) {
  const codec = createSignedPayloadCodec({
    secret: options.cookieSecret,
    purpose,
    version: 1,
    schema: signUpCookieSchema,
  })
  const cookieOptions = {
    httpOnly: true,
    secure: options.secureCookie,
    sameSite: "Lax",
    path,
  } as const
  return {
    set: async (c: Context, id: string): Promise<void> => {
      setCookie(c, name, await codec.sign({ id }), { ...cookieOptions, maxAge: ttlMinutes * 60 })
    },
    idOf: async (c: Context): Promise<string | null> => {
      const raw = getCookie(c, name)
      const read = raw ? await codec.verify(raw) : null
      return read?.ok ? read.value.id : null
    },
    clear: (c: Context): void => {
      deleteCookie(c, name, cookieOptions)
    },
  }
}
