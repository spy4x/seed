import type { Context } from "hono"
import {
  authenticationOptions,
  type AuthenticationResponse,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  registrationOptions,
  type RegistrationResponse,
  verifyAuthentication,
  verifyRegistration,
  type WebAuthnChallenge,
  type WebAuthnRelyingParty,
} from "@spy4x/server/webauthn"
import type { OAuthFlowKv } from "@spy4x/server/auth/oauth"
import { AuthConflictError, type AuthSessionRecord } from "@spy4x/server/auth"
import {
  SecondFactorStatus,
  type SessionCookie,
  type SessionDevice,
  type SessionManager,
  type SessionStore,
} from "@spy4x/server/sign-in"
import { decodeBase64Url } from "@std/encoding/base64url"
import {
  type AuthAuditBase,
  AuthAuditEventType,
  PASSKEY_NAME_MAX_LENGTH,
  type User,
} from "@domain/identity"
import { PASSKEY_METHOD, passkeyIdentifier, uniqueName } from "@server/auth/passkeys.ts"
import type { AppDbBase } from "./db-base.ts"
import type { AppAuthState, SignedIn } from "./sign-in.ts"
import type { GuestKeeper } from "./guest-sign-in.ts"

/**
 * Longest credential id kept, in base64url characters: `auth_keys.subject` holds 255. The
 * specification allows 1023 bytes, but a discoverable passkey's id is far shorter (16 to 64 bytes
 * from every provider seen); a longer one is refused as "could not be saved".
 */
export const MAX_CREDENTIAL_ID_LENGTH = 255

/** Key prefixes in the shared KV. A challenge is the rest of the key, so a lookup is its take. */
const ADD_PREFIX = "passkey:add:"
const SIGN_IN_PREFIX = "passkey:sign-in:"
const CONFIRM_PREFIX = "passkey:confirm:"

/** What `createSignIn` is given to turn passkeys on. */
export interface PasskeyOptions {
  /** The site the passkeys belong to: the web app's host and origin. */
  rp: WebAuthnRelyingParty
  /**
   * Keeps each challenge until its response comes back. Its `take` must be atomic (get and delete
   * in one step): that is what makes a challenge single-use. The API passes Valkey.
   */
  kv: OAuthFlowKv
  /** The time, for expiry. Defaults to the system's. */
  clock?: { now(): number }
  /** Records a refusal a person never sees the reason for, such as a counter that went back. */
  log?(message: string): void
}

/** What the sign-in hands this module of its own parts. */
export interface PasskeyInternals {
  db: AppDbBase
  sessionsOver(store: SessionStore<AuthSessionRecord>): SessionManager<AuthSessionRecord>
  cookie: SessionCookie
  auditRow(
    c: Context,
    userId: number,
    eventType: AuthAuditEventType,
    identifier?: string | null,
  ): AuthAuditBase
  deviceOf(c: Context): SessionDevice
  /**
   * The second factor a passkey sign-in of `userId` owes, restoring an account that waits to be
   * deleted as a password sign-in does. A passkey already verified the person, so it owes none,
   * except where only the authenticator code may undo a deletion. `null` when the user may not
   * sign in (blocked, or gone).
   */
  admit(c: Context, userId: number): Promise<SecondFactorStatus | null>
  /** A guest's first passkey keeps the account (#224). */
  guests?: GuestKeeper
  /** The profile of a user who waits to be deleted with two-factor on, else `null`. */
  waitingForCode(userId: number): Promise<User | null>
}

/** How adding a passkey ended. */
export enum PasskeyAddOutcome {
  Added = 1,
  /** No live challenge for this response: it expired, was used, or was never issued. */
  Expired = 2,
  /** The response failed a check (`@spy4x/server/webauthn` says which; it is logged). */
  Refused = 3,
  /** This credential is already one of the person's passkeys. */
  AlreadyYours = 4,
  /** This credential id is taken, by another account, or it is too long to keep. */
  NotSaved = 5,
}

/** How a passkey sign-in ended. */
export type PasskeySignInResult =
  | { kind: "signed-in"; signedIn: SignedIn }
  /** No account has this passkey: the browser should forget it. */
  | { kind: "unknown" }
  /** The challenge, the response or the account refused it. */
  | { kind: "refused" }

