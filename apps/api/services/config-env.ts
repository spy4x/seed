import { type EnvReader, loadConfig } from "@spy4x/server/config"
import { type } from "arktype"

/** An http:// or https:// address with a host, such as `http://app-garage:3900`. */
const HTTP_URL = /^https?:\/\/\S+$/

/** The environment variables the API needs; a missing or blank one stops it from starting. */
export const envSchema = type({
  ENV: "'dev' | 'prod'",
  AUTH_COOKIE_SECRET: "string > 0",
  AUTH_PEPPER: "string > 0",
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
  /**
   * The proxies allowed to name the client in `X-Real-IP`, comma-separated: container names or IP
   * addresses. Unset or empty: this machine's loopback only (`DEFAULT_PROXY_HOSTS`).
   */
  "PROXY_HOSTS?": "string",
  /** The release tag and commit the image was built from (`apps/api/dockerfile`); empty locally. */
  "APP_VERSION?": "string",
  "APP_COMMIT?": "string",
  KV_HOSTNAME: "string > 0",
  KV_PORT: "string.integer.parse",
  KV_PASSWORD: "string > 0",
  /**
   * The file store (docs/files.md). The API reaches it at S3_ENDPOINT; browsers at
   * S3_PUBLIC_ENDPOINT, the address the URLs it signs for them name.
   */
  S3_ENDPOINT: HTTP_URL,
  S3_PUBLIC_ENDPOINT: HTTP_URL,
  S3_REGION: "string > 0",
  S3_BUCKET: "string > 0",
  S3_ACCESS_KEY_ID: "string > 0",
  S3_SECRET_ACCESS_KEY: "string > 0",
  /** `https://<key>@<host>/<project>` of an error tracker; unset or empty turns reporting off. */
  "ERROR_REPORT_DSN?": "string",
  /** Guest accounts (#224, docs/guests.md): on unless `false`. */
  "GUEST_MODE?": "string",
  /** The SPA (docs/deploy.md, "Without the SPA"): on unless `false`. */
  "SPA?": "string",
  /**
   * What one person may upload to note attachments per hour (docs/files.md, "Upload budget"):
   * whole numbers, unset or empty for 50 files and 52428800 bytes.
   */
  "ATTACHMENT_UPLOAD_FILES_PER_HOUR?": "string",
  "ATTACHMENT_UPLOAD_BYTES_PER_HOUR?": "string",
  /** Sign-in with Google is on only when both are set (docs/sign-in-providers.md). */
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

/**
 * Whether the SPA runs (docs/deploy.md, "Without the SPA"): on unless `SPA=false`, which closes
 * every account route on every host but the admin host, sign-up among them.
 */
export function isSpaOn(env: { SPA?: string }): boolean {
  return env.SPA !== "false"
}
