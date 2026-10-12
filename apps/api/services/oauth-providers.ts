import type { OAuthProviderConfig } from "@spy4x/server/auth/oauth"
import { createGitHubOAuthProvider } from "@spy4x/server/auth/oauth-github"
import { createGoogleOAuthProvider } from "@spy4x/server/auth/oauth-google"
import type { OAuthProviderId } from "@domain/identity"

/** What the environment holds for one provider. Unset and empty both mean "not given". */
export interface OAuthCredentials {
  clientId?: string
  clientSecret?: string
}

const FACTORIES: Record<
  OAuthProviderId,
  (credentials: { clientId: string; clientSecret: string }) => OAuthProviderConfig
> = {
  google: createGoogleOAuthProvider,
  github: createGitHubOAuthProvider,
}

/**
 * The sign-in providers that are on: those given both a client id and a client secret. One with
 * only half is off, as one with neither is, so a half-filled `.env` shows no button that fails.
 */
export function enabledOAuthProviders(
  credentials: Partial<Record<OAuthProviderId, OAuthCredentials>>,
): OAuthProviderConfig[] {
  const providers: OAuthProviderConfig[] = []
  for (const id of Object.keys(FACTORIES) as OAuthProviderId[]) {
    const clientId = credentials[id]?.clientId?.trim()
    const clientSecret = credentials[id]?.clientSecret?.trim()
    if (clientId && clientSecret) providers.push(FACTORIES[id]({ clientId, clientSecret }))
  }
  return providers
}