export interface PasskeyOperations {
  /** Whether passkeys are on. */
  enabled(): boolean
  /** Options for adding a passkey; the challenge waits under the person's id. */
  addOptions(state: AppAuthState): Promise<PublicKeyCredentialCreationOptionsJSON>
  /** Checks a new passkey and stores it as a sign-in method named after the browser. */
  add(
    c: Context,
    state: AppAuthState,
    response: RegistrationResponse,
  ): Promise<{ outcome: PasskeyAddOutcome; keyId?: number; name?: string }>
  /**
   * Renames passkey `keyId` of the person and writes the audit row that names both names. `false`
   * when they have no such passkey.
   */
  rename(c: Context, state: AppAuthState, keyId: number, name: string): Promise<boolean>
  /**
   * Options for signing in with any passkey of the site (the picker and autofill). With
   * `current`, options for signing in again as that person, which confirms a step the others
   * confirm with their password: only their passkeys are offered.
   */
  signInOptions(current?: AppAuthState): Promise<PublicKeyCredentialRequestOptionsJSON>
  /**
   * Checks a passkey sign-in and starts a session for the passkey's owner. With `current`, the
   * passkey must be that person's, and the new session replaces the current one.
   */
  signIn(
    c: Context,
    response: AuthenticationResponse,
    current?: AppAuthState,
  ): Promise<PasskeySignInResult>
}

/** The challenge a response's client data names, or `null` when it names none readable. */
function challengeOf(clientDataJSON: string): string | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(clientDataJSON)))
    return typeof data?.challenge === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(data.challenge)
      ? data.challenge
      : null
  } catch {
    return null
  }
}

