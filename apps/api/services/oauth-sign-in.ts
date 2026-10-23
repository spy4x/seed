/**
 * Sign-in with Google and GitHub (#141), and the question before a provider creates an account
 * (#142), on `@spy4x/server/auth/oauth`. The package does the protocol (PKCE, a single-use
 * `state`, the token and profile requests) and decides who a provider account is: the user whose
 * key carries the provider's id, else the user who owns the provider's verified address proven,
 * else nobody. This file decides what the template adds:
 *
 * - **A provider is on only when it was given.** `createSignIn` gets the providers whose client id
 *   and secret are set; every operation answers "off" for any other.
 * - **Nothing is created in the callback.** The package runs with `signUp: "confirm"`: a callback
 *   for an unknown person holds the profile for 10 minutes under a single-use token, which goes to
 *   the browser in an HttpOnly cookie. `confirmSignUp` spends it and creates the auth user, key,
 *   session, profile, first group and audit row in one transaction, as the password sign-up does.
 *   "Go back" takes the held profile out of the flow store, so the token is dead at once, and
 *   leaving the page creates nothing: the token expires by itself.
 * - **The sign-up cookie is signed.** Beside the token it carries what the question shows and
 *   where the profile is held, and the API acts on both. The package's flow store can only take
 *   a held profile out, never read it, so those facts cannot be read back from the server; the
 *   cookie is signed with the cookie secret instead (`@spy4x/platform/signed-payload`), and one
 *   that was edited or written by hand reads as no cookie.
 * - **The question says what creating costs.** The package deletes every other user's unproven
 *   claim to an address the moment someone proves it, so nobody can sit on an address they do
 *   not own. A password account that never confirmed its address therefore loses its password
 *   when the provider's verified owner of that address creates an account. Joining the two
 *   instead would hand the newcomer an account whose password someone else chose, so the rule
 *   stays; the question page warns first, and the account that lost its password gets an audit
 *   row (`UNCONFIRMED_ADDRESS_TAKEN`). Whether a claim was taken is read from the database around
 *   the write that takes it, never from what the browser sent.
 * - **An address that is not verified links nothing.** The package ignores it when it resolves the
 *   person, so such a callback always ends at the question, never inside someone's account.
 * - **Linking from the profile.** Starting it asks for the account's password, or for a provider
 *   sign-in of a moment ago when it has none (the route checks; see the last point). Then the
 *   package's connect flow runs: it is bound to the signed-in user,
 *   adds the provider to that user whatever the provider's address, and never touches another
 *   account's methods. A provider account another user already signs in with is refused, and the
 *   page says so. Its `state` has a cookie of its own; the callback, which both kinds of flow
 *   share, runs the connect when that cookie holds the callback's `state`. A provider key carries
 *   its address only when the provider vouches for it and nobody else has proven it; adding such
 *   a key deletes another user's unproven claim to that address, as a sign-up does, and that
 *   user gets the same audit row.
 * - **Unlinking.** Only a provider method, and never the last way in. An address another key holds
 *   proven counts as a way in, since a sign-in link reaches it (#406). The key's sessions end with
 *   it through the foreign key, so unlinking the method this device signed in with signs it out.
 * - **A sign-in a moment ago stands in for the password (#384).** An account made with a provider
 *   has no password to confirm a deletion, a first password or a new address with. Its proof is
 *   the session itself: one a provider sign-in started less than `PROVIDER_PROOF_MINUTES` ago
 *   (`proofUntil`). It proves the browser is signed in to the provider, not who sits at it: on a
 *   browser where the provider is still signed in, signing in again is one click. That is enough
 *   for this product, which aims below bank-level proofs (#204). An old session cannot make
 *   itself recent: the one way to get a provider sign-in without the owner's provider account
 *   would be to link another one, and starting a link asks for the same proof (the password, or
 *   this sign-in of a moment ago). Unlinking asks for the same proof (#385): a session left open
 *   must not take away the way in its owner uses.
 * - **Every link and unlink is mailed (#385)** to the account's proven address, naming the
 *   provider and the time, from the same transaction as its audit row (`recordMethodChange`).
 *
 * Reads no environment and imports no singleton, like `sign-in.ts`.
 *
 * @module
 */

