/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { createEnvReader } from "@spy4x/server/config"
import { readApiEnv } from "./config-env.ts"

const REQUIRED_ENV: Record<string, string> = {
  ENV: "dev",
  AUTH_COOKIE_SECRET: "test-only-cookie-secret-0123456789abcdef",
  AUTH_PEPPER: "test-only-pepper-0123456789abcdef",
  DEV_EMAIL: "dev@example.test",
  TIMEZONE: "UTC",
  RATE_LIMITER_WINDOW_MS: "1000",
  RATE_LIMITER_STRICT_LIMIT: "10",
  RATE_LIMITER_LIMIT: "10",
  RATE_LIMITER_OTP_WINDOW_MS: "1000",
  RATE_LIMITER_OTP_LIMIT: "10",
  DOMAIN: "app.localhost",
  KV_HOSTNAME: "kv",
  KV_PORT: "6379",
}

Deno.test("the API environment is refused without KV_PASSWORD, and the error names it", () => {
  expect(() => readApiEnv(createEnvReader(REQUIRED_ENV))).toThrow(`KV_PASSWORD`)
})

Deno.test("the API environment is refused when KV_PASSWORD is blank", () => {
  expect(() => readApiEnv(createEnvReader({ ...REQUIRED_ENV, KV_PASSWORD: `` }))).toThrow(
    `KV_PASSWORD`,
  )
})

Deno.test("the API environment carries KV_PASSWORD through", () => {
  const env = readApiEnv(createEnvReader({ ...REQUIRED_ENV, KV_PASSWORD: `a-test-password` }))
  expect(env.KV_PASSWORD).toBe(`a-test-password`)
})

Deno.test("the API environment starts without ERROR_REPORT_DSN and carries it through when set", () => {
  const withKv = { ...REQUIRED_ENV, KV_PASSWORD: `kv-secret` }

  expect(readApiEnv(createEnvReader(withKv)).ERROR_REPORT_DSN).toBeUndefined()
  expect(readApiEnv(createEnvReader({ ...withKv, ERROR_REPORT_DSN: `` })).ERROR_REPORT_DSN)
    .toBeUndefined()
  expect(
    readApiEnv(createEnvReader({ ...withKv, ERROR_REPORT_DSN: `https://k@e.example/1` }))
      .ERROR_REPORT_DSN,
  ).toBe(`https://k@e.example/1`)
})

Deno.test("the API environment starts without any sign-in provider and carries one through when set", () => {
  const withKv = { ...REQUIRED_ENV, KV_PASSWORD: `kv-secret` }

  const none = readApiEnv(createEnvReader(withKv))
  expect([none.GOOGLE_CLIENT_ID, none.GOOGLE_CLIENT_SECRET]).toEqual([undefined, undefined])
  expect([none.GITHUB_CLIENT_ID, none.GITHUB_CLIENT_SECRET]).toEqual([undefined, undefined])
  const set = readApiEnv(createEnvReader({
    ...withKv,
    GOOGLE_CLIENT_ID: `g-id`,
    GOOGLE_CLIENT_SECRET: `g-secret`,
    GITHUB_CLIENT_ID: `h-id`,
    GITHUB_CLIENT_SECRET: `h-secret`,
  }))
  expect([set.GOOGLE_CLIENT_ID, set.GOOGLE_CLIENT_SECRET]).toEqual([`g-id`, `g-secret`])
  expect([set.GITHUB_CLIENT_ID, set.GITHUB_CLIENT_SECRET]).toEqual([`h-id`, `h-secret`])
})
