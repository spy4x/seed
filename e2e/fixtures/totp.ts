import { type APIRequestContext, expect } from "@playwright/test"

const STEP_SECONDS = 30
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

/** The one-time code (RFC 6238: SHA-1, six digits, 30-second steps) for `secret` at `step`. */
export async function totpCode(secret: string, step: number): Promise<string> {
  let bits = ""
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, "0")
  }
  const key = new Uint8Array((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)))
  const counter = new Uint8Array(8)
  new DataView(counter.buffer).setBigUint64(0, BigInt(step))
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  )
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, counter))
  const offset = hmac[hmac.length - 1] & 0x0f
  const value = new DataView(hmac.buffer).getUint32(offset) & 0x7fffffff
  return String(value % 1_000_000).padStart(6, "0")
}

/** The 30-second step the clock is in now. */
export const currentStep = (): number => Math.floor(Date.now() / 1000 / STEP_SECONDS)

/**
 * Turns two-factor sign-in on for the account `api` is signed in as, through the API: connects an
 * authenticator app, confirmed with the account's `password` (#406). Two-factor needs a proven
 * address, which sign-up's code proved (#142). `base` is the app's origin, which the API's
 * same-origin check compares.
 * Returns the app's secret and the step its enrolment code used, which the server will not accept
 * again.
 */
export async function enrolTotp(
  api: APIRequestContext,
  base: string,
  password: string,
): Promise<{ secret: string; enrolStep: number }> {
  const headers = { origin: base, "sec-fetch-site": "same-origin" }
  const started = await api.post(`${base}/api/auth/totp/connect/start`, {
    headers,
    data: { password },
  })
  expect(started.ok(), await started.text()).toBe(true)
  const { secret } = (await started.json()) as { secret: string }
  const enrolStep = currentStep()
  const finished = await api.post(`${base}/api/auth/totp/connect/finish`, {
    headers,
    data: { otp: await totpCode(secret, enrolStep) },
  })
  expect(finished.ok(), await finished.text()).toBe(true)
  return { secret, enrolStep }
}