import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { type Type, type } from "arktype"
import { validate } from "@spy4x/validation"
import {
  type AuthKey,
  type AuthSessionRecord,
  type AuthStore,
  type AuthUser,
  type NewAuthKey,
  normalizeEmail,
} from "@spy4x/server/auth"
import {
  type ConfirmableOAuthSignIn,
  createMemoryOAuthFlowStore,
  createOAuthSignIn,
  type OAuthFlowStore,
  OAuthOutcome,
  type OAuthProviderConfig,
  OAuthSignInError,
  type OAuthSignInResult,
} from "@spy4x/server/auth/oauth"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { hasProvenAddress } from "@server/auth/email-verification.ts"
import {
  SecondFactorStatus,
  type SessionCookie,
  type SessionDevice,
  type SessionManager,
  type SessionStore,
} from "@spy4x/server/sign-in"
import {
  type AuthAuditBase,
  AuthAuditEventType,
  OAUTH_PROVIDERS,
  type OAuthNotice,
  type OAuthProviderId,
  oauthProviderId,
  type PendingSignUp,
  PROVIDER_PROOF_MINUTES,
  providerAvatarUrl,
  SIGN_IN_LINK_METHOD,
  type SignInMethod,
  type SignInMethodsResponse,
  type User,
  UserMFAStatus,
  UserRole,
} from "@domain/identity"
import { createSignedPayloadCodec } from "@spy4x/platform/signed-payload"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { safeRedirectPath } from "@spy4x/net/redirect-path"
import type { SignInMethodChange } from "@server/jobs/sign-in-method-mail.ts"
import { PASSKEY_METHOD, passkeyIdentifier, type PasskeySummary } from "@server/auth/passkeys.ts"
import type { AppDbBase } from "./db-base.ts"
import type { AppAuthState, SignedIn } from "./sign-in.ts"
import type { GuestKeeper } from "./guest-sign-in.ts"

/** How long a started flow and its cookie live: the package's default, in seconds. */
const FLOW_SECONDS = 600

/** The cookies below go only to the auth routes. */
const COOKIE_PATH = "/api/auth"

/** Holds the `state` of a started sign-in, and the page to return to. */
const stateCookie = (id: OAuthProviderId) => `oauth_state_${id}`

/** Holds the `state` of a link started on the profile: a flow of its own kind, so a cookie of its own. */
const connectCookie = (id: OAuthProviderId) => `oauth_connect_${id}`

/**
 * Holds the token of a sign-up that waits for its confirmation, and what the page shows, as a
 * value signed with the cookie secret.
 */
const SIGN_UP_COOKIE = "oauth_sign_up"

/** What the sign-up cookie's signature is for: a value signed for anything else is refused. */
const SIGN_UP_COOKIE_PURPOSE = "oauth.sign-up"

/** Longest address the confirmation page is given to show. */
const MAX_SHOWN_EMAIL = 320

/**
 * Longest picture address the confirmation page is given to show; a longer one shows initials.
 * Keeps the signed cookie that carries it well under a browser's 4 KB limit.
 */
const MAX_SHOWN_AVATAR_URL = 1024

const stateCookieSchema = type({
  state: "string > 0",
  /** The page sign-in returns to, checked when it was stored and again when it is read. */
  "next?": "string",
})

const connectCookieSchema = type({ state: "string > 0" })

/**
 * `next` when it is a page of the web app, else `null`: `safeRedirectPath`'s rules, and no `/api`
 * path. The same check the SPA's sign-in pages make (`checkedNext`).
 */
export function pageOrNull(next: string | null | undefined): string | null {
  if (!next) return null
  return safeRedirectPath(next, { fallback: "", refuse: ["/api"] }) || null
}

const signUpCookieSchema = type({
  provider: type.enumerated(...OAUTH_PROVIDERS),
  token: "string > 0",
  /** Where the flow store keeps the held profile, so "go back" can take it out. */
  held: "string > 0",
  email: "string | null",
  /** Whether the provider vouches for `email`. */
  verified: "boolean",
  /** The provider's name of the person, already cut to a length by the library. */
  "name?": "string | null",
  /** The provider's picture, kept only on `PROVIDER_AVATAR_ORIGINS`. */
  "avatarUrl?": "string | null",
  expiresAt: "string.date.iso",
})

/** The JSON value of cookie `name` when it fits `schema`, else `null`. */
function readJsonCookie<T>(c: Context, name: string, schema: Type<T>): T | null {
  const raw = getCookie(c, name)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return (validate(schema, parsed).data as T | undefined) ?? null
}

