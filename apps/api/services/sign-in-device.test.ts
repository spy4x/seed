import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { MAX_SIGNED_PAYLOAD_LENGTH } from "@spy4x/platform/signed-payload"
import {
  createSignInDevice,
  SIGN_IN_DEVICE_COOKIE,
  SIGN_IN_DEVICE_PATH,
  SIGN_IN_DEVICE_TTL_MS,
  type SignInDeviceOptions,
} from "./sign-in-device.ts"

const SECRET = "unit-test-only-device-cookie-secret-0123456789"

/**
 * An app over one device cookie: `POST /remember?login=` sets one, `GET /recognise?login=` answers
 * the device id the request's cookie names for that login, or `null`.
 */
function deviceApp(options: Partial<SignInDeviceOptions> = {}) {
  const clock = { ms: Date.UTC(2026, 10, 16) }
  /** Each login's current password fingerprint; a login left out has no password. */
  const passwords = new Map([[`ada@example.com`, `first`], [`eve@example.com`, `first`]])
  const device = createSignInDevice({
    cookieSecret: SECRET,
    secureCookie: false,
    now: () => clock.ms,
    passwordFingerprint: (login) =>
      Promise.resolve(passwords.get(login.trim().toLowerCase()) ?? null),
    ...options,
  })
  const app = new Hono()
    .post(`/remember`, async (c) => {
      await device.remember(c, c.req.query(`login`)!)
      return c.body(null, 204)
    })
    .get(`/recognise`, async (c) => c.json(await device.recognise(c, c.req.query(`login`)!)))
  const remember = async (login: string) => {
    const response = await app.request(`/remember?login=${encodeURIComponent(login)}`, {
      method: `POST`,
    })
    return response.headers.getSetCookie()
  }
  const recognise = async (login: string, cookie?: string) => {
    const response = await app.request(`/recognise?login=${encodeURIComponent(login)}`, {
      headers: cookie === undefined ? {} : { cookie },
    })
    return await response.json() as string | null
  }
  return { clock, passwords, remember, recognise }
}

/** The `name=value` part of a `Set-Cookie` line, as a browser sends it back. */
function sent(setCookie: string[]): string {
  return setCookie[0].split(`;`)[0]
}

describe(`the sign-in device cookie`, () => {
  it(`is HttpOnly, SameSite=Strict, sent only to the password sign-in and kept for 180 days`, async () => {
    const { remember } = deviceApp()

    const [line, ...rest] = await remember(`ada@example.com`)

    expect(rest).toEqual([])
    expect(line.startsWith(`${SIGN_IN_DEVICE_COOKIE}=`)).toBe(true)
    const attributes = line.split(`; `).slice(1)
    expect(attributes).toContain(`HttpOnly`)
    expect(attributes).toContain(`SameSite=Strict`)
    expect(attributes).toContain(`Path=${SIGN_IN_DEVICE_PATH}`)
    expect(attributes).toContain(`Max-Age=${SIGN_IN_DEVICE_TTL_MS / 1000}`)
    expect(attributes).not.toContain(`Secure`)
  })

  it(`is Secure when the session cookie is`, async () => {
    const { remember } = deviceApp({ secureCookie: true })

    const [line] = await remember(`ada@example.com`)

    expect(line.split(`; `)).toContain(`Secure`)
  })

  it(`names a new UUID v7 device on every right password, for the login as the sign-in normalises it`, async () => {
    const { remember, recognise } = deviceApp()
    const first = sent(await remember(`ada@example.com`))
    const second = sent(await remember(`ada@example.com`))

    const firstId = await recognise(` Ada@Example.com `, first)
    const secondId = await recognise(`ada@example.com`, second)

    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(secondId).not.toBe(firstId)
  })

  it(`names no device for a request without the cookie`, async () => {
    const { recognise } = deviceApp()

    expect(await recognise(`ada@example.com`)).toBeNull()
  })

  it(`names no device for another login's cookie`, async () => {
    const { remember, recognise } = deviceApp()
    const eve = sent(await remember(`eve@example.com`))

    expect(await recognise(`ada@example.com`, eve)).toBeNull()
  })

  it(`names no device once the login's password changed after the cookie was set`, async () => {
    const { passwords, remember, recognise } = deviceApp()
    const cookie = sent(await remember(`ada@example.com`))
    const before = await recognise(`ada@example.com`, cookie)

    passwords.set(`ada@example.com`, `second`)

    expect(before).not.toBeNull()
    expect(await recognise(`ada@example.com`, cookie)).toBeNull()
  })

  it(`names no device and sets no cookie for a login without a password`, async () => {
    const { passwords, remember, recognise } = deviceApp()
    const cookie = sent(await remember(`ada@example.com`))

    passwords.delete(`ada@example.com`)

    expect(await recognise(`ada@example.com`, cookie)).toBeNull()
    expect(await remember(`ada@example.com`)).toEqual([])
  })

  it(`names no device for a cookie whose signature was changed`, async () => {
    const { remember, recognise } = deviceApp()
    const cookie = sent(await remember(`ada@example.com`))
    // A character inside the signature, not the last one, so the token stays canonical base64url.
    const at = cookie.length - 5
    const forged = `${cookie.slice(0, at)}${cookie[at] === `A` ? `B` : `A`}${cookie.slice(at + 1)}`

    expect(await recognise(`ada@example.com`, forged)).toBeNull()
  })

  it(`names no device for a cookie signed with another secret`, async () => {
    const other = deviceApp({ cookieSecret: `another-unit-test-only-secret-0123456789` })
    const cookie = sent(await other.remember(`ada@example.com`))

    expect(await deviceApp().recognise(`ada@example.com`, cookie)).toBeNull()
  })

  it(`names its device until 180 days pass, then none`, async () => {
    const { clock, remember, recognise } = deviceApp()
    const cookie = sent(await remember(`ada@example.com`))

    clock.ms += SIGN_IN_DEVICE_TTL_MS - 1
    const before = await recognise(`ada@example.com`, cookie)
    clock.ms += 1
    const after = await recognise(`ada@example.com`, cookie)

    expect(before).not.toBeNull()
    expect(after).toBeNull()
  })

  it(`names no device for a cookie longer than a signed token may be`, async () => {
    const { recognise } = deviceApp()
    const huge = `${SIGN_IN_DEVICE_COOKIE}=${`A`.repeat(MAX_SIGNED_PAYLOAD_LENGTH)}.${
      `B`.repeat(43)
    }`

    expect(await recognise(`ada@example.com`, huge)).toBeNull()
  })
})
