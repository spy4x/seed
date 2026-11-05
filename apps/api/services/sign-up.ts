/**
 * Password sign-up, with or without a mailed code first, wired from `createSignIn`. Not
 * `@server/auth/sign-up-requests.ts`, which stores the waiting sign-up and its code.
 *
 * - **One sign-up transaction.** The auth user and key, the session, the `users` profile row (same
 *   id) and the first group are written in one `db.begin()`: the sign-up provider is built over
 *   that transaction's stores.
 *
 * @module
 */
import type { Context } from "hono"
import { type PasswordHasher, SecondFactorStatus } from "@spy4x/server/sign-in"
import { AuthConflictError, ChallengeOutcome, normalizeEmail } from "@spy4x/server/auth"
import { PASSWORD_METHOD, PasswordSignInError } from "@spy4x/server/auth/password"
import { createSignedPayloadCodec } from "@spy4x/platform/signed-payload"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { type } from "arktype"
import {
  accountUsing,
  attemptSignUpCode,
  type ExistingAccount,
  SIGN_UP_TTL_MINUTES,
  signUpExpiry,
  type SignUpRequest,
} from "@server/auth/sign-up-requests.ts"
import type { AppAuthState, SignedIn } from "./sign-in.ts"
import type { SignInParts } from "./sign-in-parts.ts"

/** What {@link SignUpOperations.completeSignUp} did with a code. */
export enum SignUpOutcome {
  /** The account is created, its address proven, and the person signed in. */
  Created = 1,
  /** An account already uses the address. Nothing was created, and the sign-up is gone. */
  AccountExists = 2,
  /** The code is wrong, or expired, or used up; the sign-up still waits. */
  WrongCode = 3,
  /** No sign-up waits: it took too long, the code was guessed at too often, or none was started. */
  Expired = 4,
  /** A guest's sign-up: the address and password were added to the guest, now kept. */
  GuestKept = 5,
  /**
   * A guest's sign-up whose address belongs to an account with a password: nothing changed, and
   * the switch page offers to sign in to that account with its password.
   */
  GuestTaken = 6,
}

/** The answer of {@link SignUpOperations.completeSignUp}. */
export type SignUpCompletion =
  | { outcome: SignUpOutcome.Created; signedIn: SignedIn }
  | { outcome: SignUpOutcome.AccountExists; email: string; account: ExistingAccount }
  | { outcome: SignUpOutcome.GuestKept; signedIn: SignedIn }
  | { outcome: SignUpOutcome.WrongCode | SignUpOutcome.Expired | SignUpOutcome.GuestTaken }

/** A sign-up waiting for its code, as the page that asks for the code reads it back. */
export interface WaitingSignUp {
  email: string
  expiresAt: Date
}

/** The cookie that ties a browser to its waiting sign-up. */
export const PASSWORD_SIGN_UP_COOKIE = "password_sign_up"

/** The only path the sign-up cookie is sent to: the routes of the waiting sign-up. */
const PASSWORD_SIGN_UP_COOKIE_PATH = "/api/auth/password/sign-up"

/** The sign-up cookie's payload: the waiting sign-up's id, signed with the cookie secret. */
export const signUpCookieSchema = type({ id: "string > 0" })

/** The sign-up operations the routes call. */
export interface SignUpOperations {
  /**
   * Creates the auth user, password key, profile, first group, session and audit row in one
   * transaction and sets the cookie. `null` when the address is not one `normalizeEmail` accepts, or an account
   * already signs in with it.
   *
   * @param firstGroupId The id of the person's first group. Defaults to a random UUID.
   */
  signUp(
    c: Context,
    email: string,
    password: string,
    firstGroupId?: string,
  ): Promise<SignedIn | null>
  /**
   * Starts a sign-up that proves its address first: hashes the password, writes the
   * waiting sign-up, queues its code mail and sets the cookie that names it. The same work and
   * the same answer for every address: it never asks whether an account uses `email`, which must
   * be normalised already. `false` only for a password the hasher refuses.
   */
  requestSignUp(
    c: Context,
    email: string,
    password: string,
    guestUserId?: number | null,
    /** The asking page's language, for the code mail. */
    language?: string | null,
  ): Promise<boolean>
  /** The sign-up the request's cookie names while it waits, or `null`. */
  waitingSignUp(c: Context): Promise<WaitingSignUp | null>
  /**
   * Queues a new code for the waiting sign-up and gives it a fresh lifetime. `false` when none
   * waits. The caller spends the address's code budget first.
   */
  resendSignUpCode(c: Context): Promise<boolean>
  /** Forgets the waiting sign-up, its password hash included, and clears the cookie. */
  cancelSignUp(c: Context): Promise<void>
  /**
   * Checks `code` for the waiting sign-up. The right one creates the account, as `signUp` does but
   * with its address proven, and signs it in; or, when an account already uses the address, it
   * creates nothing and says how that account signs in. Either way the waiting sign-up is gone.
   *
   * @param firstGroupId The id of the person's first group. Defaults to a random UUID.
   */
  completeSignUp(c: Context, code: string, firstGroupId?: string): Promise<SignUpCompletion>
}

