/**
 * Proving an e-mail address with a one-time code (#140): where an account's address stands, the
 * address change that waits for its code, and the one check that later features ask before they
 * trust an address.
 *
 * The codes are `createEmailProof`'s from `@spy4x/server/auth/email-code`: 48 random bits as 8
 * base64url characters, bound to the user and the address, stored only as a SHA-256 of both and the
 * code, 5 guesses per code, 10 minutes, deleted when they match. Each user and address pair keeps
 * its own guess count, so another account asking to prove the same address cannot spend this
 * account's guesses. The store compares the hashes with SQL `=`; the time that takes tells a guesser nothing
 * about the code, since they would need a preimage of the hash. Asking again replaces the code and
 * keeps its guess count, so asking never buys more guesses.
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import type { AuthKey, AuthStore } from "@spy4x/server/auth"
import { normalizeEmail } from "@spy4x/server/auth"
import {
  createEmailProof,
  DEFAULT_CODE_TTL_MINUTES,
  EMAIL_CODE_METHOD,
} from "@spy4x/server/auth/email-code"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import type { EmailStatus } from "@domain/identity"

/** How long a mailed code works. */
export const EMAIL_CODE_TTL_MINUTES = DEFAULT_CODE_TTL_MINUTES

/**
 * The user's password key, or `null`: an account made by a Google or GitHub sign-up has none, and
 * an account that lost it to such a sign-up (it never confirmed its address) has none either.
 */
export async function passwordKeyOf(store: AuthStore, userId: number): Promise<AuthKey | null> {
  const keys = await store.listKeys(userId)
  return keys.find((key) => key.method === PASSWORD_METHOD) ?? null
}

/**
 * Deletes the user's code keys, except one on the address `keep`. A code key is how an address is
 * proven, and how an account without a password holds its address. Once the address is held
 * elsewhere, or the account has moved on, a proven code key left behind would still say "this
 * person owns that address" and let a provider account of its next owner in.
 */
export async function dropCodeKeys(
  store: AuthStore,
  userId: number,
  keep: string | null = null,
): Promise<void> {
  for (const key of await store.listKeys(userId)) {
    if (key.method === EMAIL_CODE_METHOD && key.email !== keep) {
      await store.deleteKey(userId, key.id)
    }
  }
}

/**
 * Takes `address` off every key of the user that still carries it, keeping the keys (#403). After
 * an address change those are the provider keys: each keeps signing in by its provider's own user
 * id, but no longer says "this person owns the old address". Left in place, it would let any other
 * Google or GitHub identity that vouches for the old address, such as one the mailbox's next
 * holder makes, be linked into the account.
 */
export async function releaseAddress(
  store: AuthStore,
  userId: number,
  address: string,
): Promise<void> {
  if (!store.releaseKeyEmail) throw new TypeError("the auth store cannot release an address")
  for (const key of await store.listKeys(userId)) {
    if (key.email === address) await store.releaseKeyEmail(userId, key.id)
  }
}

/** The `email_changes` table: one new address per user, waiting for its code. */
export type EmailChanges = ReturnType<typeof emailChanges>

/** {@link EmailChanges} over `sql`, a pool or a transaction. */
export function emailChanges(sql: Sql) {
  return {
    /** The address the user asked to move to, or `null`. */
    find: async (userId: number): Promise<string | null> =>
      (await sql<{ email: string }[]>`
        SELECT email FROM email_changes WHERE user_id = ${userId}
      `)[0]?.email ?? null,
    /** Records `email`, already normalised, replacing an earlier request. */
    save: async (userId: number, email: string): Promise<void> => {
      await sql`
        INSERT INTO email_changes (user_id, email) VALUES (${userId}, ${email})
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, created_at = now()
      `
    },
    remove: async (userId: number): Promise<void> => {
      await sql`DELETE FROM email_changes WHERE user_id = ${userId}`
    },
  }
}

/**
 * Where the user's address stands: the one they sign in with, its proof, and a pending change.
 * The password key's address when there is one. An account with no password has the address a
 * code proved for it when it changed its address (#384), else the one a provider vouched for
 * (#141), which is why an account made with Google reads as having a proven address.
 */
export async function readEmailStatus(
  changes: Pick<EmailChanges, "find">,
  store: AuthStore,
  userId: number,
): Promise<EmailStatus> {
  const key = addressKeyOf(await store.listKeys(userId))
  return {
    email: key?.email ?? null,
    proven: isProven(key),
    pending: await changes.find(userId),
  }
}

/**
 * Whether the address the user signs in with is proven: `readEmailStatus`'s `proven`, without the
 * pending change. An account with no address at all (a username account made before #139) is not.
 */
export async function hasProvenAddress(store: AuthStore, userId: number): Promise<boolean> {
  return isProven(addressKeyOf(await store.listKeys(userId)))
}

/** The key that holds the user's address, in the order `readEmailStatus` describes. */
function addressKeyOf(keys: AuthKey[]): AuthKey | undefined {
  const held = (candidate: AuthKey) => candidate.email !== null && candidate.provenAt !== null
  return keys.find((candidate) => candidate.method === PASSWORD_METHOD) ??
    keys.find((candidate) => candidate.method === EMAIL_CODE_METHOD && held(candidate)) ??
    keys.find(held)
}

function isProven(key: AuthKey | undefined): boolean {
  return key?.email != null && key.provenAt !== null
}

/**
 * Issues a code that proves `email` for `userId` and hands it to `send`, which mails it. The raw
 * code exists only in that call. A rejection of `send` reaches the caller; the code is issued by
 * then and simply replaced by the next one.
 */
export async function sendEmailCode(
  store: AuthStore,
  userId: number,
  email: string,
  send: (email: string, code: string) => Promise<void>,
): Promise<void> {
  await createEmailProof({ store, sendCode: send }).requestCode(userId, email)
}

/**
 * Checks `code` for `userId` and `email` and, on a match, proves the address for the user. Returns
 * the user's keys that now carry it, proven. Throws `EmailCodeError` and `AuthConflictError` as
 * `createEmailProof().proveAddress` does.
 */
export async function proveEmailCode(
  store: AuthStore,
  userId: number,
  email: string,
  code: string,
): Promise<AuthKey[]> {
  const proof = createEmailProof({
    store,
    sendCode: () => Promise.reject(new Error("checking a code sends no mail")),
  })
  return await proof.proveAddress(userId, email, code)
}

/**
 * The user who owns `email` because a code or a reset link proved it, or `null`: an unproven claim
 * owns nothing. Anything that trusts an address to name a person asks this first; today that is
 * an invitation by address (#131).
 */
export async function provenAddressOwner(store: AuthStore, email: unknown): Promise<number | null> {
  const address = normalizeEmail(email)
  return address === null ? null : await store.findUserIdByProvenEmail(address)
}