/** What `createSignIn` is given to turn provider sign-in on. */
export interface OAuthOptions {
  /**
   * The providers that are on, each made by the package (`createGoogleOAuthProvider`,
   * `createGitHubOAuthProvider`): its `id` is one of `OAUTH_PROVIDERS`.
   */
  providers: readonly OAuthProviderConfig[]
  /** The web app's origin. A provider's callback is `<origin>/api/auth/<id>/callback`. */
  origin: string
  /**
   * Keeps started flows and waiting sign-ups. Defaults to the package's memory store, which only
   * suits one process; the API passes `createKvOAuthFlowStore` over Valkey.
   */
  flows?: OAuthFlowStore
  /** Sends the token and profile requests. Defaults to `fetch`; tests pass a fake provider. */
  fetch?: (request: Request) => Promise<Response>
  /** The time, for expiry. Defaults to the system's. */
  clock?: { now(): number }
}

/** What the sign-in hands this module of its own parts. */
export interface OAuthInternals {
  db: AppDbBase
  sessionsOver(store: SessionStore<AuthSessionRecord>): SessionManager<AuthSessionRecord>
  cookie: SessionCookie
  /**
   * The secret that signs the session cookie, at least 32 characters. The sign-up cookie is signed
   * with it too, under a purpose of its own.
   */
  cookieSecret: string
  secureCookie: boolean
  auditRow(
    c: Context,
    userId: number,
    eventType: AuthAuditEventType,
    identifier?: string | null,
  ): AuthAuditBase
  deviceOf(c: Context): SessionDevice
  /**
   * The second factor a provider sign-in of an existing user owes, restoring an account that waits
   * to be deleted as a password sign-in does. Throws what {@link isRefusal} recognises when the
   * user may not sign in.
   */
  secondFactorFor(c: Context): (user: AuthUser) => Promise<SecondFactorStatus>
  /** The second factor at a confirmed sign-up: none for a new user, the user's own otherwise. */
  secondFactorAtSignUp(user: AuthUser): Promise<SecondFactorStatus>
  /** The profile of a user who waits to be deleted with two-factor on, else `null`. */
  waitingForCode(userId: number): Promise<User | null>
  /** Whether `error` means "this user may not sign in" rather than a fault. */
  isRefusal(error: unknown): boolean
  /** A guest's provider link keeps the account, or, when that provider account is taken, offers to switch (#224). */
  guests?: GuestKeeper
}

/** How a provider's callback ended. */
export type OAuthCallbackResult =
  /** Signed in: the session cookie is set. */
  | { kind: "signed-in"; signedIn: SignedIn; next: string | null }
  /** Nobody has this provider account: the sign-up cookie is set and the page asks. */
  | { kind: "confirm" }
  /** Nothing to continue with: `notice` says why, `linking` whether it started on the profile. */
  | { kind: "notice"; notice: OAuthNotice; linking: boolean }

/** What {@link OAuthOperations.unlink} did. */
export enum UnlinkOutcome {
  Unlinked = 1,
  /** Unlinked, and it was the method this device signed in with: the cookie is cleared. */
  UnlinkedAndSignedOut = 2,
  /** No provider method or passkey with this id on the account. The password is never unlinked. */
  NotFound = 3,
  /** It is the only way in. Nothing changed. */
  LastMethod = 4,
}

