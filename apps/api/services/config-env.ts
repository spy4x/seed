import { type EnvReader, loadConfig } from "@spy4x/server/config"
import { type } from "arktype"

/** The environment variables the API needs; a missing or blank one stops it from starting. */
export const envSchema = type({
  ENV: "'dev' | 'prod'",
  AUTH_COOKIE_SECRET: "string > 0",
  AUTH_PEPPER: "string > 0",
  AUTH_TOTP: "string > 0",
  DEV_EMAIL: "string > 0",
  TIMEZONE: "string > 0",
  RATE_LIMITER_WINDOW_MS: "string.integer.parse",
  RATE_LIMITER_STRICT_LIMIT: "string.integer.parse",
  RATE_LIMITER_LIMIT: "string.integer.parse",
  RATE_LIMITER_OTP_WINDOW_MS: "string.integer.parse",
  RATE_LIMITER_OTP_LIMIT: "string.integer.parse",
  DOMAIN: "string > 0",
  /** The admin app's own host (#146); unset or empty turns the operator area off. */
  "ADMIN_DOMAIN?": "string",
  /** The release tag and commit the image was built from (`apps/api/dockerfile`); empty locally. */
  "APP_VERSION?": "string",
  "APP_COMMIT?": "string",
  KV_HOSTNAME: "string > 0",
  KV_PORT: "string.integer.parse",
  KV_PASSWORD: "string > 0",
  /** `https://<key>@<host>/<project>` of an error tracker; unset or empty turns reporting off. */
  "ERROR_REPORT_DSN?": "string",
  /** Sign-in with Google is on only when both are set (README, "Sign in with Google and GitHub"). */
  "GOOGLE_CLIENT_ID?": "string",
  "GOOGLE_CLIENT_SECRET?": "string",
  /** Sign-in with GitHub is on only when both are set. */
  "GITHUB_CLIENT_ID?": "string",
  "GITHUB_CLIENT_SECRET?": "string",
})

/** Reads and checks the API's environment. Throws a `ConfigError` naming every bad variable. */
export function readApiEnv(reader?: EnvReader) {
  return loadConfig(envSchema, reader)
}
