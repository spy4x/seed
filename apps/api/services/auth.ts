import { createKvOAuthFlowStore } from "@spy4x/server/auth/oauth"
import { kv } from "./cache.ts"
import { config } from "./config.ts"
import { db } from "./db.ts"
import { enabledOAuthProviders } from "./oauth-providers.ts"
import { createSignIn } from "./sign-in.ts"

/** The app's sign-in, configured from the environment. */
export const signIn = createSignIn({
  db,
  pepper: config.authPepper,
  cookieSecret: config.authCookieSecret,
  secureCookie: !config.isDev,
  sessionMinutes: config.authSessionDurationMin,
  totpIssuer: config.domain,
  guests: config.guestMode,
  oauth: {
    providers: enabledOAuthProviders(config.oauth),
    origin: config.webAppUrl,
    // In Valkey, so a flow started on one API process finishes on another.
    flows: createKvOAuthFlowStore(kv),
  },
  // The passkeys belong to the web app's host; the API answers on the same site.
  passkeys: {
    rp: {
      id: new URL(config.webAppUrl).hostname,
      name: config.domain,
      origins: [new URL(config.webAppUrl).origin],
    },
    // In Valkey, whose `take` is atomic: a challenge is answered once, on any API process.
    kv,
    log: (message) => console.warn(message),
  },
})

export const { parseAuth, isAuthenticated1FA, isAuthenticated2FA } = signIn.auth
