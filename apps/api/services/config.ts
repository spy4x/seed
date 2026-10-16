import { readApiEnv } from "./config-env.ts"

const env = readApiEnv()
// loadConfig names a failing variable but not the rule it broke, so this one says it outright.
if (env.AUTH_COOKIE_SECRET.length < 32) {
  throw new Error("AUTH_COOKIE_SECRET must be at least 32 characters (openssl rand -hex 32)")
}

export class Config {
  env = env.ENV
  authCookieSecret = env.AUTH_COOKIE_SECRET
  authPepper = env.AUTH_PEPPER
  authTotp = env.AUTH_TOTP
  devEmail = env.DEV_EMAIL
  vapidKeysPath = "./vapid.json"
  errorReportDsn = env.ERROR_REPORT_DSN
  /** The client id and secret of each sign-in provider; one without both is off. */
  oauth = {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
  }
  timeZone = env.TIMEZONE
  authSaltRounds = 12 // balance between security and performance
  authSessionLength = 32
  authSessionDurationMin = 60 * 24 * 30 * 2 // 2 months
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
  /** The release this process was built from, for the operator area's System page (#429). */
  build = { version: env.APP_VERSION || null, commit: env.APP_COMMIT || null }

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
