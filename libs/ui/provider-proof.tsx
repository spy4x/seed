import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import {
  OAUTH_PROVIDER_NAMES,
  type OAuthProviderId,
  PROVIDER_PROOF_MINUTES,
  type SignInMethod,
} from "@domain/identity"
import { providerStartPath } from "./auth-screen.tsx"

/**
 * What an account with no password confirms a step with, where the others type their password:
 * a sign-in with one of its providers a moment ago.
 */
export interface ProviderProof {
  /** The providers the account signs in with. */
  providers: readonly OAuthProviderId[]
  /** This device signed in with one of them less than `PROVIDER_PROOF_MINUTES` minutes ago. */
  fresh: boolean
}

/**
 * The proof an account with these sign-in methods confirms with, or `null` for an account that
 * has a password, or while the methods are not known.
 */
export function providerProofOf(
  methods: readonly SignInMethod[] | null | undefined,
  fresh: boolean,
): ProviderProof | null {
  if (!methods || methods.length === 0) return null
  const providers: OAuthProviderId[] = []
  for (const { kind } of methods) {
    if (kind === "password") return null
    providers.push(kind)
  }
  return { providers, fresh }
}

/**
 * Stands where a dialog would ask for the password. After a sign-in a moment ago it says that no
 * password is needed. Otherwise it sends the person to the provider to sign in again, with `next`
 * as the page to come back to; each link is a plain one, because the browser must leave the app.
 */
export function ProviderProofNotice(
  { proof, next }: { proof: ProviderProof; next: string },
): JSX.Element {
  const names = proof.providers.map((provider) => OAUTH_PROVIDER_NAMES[provider])
  if (proof.fresh) {
    return (
      <p class="text-sm text-muted" data-e2e="provider-proof-fresh">
        You signed in with {names.join(" or ")} a moment ago, so no password is asked.
      </p>
    )
  }
  return (
    <Stack gap="sm" data-e2e="provider-proof-needed">
      <p class="text-sm">
        This account has no password to confirm this with. Sign in with {names.join(" or ")}{" "}
        again, then come back here within {PROVIDER_PROOF_MINUTES} minutes.
      </p>
      <Cluster>
        {proof.providers.map((provider) => (
          <Button
            key={provider}
            href={providerStartPath(provider, next)}
            variant="secondary"
            data-e2e={`provider-proof-${provider}`}
          >
            Sign in with {OAUTH_PROVIDER_NAMES[provider]} again
          </Button>
        ))}
      </Cluster>
    </Stack>
  )
}
