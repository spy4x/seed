/**
 * The device cookie of the password sign-in: the "device cookie" defence against lockout that
 * OWASP describes. A browser that once proved the password of a login gets a signed cookie naming
 * a device of that login. Its later sign-ins to that login spend the budget all the login's devices
 * share (`rateLimits.deviceSignIn`) instead of the strict budget per network address and the lock per
 * name (`password-failures.ts`), so strangers' wrong passwords cannot keep its owner out.
 *
 * Two rules keep a cookie from becoming a way around those limits:
 *
 * - **It works only for the password it was earned with.** The token is a
 *   `@spy4x/platform/signed-payload` token bound to the login's {@link passwordFailureSubject} and
 *   to a fingerprint of the login's current password key ({@link createPasswordFingerprint}).
 *   A password reset or change writes a new hash, so every older cookie of that login stops
 *   working, as do a cookie made for another login, a changed one and an expired one. Such a
 *   request, and one for a login with no password, is treated as one without a cookie.
 * - **Each device has a lock of its own.** Its wrong passwords count in `password_failures` under
 *   {@link deviceFailureSubject}, with the same policy as the lock per name, so a stolen cookie
 *   gets as few guesses as a name does. Only a request with the cookie reaches that count.
 *
 * @module
 */
import type { Context } from "hono"
import { getCookie, setCookie } from "hono/cookie"
import { type } from "arktype"
import type { Sql } from "@spy4x/server/db"
import { normalizeEmail } from "@spy4x/server/auth"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { createSignedPayloadCodec } from "@spy4x/platform/signed-payload"
import { sha256Hex } from "@spy4x/platform/tokens"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { passwordFailureSubject } from "./password-failures.ts"
import { normalizeUsername } from "./sign-in.ts"

/** The name of the device cookie. */
export const SIGN_IN_DEVICE_COOKIE = `sign_in_device`

/** The only path the browser sends the device cookie to: the password sign-in. */
export const SIGN_IN_DEVICE_PATH = `/api/auth/password/check`

/** How long a device cookie works after the sign-in that set it: 180 days. */
export const SIGN_IN_DEVICE_TTL_MS = 180 * 24 * 60 * 60_000

/** The signed payload's purpose, so no other token of this API passes as a device cookie. */
export const SIGN_IN_DEVICE_PURPOSE = `sign-in.device`

const deviceSchema = type({ id: `string.uuid`, "+": `reject` })

/**
 * Answers a value that changes whenever the password of `login` changes, or `null` when no
 * account signs in with `login` by password.
 */
export type PasswordFingerprint = (login: string) => Promise<string | null>

/** Reads and sets the device cookie. Made by {@link createSignInDevice}. */
export interface SignInDevice {
  /**
   * The device id the request's cookie names, when this API signed the cookie for `login` and its
   * current password, and it has not expired; `null` for no cookie or any other one.
   */
  recognise(c: Context, login: string): Promise<string | null>
  /** Sets a cookie naming a new device of `login`, after the right password for it. */
  remember(c: Context, login: string): Promise<void>
}

/** Options for {@link createSignInDevice}. */
export interface SignInDeviceOptions {
  /** The HMAC key, `AUTH_COOKIE_SECRET`, as the other signed cookies use. */
  cookieSecret: string
  /** `Secure` on the cookie: everywhere but development, as for the session cookie. */
  secureCookie: boolean
  /** The current password's fingerprint; production passes {@link createPasswordFingerprint}. */
  passwordFingerprint: PasswordFingerprint
  /** Unix milliseconds, for the expiry. Defaults to the host clock; tests inject their own. */
  now?: () => number
}

/** Builds the device cookie's reader and writer over one secret. */
export function createSignInDevice(options: SignInDeviceOptions): SignInDevice {
  const codec = createSignedPayloadCodec({
    secret: options.cookieSecret,
    purpose: SIGN_IN_DEVICE_PURPOSE,
    version: 1,
    schema: deviceSchema,
    now: options.now,
  })
  /** The token's context: the login and its current password, or `null` without a password. */
  const contextOf = async (login: string): Promise<string | null> => {
    const fingerprint = await options.passwordFingerprint(login)
    return fingerprint === null ? null : `${await passwordFailureSubject(login)}:${fingerprint}`
  }
  return {
    recognise: async (c, login) => {
      const raw = getCookie(c, SIGN_IN_DEVICE_COOKIE)
      // The fingerprint costs a query, so a request without the cookie never runs it.
      if (!raw) return null
      const context = await contextOf(login)
      if (context === null) return null
      const read = await codec.verify(raw, { context })
      return read.ok ? read.value.id : null
    },
    remember: async (c, login) => {
      const context = await contextOf(login)
      if (context === null) return
      const token = await codec.sign({ id: uuidV7() }, { context, ttlMs: SIGN_IN_DEVICE_TTL_MS })
      setCookie(c, SIGN_IN_DEVICE_COOKIE, token, {
        httpOnly: true,
        secure: options.secureCookie,
        sameSite: `Strict`,
        path: SIGN_IN_DEVICE_PATH,
        maxAge: SIGN_IN_DEVICE_TTL_MS / 1000,
      })
    },
  }
}

/**
 * The fingerprint of the password key `login` signs in with: the SHA-256 of the key's id and its
 * stored hash, one lookup on the key's unique `(method, subject)`. Every new hash has a new salt,
 * so a reset and a change both give a new fingerprint, and so does the rehash of an outdated hash
 * at sign-in. The hash itself never leaves the database.
 */
export function createPasswordFingerprint(sql: Sql): PasswordFingerprint {
  return async (login) => {
    // The subject as the sign-in normalises it: an address first, else an older username.
    const subject = normalizeEmail(login) ?? normalizeUsername(login)
    if (subject === null) return null
    const [key] = await sql<{ id: number; secret: string | null }[]>`
      SELECT id, secret FROM auth_keys WHERE method = ${PASSWORD_METHOD} AND subject = ${subject}
    `
    return key?.secret ? await sha256Hex(`${key.id}:${key.secret}`) : null
  }
}

/**
 * The key in `password_failures` of a device's wrong passwords: 64 hex characters, as the table
 * holds. A name's key hashes what was typed; this one hashes a prefix and the device id, which
 * only the device's cookie holds, so nobody without the cookie can count on it.
 */
export async function deviceFailureSubject(deviceId: string): Promise<string> {
  return await sha256Hex(`device:${deviceId}`)
}