/** Builds the sign-up operations over the sign-in's own parts. */
export function createSignUpOperations(own: SignInParts): SignUpOperations {
  const {
    db,
    options,
    hasher,
    cookie,
    sessionsOver,
    passwordsOver,
    guests,
    createProfile,
    deviceOf,
  } = own
  /**
   * The right code of a guest's sign-up: the address and password become the guest's first
   * sign-in method, so the account is kept with the same user id and everything in it. The
   * browser must still carry that guest's session. When an account already uses the address and
   * has a password, nothing changes and the switch page asks for that password; one without a
   * password is answered as a sign-up is, with how it signs in.
   */
  async function keepGuestByAddress(
    c: Context,
    request: SignUpRequest,
    now: Date,
  ): Promise<SignUpCompletion> {
    const state = c.get("auth") as AppAuthState | null | undefined
    const guestId = request.guestUserId!
    if (!state || state.user.id !== guestId || !state.user.guestSince) {
      await endSignUp(c, request.id)
      return { outcome: SignUpOutcome.Expired }
    }
    const account = await accountUsing(db.authStore, request.email)
    if (account !== null) {
      await endSignUp(c, request.id)
      const key = account.password
        ? await db.authStore.findKey(PASSWORD_METHOD, request.email)
        : null
      if (key && key.userId !== guestId) {
        await guests.taken(guestId, key, true)
        return { outcome: SignUpOutcome.GuestTaken }
      }
      return { outcome: SignUpOutcome.AccountExists, email: request.email, account }
    }
    try {
      const kept = await db.begin(async (tx) => {
        await tx.lockUser(guestId)
        const key = await tx.authStore.addKey(guestId, {
          method: PASSWORD_METHOD,
          subject: request.email,
          email: request.email,
          secret: request.secret,
          provenAt: now,
        })
        const started = await guests.keep(c, tx, guestId, key.id, PASSWORD_METHOD)
        if (!started) return null
        await tx.signUpRequest.remove(request.id)
        const user = await tx.user.findOne({ id: guestId })
        if (!user) throw new Error("User not found")
        return { user, ...started }
      })
      deleteCookie(c, PASSWORD_SIGN_UP_COOKIE, signUpCookieOptions)
      if (!kept) return { outcome: SignUpOutcome.Expired }
      await cookie.set(c, kept.session, kept.cookieValue)
      return {
        outcome: SignUpOutcome.GuestKept,
        signedIn: { user: kept.user, session: kept.session },
      }
    } catch (error) {
      // Another account took the address between the check and the write.
      if (error instanceof AuthConflictError) {
        await endSignUp(c, request.id)
        return { outcome: SignUpOutcome.Expired }
      }
      throw error
    }
  }

  const signUpCookie = createSignedPayloadCodec({
    secret: options.cookieSecret,
    purpose: "app.password-sign-up",
    version: 1,
    schema: signUpCookieSchema,
  })
  const signUpCookieOptions = {
    httpOnly: true,
    secure: options.secureCookie,
    sameSite: "Lax",
    path: PASSWORD_SIGN_UP_COOKIE_PATH,
  } as const

  /** Names the waiting sign-up `id` in the browser's cookie for as long as the sign-up works. */
  async function setSignUpCookie(c: Context, id: string): Promise<void> {
    setCookie(c, PASSWORD_SIGN_UP_COOKIE, await signUpCookie.sign({ id }), {
      ...signUpCookieOptions,
      maxAge: SIGN_UP_TTL_MINUTES * 60,
    })
  }

  /**
   * The id in the request's sign-up cookie, or `null`. A cookie this API did not sign, or one
   * changed since, is no cookie.
   */
  async function signUpIdOf(c: Context): Promise<string | null> {
    const raw = getCookie(c, PASSWORD_SIGN_UP_COOKIE)
    const read = raw ? await signUpCookie.verify(raw) : null
    return read?.ok ? read.value.id : null
  }

  /** Forgets the waiting sign-up `id` and the cookie that names it. */
  async function endSignUp(c: Context, id: string): Promise<void> {
    await db.signUpRequest.remove(id)
    deleteCookie(c, PASSWORD_SIGN_UP_COOKIE, signUpCookieOptions)
  }
  return {
    async signUp(c, rawEmail, password, firstGroupId = uuidV7()) {
      // Checked here too, so a refused address opens no transaction and makes no provider.
      if (normalizeEmail(rawEmail) === null) return null
      // Hashed before `db.begin()`, as before the package provider, so no pool connection is held
      // for the length of a PBKDF2 hash. A password the hasher refuses (not a string, too long) is
      // the same refusal the provider gives it: `invalid-password`, answered as `null`.
      let secret: string
      try {
        secret = await hasher.hash(password)
      } catch (error) {
        if (error instanceof RangeError || error instanceof TypeError) return null
        throw error
      }
      // The per-transaction provider hashes nothing itself: its `hash` returns the secret made
      // above, both for the new key and for the dummy hash it makes at creation. Its dummy only
      // serves its own `signIn`, which is never called; sign-in runs on `signInPasswords`, whose
      // dummy is a real hash from the real hasher.
      const precomputed: PasswordHasher = {
        hash: () => Promise.resolve(secret),
        verify: (candidate, stored) => hasher.verify(candidate, stored),
      }
      let created
      try {
        created = await db.begin(async (tx) => {
          // Built over the transaction's stores, so the auth user, key and session join it.
          const signedUp = await passwordsOver({
            store: tx.authStore,
            sessions: sessionsOver(tx.sessionStore),
            hasher: precomputed,
            // The route schema is the sign-up length rule (8 to 50 UTF-16 units), as before; the
            // package's own minimum counts code points and would refuse some passwords it accepts.
            minPasswordLength: 1,
          }).signUp({ email: rawEmail, password, device: deviceOf(c) })
          const user = await createProfile(
            c,
            tx,
            signedUp.user.id,
            normalizeEmail(rawEmail),
            firstGroupId,
          )
          return { user, ...signedUp.session }
        })
      } catch (error) {
        if (error instanceof PasswordSignInError) return null
        throw error
      }
      await cookie.set(c, created.session, created.cookieValue)
      return { user: created.user, session: created.session }
    },

    async requestSignUp(c, email, password, guestUserId = null, language = null) {
      // Hashed before anything is written, as `signUp` does, so no pool connection waits on it.
      let secret: string
      try {
        secret = await hasher.hash(password)
      } catch (error) {
        if (error instanceof RangeError || error instanceof TypeError) return false
        throw error
      }
      const id = uuidV7()
      await db.begin(async (tx) => {
        await tx.signUpRequest.create({
          id,
          email,
          secret,
          expiresAt: signUpExpiry(new Date()),
          guestUserId,
          language,
        })
        await tx.signUpRequest.queueCode(id)
      })
      await setSignUpCookie(c, id)
      return true
    },

    async waitingSignUp(c) {
      const id = await signUpIdOf(c)
      const request = id === null ? null : await db.signUpRequest.find(id)
      return request && { email: request.email, expiresAt: request.expiresAt }
    },

    async resendSignUpCode(c) {
      const id = await signUpIdOf(c)
      if (id === null) return false
      const extended = await db.begin(async (tx) => {
        if (!(await tx.signUpRequest.extend(id, signUpExpiry(new Date())))) return false
        await tx.signUpRequest.queueCode(id)
        return true
      })
      if (extended) await setSignUpCookie(c, id)
      return extended
    },

    async cancelSignUp(c) {
      const id = await signUpIdOf(c)
      if (id !== null) await endSignUp(c, id)
      else deleteCookie(c, PASSWORD_SIGN_UP_COOKIE, signUpCookieOptions)
    },

    async completeSignUp(c, code, firstGroupId = uuidV7()) {
      const now = new Date()
      const id = await signUpIdOf(c)
      const request = id === null ? null : await db.signUpRequest.find(id, now)
      if (request === null) return { outcome: SignUpOutcome.Expired }
      // Counted outside any transaction, so a wrong guess stays counted whatever follows.
      const checked = await attemptSignUpCode(db.authStore, request, code, now)
      if (checked === ChallengeOutcome.LockedOut) {
        await endSignUp(c, request.id)
        return { outcome: SignUpOutcome.Expired }
      }
      if (checked !== ChallengeOutcome.Matched) return { outcome: SignUpOutcome.WrongCode }

      // Only now, with the mailbox proven, may the answer tell that an account uses the address.
      const existing = async (): Promise<SignUpCompletion> => {
        const account = await accountUsing(db.authStore, request.email)
        await endSignUp(c, request.id)
        if (account === null) return { outcome: SignUpOutcome.Expired }
        return { outcome: SignUpOutcome.AccountExists, email: request.email, account }
      }
      if (request.guestUserId) return await keepGuestByAddress(c, request, now)
      if (await accountUsing(db.authStore, request.email)) return await existing()

      let created
      try {
        created = await db.begin(async (tx) => {
          // Proven from the start: the code just showed that this person holds the mailbox. The
          // key claims the address, so a sign-up of the same address that won the race makes this
          // one throw, and nothing of it is kept.
          const signedUp = await tx.authStore.createUserWithKey({
            method: PASSWORD_METHOD,
            subject: request.email,
            email: request.email,
            secret: request.secret,
            provenAt: now,
          })
          const started = await sessionsOver(tx.sessionStore).create({
            userId: signedUp.user.id,
            keyId: signedUp.key.id,
            secondFactor: SecondFactorStatus.NotRequired,
          }, deviceOf(c))
          const user = await createProfile(c, tx, signedUp.user.id, request.email, firstGroupId)
          await tx.signUpRequest.remove(request.id)
          return { user, ...started }
        })
      } catch (error) {
        if (error instanceof AuthConflictError) return await existing()
        throw error
      }
      deleteCookie(c, PASSWORD_SIGN_UP_COOKIE, signUpCookieOptions)
      await cookie.set(c, created.session, created.cookieValue)
      return {
        outcome: SignUpOutcome.Created,
        signedIn: { user: created.user, session: created.session },
      }
    },
  }
}
