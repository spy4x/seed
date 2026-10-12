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
  oauth: {
    providers: enabledOAuthProviders(config.oauth),
    origin: config.webAppUrl,
    // In Valkey, so a flow started on one API process finishes on another.
    flows: createKvOAuthFlowStore(kv),
  },
})

export const { parseAuth, isAuthenticated1FA, isAuthenticated2FA } = signIn.auth
