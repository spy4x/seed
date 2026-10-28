/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { createEnvReader } from "@spy4x/server/config"
import { isSpaOn, readApiEnv } from "./config-env.ts"

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
  S3_ENDPOINT: "http://app-garage:3900",
  S3_PUBLIC_ENDPOINT: "http://app.localhost",
  S3_REGION: "garage",
  S3_BUCKET: "app-files",
  S3_ACCESS_KEY_ID: "GK000000000000000000000000",
  S3_SECRET_ACCESS_KEY: "test-only-secret",
}

/** The file store's settings: the API refuses to start without any one of them. */
const S3_NAMES = [
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
]

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

Deno.test("the API environment is refused without each file store setting, and names it", () => {
  const withKv: Record<string, string> = { ...REQUIRED_ENV, KV_PASSWORD: `kv-secret` }

  for (const name of S3_NAMES) {
    const { [name]: _, ...without } = withKv
    expect(() => readApiEnv(createEnvReader(without)), name).toThrow(name)
    expect(() => readApiEnv(createEnvReader({ ...withKv, [name]: `` })), name).toThrow(name)
  }
})

Deno.test("the API environment refuses a file store endpoint that is not a URL", () => {
  const withKv = { ...REQUIRED_ENV, KV_PASSWORD: `kv-secret` }

  expect(() => readApiEnv(createEnvReader({ ...withKv, S3_ENDPOINT: `garage:3900` })))
    .toThrow(`S3_ENDPOINT`)
  expect(() => readApiEnv(createEnvReader({ ...withKv, S3_PUBLIC_ENDPOINT: `localhost` })))
    .toThrow(`S3_PUBLIC_ENDPOINT`)
  expect(readApiEnv(createEnvReader(withKv)).S3_BUCKET).toBe(`app-files`)
})

Deno.test("the SPA is off only when the environment sets SPA=false", () => {
  const env = (extra: Record<string, string>) =>
    readApiEnv(createEnvReader({ ...REQUIRED_ENV, KV_PASSWORD: "test-only", ...extra }))
  expect(isSpaOn(env({ SPA: "false" }))).toBe(false)
  for (const value of [undefined, "", "true", "False", "0"]) {
    expect({ value, on: isSpaOn(env(value === undefined ? {} : { SPA: value })) })
      .toEqual({ value, on: true })
  }
})
