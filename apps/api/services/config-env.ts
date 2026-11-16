import { type EnvReader, loadConfig, systemEnv } from "@spy4x/server/config"
import { type } from "arktype"
import type { FileStoreSettings } from "@server/files/files.ts"
import { isFilesOn } from "@server/files/settings.ts"

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
  /** The admin app's own host; unset or empty turns the operator area off. */
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
  /** The files (docs/files.md, "Without files"): on unless `false`, which drops every `S3_*`. */
  "FILES?": "string",
  /**
   * The file store (docs/files.md). The API reaches it at S3_ENDPOINT; browsers at
   * S3_PUBLIC_ENDPOINT, the address the URLs it signs for them name. Required while files are on.
   */
  S3_ENDPOINT: HTTP_URL,
  S3_PUBLIC_ENDPOINT: HTTP_URL,
  S3_REGION: "string > 0",
  S3_BUCKET: "string > 0",
  S3_ACCESS_KEY_ID: "string > 0",
  S3_SECRET_ACCESS_KEY: "string > 0",
  /** `https://<key>@<host>/<project>` of an error tracker; unset or empty turns reporting off. */
  "ERROR_REPORT_DSN?": "string",
  /** The web push keys file (`vapidKeysPath`); unset or empty: `./vapid.json`. */
  "VAPID_KEYS_PATH?": "string",
  /** Guest accounts (docs/guests.md): on unless `false`, and off whenever `SIGN_UP=invite`. */
  "GUEST_MODE?": "string",
  /** The public demo (docs/demo.md): on only when `true`. */
  "DEMO_MODE?": "string",
  /**
   * Who may make an account (docs/deploy.md, "Who may sign up"): `open`, anyone, or `invite`, only
   * people a member invited. Unset or empty: `open`. Anything else stops the API at start.
   */
  "SIGN_UP?": "'open' | 'invite'",
  /** The SPA (docs/apps.md, "Without the SPA"): on unless `false`. */
  "SPA?": "string",
  /**
   * What one person may upload to note attachments per hour (docs/files.md, "Upload budget"):
   * whole numbers, unset or empty for 50 files and 52428800 bytes.
   */
  "ATTACHMENT_UPLOAD_FILES_PER_HOUR?": "string",
  "ATTACHMENT_UPLOAD_BYTES_PER_HOUR?": "string",
  /**
   * The operation budget (docs/architecture.md, "Operation budget"): calls per minute, whole
   * numbers, unset or empty for the defaults of `OPERATION_BUDGET`.
   */
  "OPERATION_COMMANDS_PER_MINUTE?": "string",
  "OPERATION_QUERIES_PER_MINUTE?": "string",
  "GUEST_OPERATION_COMMANDS_PER_MINUTE?": "string",
  "GUEST_OPERATION_QUERIES_PER_MINUTE?": "string",
  /** Sign-in with Google is on only when both are set (docs/sign-in-providers.md). */
  "GOOGLE_CLIENT_ID?": "string",
  "GOOGLE_CLIENT_SECRET?": "string",
  /** Sign-in with GitHub is on only when both are set. */
  "GITHUB_CLIENT_ID?": "string",
  "GITHUB_CLIENT_SECRET?": "string",
})

/** The file store's settings, which `FILES=false` leaves out. */
const S3_KEYS = [
  `S3_ENDPOINT`,
  `S3_PUBLIC_ENDPOINT`,
  `S3_REGION`,
  `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`,
] as const

/** {@link envSchema} of a server whose files are off: no `S3_*` is read or checked. */
const filesOffEnvSchema = envSchema.omit(...S3_KEYS)

/**
 * Reads and checks the API's environment. Throws a `ConfigError` naming every bad variable.
 * `files` is the file store's settings, or `null` with `FILES=false` (`isFilesOn`): then no
 * `S3_*` is needed, and none is read.
 */
export function readApiEnv(reader: EnvReader = systemEnv) {
  if (!isFilesOn(reader)) return { ...loadConfig(filesOffEnvSchema, reader), files: null }
  const {
    S3_ENDPOINT,
    S3_PUBLIC_ENDPOINT,
    S3_REGION,
    S3_BUCKET,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
    ...env
  } = loadConfig(envSchema, reader)
  const files: FileStoreSettings = {
    endpoint: S3_ENDPOINT,
    publicEndpoint: S3_PUBLIC_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  }
  return { ...env, files }
}

/**
 * Whether the SPA runs (docs/apps.md, "Without the SPA"): on unless `SPA=false`, which closes
 * every account route on every host but the admin host, sign-up among them.
 */
export function isSpaOn(env: { SPA?: string }): boolean {
  return env.SPA !== "false"
}

/**
 * Where the API reads its web push keys: `VAPID_KEYS_PATH`, or `./vapid.json` in the working
 * directory when it is unset or empty, which is where compose bind-mounts the file.
 */
export function vapidKeysPath(env: { VAPID_KEYS_PATH?: string }): string {
  return env.VAPID_KEYS_PATH || `./vapid.json`
}