export function createPasskeyOperations(
  options: PasskeyOptions | undefined,
  own: PasskeyInternals,
): PasskeyOperations {
  const { db } = own
  const clock = options?.clock ?? { now: () => Date.now() }
  const now = () => clock.now()
  const log = options?.log ?? (() => {})
  const required = () => {
    if (!options) throw new Error("passkeys are off")
    return options
  }

  /** Keeps `challenge` under `prefix` for as long as it is valid. */
  async function keep(prefix: string, challenge: WebAuthnChallenge): Promise<void> {
    const ttl = Math.ceil((challenge.expiresAt - now()) / 1000)
    await required().kv.set(`${prefix}${challenge.value}`, String(challenge.expiresAt), ttl)
  }

  /**
   * Takes the challenge a response names out of the KV, so a second response for it finds none.
   * `null` when it is not there: expired, used, or issued for someone else.
   */
  async function take(prefix: string, clientDataJSON: string): Promise<WebAuthnChallenge | null> {
    const value = challengeOf(clientDataJSON)
    if (value === null) return null
    const stored = await required().kv.take(`${prefix}${value}`)
    const expiresAt = Number(stored)
    if (stored === null || !Number.isFinite(expiresAt)) return null
    return { value, expiresAt }
  }

  return {
    enabled: () => options !== undefined,

    async addOptions({ user, session }) {
      const { rp } = required()
      const [keys, exclude] = await Promise.all([
        db.authStore.listKeys(user.id),
        db.passkeys.descriptors(user.id),
      ])
      // What the passkey dialog and the password manager show the account as: its address, or
      // the username of an older account.
      const login = keys.find((key) => key.email)?.email ??
        keys.find((key) => key.method === "password")?.subject ?? `Account ${user.id}`
      const displayName = `${user.firstName} ${user.lastName}`.trim() || login
      const { options: json, challenge } = registrationOptions(rp, {
        // The user handle is the account's id, never an address.
        user: { id: String(user.id), name: login, displayName },
        exclude: exclude.map(({ id, transports }) => ({
          id,
          transports: transports as AuthenticatorTransport[],
        })),
        now,
      })
      // Under the person and the session, so another session cannot finish this one's ceremony.
      await keep(`${ADD_PREFIX}${session.id}:`, challenge)
      return json
    },

    async add(c, { user, session }, response) {
      const { rp } = required()
      const challenge = await take(`${ADD_PREFIX}${session.id}:`, response.response.clientDataJSON)
      if (!challenge) return { outcome: PasskeyAddOutcome.Expired }
      const checked = await verifyRegistration(rp, { response, challenge, now })
      if (!checked.ok) {
        log(`warn: a new passkey was refused: ${checked.reason}`)
        return { outcome: PasskeyAddOutcome.Refused }
      }
      const { credential } = checked
      if (credential.id.length > MAX_CREDENTIAL_ID_LENGTH) {
        return { outcome: PasskeyAddOutcome.NotSaved }
      }
      try {
        return await db.begin(async (tx) => {
          // Two adds at once would both pick the same default name; the lock orders them.
          await tx.lockUser(user.id)
          const existing = await tx.authStore.findKey(PASSKEY_METHOD, credential.id)
          if (existing) {
            return {
              outcome: existing.userId === user.id
                ? PasskeyAddOutcome.AlreadyYours
                : PasskeyAddOutcome.NotSaved,
            }
          }
          const taken = (await tx.passkeys.list(user.id)).map((passkey) => passkey.name)
          const name = uniqueName(
            own.deviceOf(c).deviceName || "Passkey",
            taken,
            PASSKEY_NAME_MAX_LENGTH,
          )
          const key = await tx.authStore.addKey(user.id, {
            method: PASSKEY_METHOD,
            subject: credential.id,
            email: null,
            secret: null,
            provenAt: null,
          })
          await tx.passkeys.insert({
            keyId: key.id,
            userId: user.id,
            publicKey: credential.publicKey,
            counter: credential.counter,
            transports: credential.transports ?? [],
            backedUp: checked.backedUp,
            name,
          })
          // A guest's first passkey is the account's first way in: it is a guest no more.
          await own.guests?.keep(c, tx, user.id, key.id, PASSKEY_METHOD)
          await tx.authAudit.insert(
            own.auditRow(
              c,
              user.id,
              AuthAuditEventType.SIGN_IN_METHOD_LINKED,
              passkeyIdentifier(name),
            ),
          )
          await tx.signInMethodMail.queue(
            user.id,
            AuthAuditEventType.SIGN_IN_METHOD_LINKED,
            PASSKEY_METHOD,
          )
          return { outcome: PasskeyAddOutcome.Added, keyId: key.id, name }
        })
      } catch (error) {
        // Another account added the same credential at the same moment.
        if (error instanceof AuthConflictError) return { outcome: PasskeyAddOutcome.NotSaved }
        throw error
      }
    },

    rename(c, { user }, keyId, name) {
      return db.begin(async (tx) => {
        const previous = await tx.passkeys.rename(user.id, keyId, name)
        if (previous === null) return false
        if (previous !== name) {
          await tx.authAudit.insert(
            own.auditRow(
              c,
              user.id,
              AuthAuditEventType.SIGN_IN_METHOD_RENAMED,
              `${passkeyIdentifier(name)} from=${previous}`,
            ),
          )
        }
        return true
      })
    },

    async signInOptions(current) {
      const { rp } = required()
      const allow = current ? await db.passkeys.descriptors(current.user.id) : []
      const { options: json, challenge } = authenticationOptions(rp, {
        allow: allow.map(({ id, transports }) => ({
          id,
          transports: transports as AuthenticatorTransport[],
        })),
        now,
      })
      await keep(current ? `${CONFIRM_PREFIX}${current.session.id}:` : SIGN_IN_PREFIX, challenge)
      return json
    },

    async signIn(c, response, current) {
      const { rp } = required()
      const prefix = current ? `${CONFIRM_PREFIX}${current.session.id}:` : SIGN_IN_PREFIX
      const challenge = await take(prefix, response.response.clientDataJSON)
      if (!challenge) return { kind: "refused" }
      const stored = await db.passkeys.find(response.id)
      if (!stored) return { kind: "unknown" }
      // Signed in already, the person is known: `userId` makes the library refuse a passkey of
      // anyone else. Signed out, the passkey says who signs in; the user handle, when the response
      // carries one, must still be the stored owner's.
      const checked = await verifyAuthentication(rp, {
        response,
        challenge,
        credential: {
          id: stored.credentialId,
          publicKey: stored.publicKey,
          counter: stored.counter,
          userId: String(stored.userId),
        },
        ...(current ? { userId: String(current.user.id) } : {}),
        now,
      })
      if (!checked.ok) {
        log(
          `warn: a passkey sign-in was refused: ${checked.reason} key=${stored.keyId} user=${stored.userId}`,
        )
        return { kind: "refused" }
      }
      const secondFactor = await own.admit(c, stored.userId)
      if (secondFactor === null) return { kind: "refused" }
      const waiting = await own.waitingForCode(stored.userId)
      const created = await db.begin(async (tx) => {
        await tx.passkeys.recordUse(stored.keyId, checked)
        const sessions = own.sessionsOver(tx.sessionStore)
        const started = await sessions.create({
          userId: stored.userId,
          keyId: stored.keyId,
          secondFactor,
        }, own.deviceOf(c))
        // A deleted row takes no update; the code that restores it comes later.
        const user = waiting ?? await tx.user.updateOne({
          id: stored.userId,
          data: { lastLoginAt: new Date() },
        })
        if (!user) throw new Error("User not found")
        await tx.authAudit.insert(
          own.auditRow(c, user.id, AuthAuditEventType.SIGNED_IN, passkeyIdentifier(stored.name)),
        )
        // The cookie now names the new session; the one this browser had would only linger.
        if (current) await sessions.deleteForUser(current.user.id, current.session.id)
        return { user, ...started }
      })
      await own.cookie.set(c, created.session, created.cookieValue)
      return { kind: "signed-in", signedIn: { user: created.user, session: created.session } }
    },
  }
}