/** The provider sign-in operations the routes call. */
export interface OAuthOperations {
  /** The providers that are on. */
  providers(): OAuthProviderId[]
  /**
   * Starts a flow and sets its state cookie. Returns the provider's page to send the browser to,
   * or `null` when the provider is off. With `linking`, the callback only links to that user.
   * `next` is the page a finished sign-in returns to; anything but a page of the web app is dropped.
   */
  start(
    c: Context,
    id: OAuthProviderId,
    options?: { linking?: AppAuthState | null; next?: string | null },
  ): Promise<string | null>
  /** Finishes a flow from the provider's redirect. `current` is the request's session, if any. */
  callback(
    c: Context,
    id: OAuthProviderId,
    current: AppAuthState | null,
  ): Promise<OAuthCallbackResult>
  /** The sign-up this browser may confirm, or `null` when none waits or it has expired. */
  pendingSignUp(c: Context): Promise<PendingSignUp | null>
  /**
   * Creates the account the waiting sign-up asks for and signs it in, in one transaction, and
   * clears the sign-up cookie. `null` when nothing waits, or the token is used or expired. The
   * session the browser had before (`current`) ends: the device is the new account's now.
   *
   * @param firstGroupId The id of the person's first group. Defaults to a new UUID.
   */
  confirmSignUp(
    c: Context,
    current: AppAuthState | null,
    firstGroupId?: string,
  ): Promise<SignedIn | null>
  /**
   * Answers "I already have an account": nothing was created, the cookie goes and the held
   * profile leaves the flow store, so a kept copy of the cookie confirms nothing either.
   */
  cancelSignUp(c: Context): Promise<void>
  /** The user's ways in, the providers they could still link, and {@link proofUntil} as text. */
  methods(state: AppAuthState): Promise<SignInMethodsResponse>
  /**
   * Until when the request's session confirms a step that asks an account with no password for
   * proof: `PROVIDER_PROOF_MINUTES` after a provider sign-in started it. `null` for a session a
   * password started, and for one that is older.
   */
  proofUntil(state: AppAuthState): Promise<Date | null>
  /** Removes provider method `keyId` of the user, with its sessions, unless it is the last way in. */
  unlink(c: Context, state: AppAuthState, keyId: number): Promise<UnlinkOutcome>
}

