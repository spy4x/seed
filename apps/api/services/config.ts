import { ATTACHMENT_UPLOAD_BUDGET } from "@domain/notes"
import { readApiEnv } from "./config-env.ts"

const env = readApiEnv()
// loadConfig names a failing variable but not the rule it broke, so this one says it outright.
if (env.AUTH_COOKIE_SECRET.length < 32) {
  throw new Error("AUTH_COOKIE_SECRET must be at least 32 characters (openssl rand -hex 32)")
}

/** A setting that is a whole number, or `fallback` when it is unset or empty. */
function wholeNumber(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${name} must be a whole number, 0 or more`)
  }
  return number
}

export class Config {
  env = env.ENV
  authCookieSecret = env.AUTH_COOKIE_SECRET
  authPepper = env.AUTH_PEPPER
  devEmail = env.DEV_EMAIL
  vapidKeysPath = "./vapid.json"
  errorReportDsn = env.ERROR_REPORT_DSN
  /** The client id and secret of each sign-in provider; one without both is off. */
  oauth = {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
  }
  timeZone = env.TIMEZONE
  authSessionDurationMin = 60 * 24 * 30 * 2 // 2 months
  /** "Try it now": one click into the app as a guest (#224). On unless `GUEST_MODE=false`. */
  guestMode = env.GUEST_MODE !== "false"
  /** What one person may upload to note attachments per hour (docs/files.md, "Upload budget"). */
  attachmentUploadBudget = {
    files: wholeNumber(
      "ATTACHMENT_UPLOAD_FILES_PER_HOUR",
      env.ATTACHMENT_UPLOAD_FILES_PER_HOUR,
      ATTACHMENT_UPLOAD_BUDGET.files,
    ),
    bytes: wholeNumber(
      "ATTACHMENT_UPLOAD_BYTES_PER_HOUR",
      env.ATTACHMENT_UPLOAD_BYTES_PER_HOUR,
      ATTACHMENT_UPLOAD_BUDGET.bytes,
    ),
  }
  rateLimiter = {
    windowMs: env.RATE_LIMITER_WINDOW_MS,
    strictLimit: env.RATE_LIMITER_STRICT_LIMIT,
    limit: env.RATE_LIMITER_LIMIT,
    otpWindowMs: env.RATE_LIMITER_OTP_WINDOW_MS,
    otpLimit: env.RATE_LIMITER_OTP_LIMIT,
  }

  // Web App Configuration
  domain = env.DOMAIN
  webAppUrl = `http${this.isDev ? "" : "s"}://${this.domain}`
  /** The admin app's host, or `null` when it is not deployed and the operator area is off. */
  adminDomain = env.ADMIN_DOMAIN || null
  adminAppUrl = this.adminDomain ? `http${this.isDev ? "" : "s"}://${this.adminDomain}` : null
  /** The proxies allowed to name the client in `X-Real-IP` (`@spy4x/server/http/trusted-proxy`). */
  proxyHosts = (env.PROXY_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean)
  /** The release this process was built from, for the operator area's System page (#429). */
  build = { version: env.APP_VERSION || null, commit: env.APP_COMMIT || null }

  /** The file store's address, bucket and key (docs/files.md). */
  files = {
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  }

  kv = {
    hostname: env.KV_HOSTNAME,
    port: env.KV_PORT,
    password: env.KV_PASSWORD,
  }

  get isDev() {
    return this.env === "dev"
  }
  get isProd() {
    return this.env === "prod"
  }
}

export const config = new Config()