/** Builds the provider sign-in over the sign-in's own parts. Without `options` every provider is off. */
export function createOAuthOperations(
  options: OAuthOptions | undefined,
  own: OAuthInternals,
): OAuthOperations {
  const { db, cookie } = own
  const clock = options?.clock ?? { now: () => Date.now() }
  const flows = options?.flows ?? createMemoryOAuthFlowStore({ clock })
  const enabled = new Map<OAuthProviderId, OAuthProviderConfig>()
  for (const provider of options?.providers ?? []) {
    const id = oauthProviderId(provider.id)
    if (id === null) throw new TypeError(`unknown sign-in provider "${provider.id}"`)
    enabled.set(id, provider)
  }
  const sessions = own.sessionsOver(db.sessionStore)
  const cookieOptions = {
    httpOnly: true,
    secure: own.secureCookie,
    sameSite: "Lax",
    path: COOKIE_PATH,
  } as const
  const signUpCookie = createSignedPayloadCodec({
    secret: own.cookieSecret,
    purpose: SIGN_UP_COOKIE_PURPOSE,
    version: 1,
    schema: signUpCookieSchema,
  })

  /** The package's sign-in with `id` over these stores. Cheap: it only checks its options. */
  function signInWith(
    id: OAuthProviderId,
    over: {
      store: AuthStore
      sessions: SessionManager<AuthSessionRecord>
      secondFactorFor: (user: AuthUser) => Promise<SecondFactorStatus>
    },
    /** Told where the flow store keeps a profile that waits for the person's answer. */
    onHeld?: (key: string) => void,
  ): ConfirmableOAuthSignIn {
    return createOAuthSignIn({
      ...over,
      provider: enabled.get(id)!,
      redirectUri: `${options!.origin}/api/auth/${id}/callback`,
      flows: onHeld
        ? {
          take: (key) => flows.take(key),
          async put(key, flow, expiresAt) {
            await flows.put(key, flow, expiresAt)
            if (flow.signUp) onHeld(key)
          },
        }
        : flows,
      fetch: options!.fetch,
      clock,
      signUp: "confirm",
    })
  }

  /** Which way in a key is, or `null` for a key nobody can sign in with now. */
  function kindOf(key: AuthKey): SignInMethod["kind"] | null {
    if (key.method === PASSWORD_METHOD) return key.secret ? "password" : null
    if (key.method === PASSKEY_METHOD) return "passkey"
    const id = key.method.startsWith("oauth:") ? oauthProviderId(key.method.slice(6)) : null
    return id !== null && enabled.has(id) ? id : null
  }

  function describe(
    keys: AuthKey[],
    currentKeyId: number,
    passkeys: readonly PasskeySummary[],
  ): Omit<SignInMethodsResponse, "providerProofUntil" | "emailLink"> {
    const passkeyOf = (keyId: number) => {
      const found = passkeys.find((passkey) => passkey.keyId === keyId)
      return found
        ? {
          name: found.name,
          createdAt: found.createdAt.toISOString(),
          lastUsedAt: found.lastUsedAt?.toISOString() ?? null,
        }
        : undefined
    }
    const ways = keys.flatMap((key) => {
      const kind = kindOf(key)
      return kind === null ? [] : [{ key, kind }]
    })
    // A sign-in link reaches the account while another key holds its address proven: the address
    // stays the account's after `key` goes, so the link still finds it (#406).
    const linkOutlives = (key: AuthKey) =>
      keys.some((other) => other.id !== key.id && other.email !== null && other.provenAt !== null)
    return {
      methods: ways.map(({ key, kind }) => ({
        id: key.id,
        kind,
        // An older account's password key carries a username and no address.
        email: key.email ?? (kind === "password" ? key.subject : null),
        current: key.id === currentKeyId,
        canUnlink: kind !== "password" && (ways.length > 1 || linkOutlives(key)),
        passkey: kind === "passkey" ? passkeyOf(key.id) : undefined,
      })),
      available: [...enabled.keys()].filter((id) => !ways.some((way) => way.kind === id)),
    }
  }

  /**
   * The password key that claims the waiting sign-up's address without having proven it, or
   * `null`. Only an address the provider vouches for can take such a claim away. This is what the
   * question warns about; what was really taken is read by {@link reportingTakenClaims}.
   */
  async function unconfirmedClaim(
    store: AuthStore,
    waiting: typeof signUpCookieSchema.infer,
  ): Promise<AuthKey | null> {
    const email = waiting.verified ? normalizeEmail(waiting.email) : null
    const key = email === null ? null : await store.findKey(PASSWORD_METHOD, email)
    return key && key.provenAt === null ? key : null
  }

  /**
   * `store`, noting in `taken` each password claim to an address that a write took away. The
   * package deletes every other user's unproven claim to an address as it writes a key that
   * proves it (a new user's first key, or a key added to a user) and reports nothing. So the
   * claim is read before the write and looked for again after. That it is gone afterwards is the
   * fact the audit row records: only another user's unproven claim is ever deleted by the write.
   */
  /** `store`, noting in `found` every key a lookup by method and subject answered. */
  function notingFoundKeys(store: AuthStore, found: AuthKey[]): AuthStore {
    return new Proxy(store, {
      get(target, name, receiver) {
        if (name === "findKey") {
          return async (method: string, subject: string) => {
            const key = await target.findKey(method, subject)
            if (key) found.push(key)
            return key
          }
        }
        const value = Reflect.get(target, name, receiver)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }

  function reportingTakenClaims(store: AuthStore, taken: AuthKey[]): AuthStore {
    const noting = async <T>(key: NewAuthKey, write: () => Promise<T>): Promise<T> => {
      const claim = key.email === null ? null : await store.findKey(PASSWORD_METHOD, key.email)
      const written = await write()
      if (claim && await store.findKeyById(claim.id) === null) taken.push(claim)
      return written
    }
    return new Proxy(store, {
      get(target, name, receiver) {
        if (name === "addKey") {
          return (userId: number, key: NewAuthKey) => noting(key, () => target.addKey(userId, key))
        }
        if (name === "createUserWithKey") {
          return (key: NewAuthKey) => noting(key, () => target.createUserWithKey(key))
        }
        const value = Reflect.get(target, name, receiver)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }

  /** One audit row for each account whose unconfirmed claim to an address a new `method` key took. */
  async function writeTakenClaims(
    c: Context,
    tx: AppDbBase,
    taken: AuthKey[],
    method: string,
  ): Promise<void> {
    for (const claim of taken) {
      await tx.authAudit.insert(
        own.auditRow(c, claim.userId, AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN, method),
      )
    }
  }

  /**
   * The waiting sign-up in the request's cookie, token included, or `null`. A cookie this API did
   * not sign, or one changed since, is no cookie.
   */
  async function readSignUp(c: Context): Promise<typeof signUpCookieSchema.infer | null> {
    const raw = getCookie(c, SIGN_UP_COOKIE)
    const read = raw ? await signUpCookie.verify(raw) : null
    if (!read?.ok || !enabled.has(read.value.provider)) return null
    return Date.parse(read.value.expiresAt) > clock.now() ? read.value : null
  }

  /**
   * After the package signed an existing user in: the last sign-in time and the audit rows, in one
   * transaction, then the cookie. When they cannot be written the session is deleted again.
   */
  async function finishSignIn(c: Context, result: OAuthSignInResult): Promise<SignedIn> {
    const { session, cookieValue } = result.session
    let user: User
    try {
      const waiting = await own.waitingForCode(result.user.id)
      user = await db.begin(async (tx) => {
        // A deleted row takes no update; the code that restores it comes later.
        const row = waiting ?? await tx.user.updateOne({
          id: result.user.id,
          data: { lastLoginAt: new Date() },
        })
        if (!row) throw new Error("User not found")
        await writeSignInAudit(c, tx, result)
        return row
      })
    } catch (error) {
      await sessions.deleteForUser(result.user.id, session.id)
      throw error
    }
    await cookie.set(c, session, cookieValue)
    return { user, session }
  }

  /**
   * A sign-in method linked to or unlinked from user `userId`: its audit row, and the mail that
   * tells the person (#385), both in the change's transaction `tx`, so the mail goes exactly when
   * the change stands.
   */
  async function recordMethodChange(
    c: Context,
    tx: AppDbBase,
    userId: number,
    change: SignInMethodChange,
    method: string,
    identifier: string = method,
  ): Promise<void> {
    await tx.authAudit.insert(own.auditRow(c, userId, change, identifier))
    await tx.signInMethodMail.queue(userId, change, method)
  }

  /** The audit rows of a provider sign-in of an existing user: the link, when one was made, then the sign-in. */
  async function writeSignInAudit(
    c: Context,
    tx: AppDbBase,
    { user, key, outcome }: OAuthSignInResult,
  ): Promise<void> {
    if (outcome === OAuthOutcome.Linked) {
      await recordMethodChange(c, tx, user.id, AuthAuditEventType.SIGN_IN_METHOD_LINKED, key.method)
    }
    await tx.authAudit.insert(own.auditRow(c, user.id, AuthAuditEventType.SIGNED_IN, key.method))
  }

  async function proofUntil({ session }: AppAuthState): Promise<Date | null> {
    const key = await db.authStore.findKeyById(session.keyId)
    // A passkey sign-in proves as much as a provider's (#222): the device verified the person. A
    // sign-in link proves the mailbox, which is what a reset link proves too (#391).
    const proves = key &&
      (key.method.startsWith("oauth:") || key.method === PASSKEY_METHOD ||
        key.method === SIGN_IN_LINK_METHOD)
    if (!proves) return null
    // The session row the request carries has no start time; the devices list has it.
    const started = (await sessions.listForUser(session.userId))
      .find((row) => row.id === session.id)?.createdAt
    if (!started) return null
    const until = started.getTime() + PROVIDER_PROOF_MINUTES * 60_000
    return until > clock.now() ? new Date(until) : null
  }

  return {
    providers: () => [...enabled.keys()],

    async start(c, id, { linking = null, next = null } = {}) {
      if (!enabled.has(id)) return null
      const provider = signInWith(id, {
        store: db.authStore,
        sessions,
        secondFactorFor: own.secondFactorFor(c),
      })
      if (linking) {
        const { url, state } = await provider.connectUrl(linking.user.id)
        setCookie(c, connectCookie(id), JSON.stringify({ state }), {
          ...cookieOptions,
          maxAge: FLOW_SECONDS,
        })
        return url.href
      }
      const { url, state } = await provider.authorizationUrl()
      const kept: typeof stateCookieSchema.infer = { state }
      if (pageOrNull(next)) kept.next = pageOrNull(next)!
      setCookie(c, stateCookie(id), JSON.stringify(kept), {
        ...cookieOptions,
        maxAge: FLOW_SECONDS,
      })
      return url.href
    },

    async callback(c, id, current) {
      const query = new URL(c.req.url).searchParams
      // Both kinds of flow come back here. The one whose cookie holds this `state` is the one
      // that started it, and only that cookie is used up.
      const connect = readJsonCookie(c, connectCookie(id), connectCookieSchema)
      const linking = connect !== null && connect.state === query.get("state")
      const kept = linking ? null : readJsonCookie(c, stateCookie(id), stateCookieSchema)
      deleteCookie(c, linking ? connectCookie(id) : stateCookie(id), cookieOptions)
      const failed = (notice: OAuthNotice = "failed"): OAuthCallbackResult => ({
        kind: "notice",
        notice,
        linking,
      })
      if (!enabled.has(id)) return failed()

      if (linking) {
        // A link needs the person who started it, fully signed in; the package checks that it is
        // the same user.
        if (!current || current.session.secondFactor === SecondFactorStatus.Pending) {
          return failed()
        }
        let added: boolean | "kept"
        // The keys the link looked up, to find the other account when the identity is taken.
        const found: AuthKey[] = []
        try {
          added = await db.begin(async (tx) => {
            const taken: AuthKey[] = []
            const { key, outcome } = await signInWith(id, {
              store: reportingTakenClaims(notingFoundKeys(tx.authStore, found), taken),
              sessions: own.sessionsOver(tx.sessionStore),
              secondFactorFor: own.secondFactorAtSignUp,
            }).handleConnectCallback({
              query,
              browserState: connect.state,
              userId: current.user.id,
            })
            if (outcome !== OAuthOutcome.Connected) return false
            await recordMethodChange(
              c,
              tx,
              key.userId,
              AuthAuditEventType.SIGN_IN_METHOD_LINKED,
              key.method,
            )
            await writeTakenClaims(c, tx, taken, key.method)
            const kept = await own.guests?.keep(c, tx, key.userId, key.id, key.method)
            return kept ? "kept" : true
          })
        } catch (error) {
          if (error instanceof OAuthSignInError) {
            if (error.reason !== "identity-taken") return failed()
            // A guest whose provider account already signs in to another account here gets the
            // choice to switch to it: the provider just proved the person holds that account.
            const other = found.find((key) =>
              key.userId !== current.user.id && key.method !== PASSWORD_METHOD
            )
            if (current.user.guestSince && other && own.guests) {
              await own.guests.taken(current.user.id, other, false)
              return failed("guest-taken")
            }
            return failed("link-taken")
          }
          throw error
        }
        if (added === "kept") return { kind: "notice", notice: "kept", linking }
        return { kind: "notice", notice: added ? "linked" : "link-exists", linking }
      }

      let held = ""
      let result
      try {
        result = await signInWith(id, {
          store: db.authStore,
          sessions,
          secondFactorFor: own.secondFactorFor(c),
        }, (key) => held = key).handleCallback({
          query,
          browserState: kept?.state,
          device: own.deviceOf(c),
        })
      } catch (error) {
        if (error instanceof OAuthSignInError || own.isRefusal(error)) return failed()
        throw error
      }

      if (result.outcome === OAuthOutcome.PendingSignUp) {
        const { email, name, avatarUrl } = result.profile
        const picture = providerAvatarUrl(avatarUrl)
        const shown: typeof signUpCookieSchema.infer = {
          provider: id,
          token: result.token,
          held,
          email: typeof email === "string" && email.length <= MAX_SHOWN_EMAIL ? email : null,
          verified: result.profile.emailVerified === true,
          name: name || null,
          avatarUrl: picture && picture.length <= MAX_SHOWN_AVATAR_URL ? picture : null,
          expiresAt: result.expiresAt.toISOString(),
        }
        setCookie(c, SIGN_UP_COOKIE, await signUpCookie.sign(shown), {
          ...cookieOptions,
          expires: result.expiresAt,
        })
        return { kind: "confirm" }
      }

      const signedIn = await finishSignIn(c, result)
      // The cookie now names the new session; the one this browser had would only linger.
      if (current) await sessions.deleteForUser(current.user.id, current.session.id)
      return { kind: "signed-in", signedIn, next: pageOrNull(kept?.next) }
    },

    async pendingSignUp(c) {
      const waiting = await readSignUp(c)
      if (!waiting) return null
      return {
        provider: waiting.provider,
        email: waiting.email,
        name: waiting.name ?? null,
        avatarUrl: providerAvatarUrl(waiting.avatarUrl),
        expiresAt: waiting.expiresAt,
        unconfirmedAccount: await unconfirmedClaim(db.authStore, waiting) !== null,
      }
    },

    async confirmSignUp(c, current, firstGroupId = uuidV7()) {
      const waiting = await readSignUp(c)
      deleteCookie(c, SIGN_UP_COOKIE, cookieOptions)
      if (!waiting) return null
      let created
      try {
        created = await db.begin(async (tx) => {
          const taken: AuthKey[] = []
          // Built over the transaction's stores, so the auth user, key and session join it.
          const result = await signInWith(waiting.provider, {
            store: reportingTakenClaims(tx.authStore, taken),
            sessions: own.sessionsOver(tx.sessionStore),
            secondFactorFor: own.secondFactorAtSignUp,
          }).confirmSignUp(waiting.token, own.deviceOf(c))
          let user: User | undefined
          if (result.outcome === OAuthOutcome.SignedUp) {
            user = await tx.user.createForAuthUser(result.user.id, {
              firstName: "",
              lastName: "",
              mfa: UserMFAStatus.NOT_CONFIGURED,
              role: UserRole.VIEWER,
              lastLoginAt: new Date(),
            })
            await tx.group.createFirst({ id: firstGroupId, name: "Personal" }, user.id)
            await tx.starterData.queue(user.id)
            await tx.authAudit.insert(
              own.auditRow(
                c,
                user.id,
                AuthAuditEventType.SIGNED_UP,
                result.key.email ?? result.key.method,
              ),
            )
          } else {
            // Someone signed up with this provider account, or proved its address, while the
            // question was open: the package signed that user in instead of making a second one.
            // A blocked user is refused as a deleted one is (#146), and the session goes with
            // the transaction.
            if (await tx.admin.isBlocked(result.user.id)) throw new OAuthSignInError("user-deleted")
            user = await tx.user.updateOne({
              id: result.user.id,
              data: { lastLoginAt: new Date() },
            })
            if (!user) throw new OAuthSignInError("user-deleted")
            await writeSignInAudit(c, tx, result)
          }
          // The package took an unproven claim to this address away: say so where the owner of
          // the product will look when that account's person asks what happened.
          await writeTakenClaims(c, tx, taken, result.key.method)
          return { user, ...result.session }
        })
      } catch (error) {
        if (error instanceof OAuthSignInError) return null
        throw error
      }
      await cookie.set(c, created.session, created.cookieValue)
      if (current) await sessions.deleteForUser(current.user.id, current.session.id)
      return { user: created.user, session: created.session }
    },

    async cancelSignUp(c) {
      const waiting = await readSignUp(c)
      deleteCookie(c, SIGN_UP_COOKIE, cookieOptions)
      if (waiting) await flows.take(waiting.held)
    },

    async methods(state) {
      const { user, session } = state
      return {
        ...describe(
          await db.authStore.listKeys(user.id),
          session.keyId,
          await db.passkeys.list(user.id),
        ),
        providerProofUntil: (await proofUntil(state))?.toISOString() ?? null,
        emailLink: await hasProvenAddress(db.authStore, user.id),
      }
    },

    proofUntil,

    async unlink(c, { user, session }, keyId) {
      const outcome = await db.begin(async (tx) => {
        // Two unlinks at once each see the other's method as the one that remains; the lock makes
        // the second read after the first has finished.
        await tx.lockUser(user.id)
        const { methods } = describe(
          await tx.authStore.listKeys(user.id),
          session.keyId,
          await tx.passkeys.list(user.id),
        )
        const method = methods.find((candidate) => candidate.id === keyId)
        if (!method || method.kind === "password") return UnlinkOutcome.NotFound
        if (!method.canUnlink) return UnlinkOutcome.LastMethod
        if (method.kind === "passkey") {
          // The key's sessions go with it (`auth_sessions` cascades), and so does its passkey row.
          if (!(await tx.authStore.deleteKey(user.id, keyId))) return UnlinkOutcome.NotFound
          await recordMethodChange(
            c,
            tx,
            user.id,
            AuthAuditEventType.SIGN_IN_METHOD_UNLINKED,
            PASSKEY_METHOD,
            passkeyIdentifier(method.passkey?.name ?? ""),
          )
          return method.current ? UnlinkOutcome.UnlinkedAndSignedOut : UnlinkOutcome.Unlinked
        }
        const removed = await signInWith(method.kind, {
          store: tx.authStore,
          sessions: own.sessionsOver(tx.sessionStore),
          secondFactorFor: own.secondFactorAtSignUp,
        }).disconnect(user.id, keyId)
        if (!removed) return UnlinkOutcome.NotFound
        await recordMethodChange(
          c,
          tx,
          user.id,
          AuthAuditEventType.SIGN_IN_METHOD_UNLINKED,
          `oauth:${method.kind}`,
        )
        return method.current ? UnlinkOutcome.UnlinkedAndSignedOut : UnlinkOutcome.Unlinked
      })
      if (outcome === UnlinkOutcome.UnlinkedAndSignedOut) {
        cookie.clear(c)
        c.set("auth", null)
      }
      return outcome
    },
  }
}
