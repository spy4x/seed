// deno-lint-ignore-file ui-text/no-literal
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
import { SCREEN_PATHS, withNext } from "./progressive.tsx"

/**
 * What an account with no password confirms a step with, where the others type their password:
 * a sign-in with one of its providers or passkeys a moment ago.
 */
export interface ProviderProof {
  /** The providers the account signs in with. */
  providers: readonly OAuthProviderId[]
  /** The account has a passkey (#222). */
  passkeys?: boolean
  /** A sign-in link reaches the account: it has a proven address (#391). */
  emailLink?: boolean
  /** This device signed in with one of them less than `PROVIDER_PROOF_MINUTES` minutes ago. */
  fresh: boolean
  /**
   * Signs in again with a passkey without leaving the page. Left out, the notice offers no passkey
   * button, and the person signs in again from the sign-in page.
   */
  onPasskey?: () => void
  /** That sign-in is running: the passkey button waits. */
  passkeyPending?: boolean
}

/**
 * The proof an account with these sign-in methods confirms with, or `null` for an account that
 * has a password, or while the methods are not known. `emailLink` says a sign-in link reaches the
 * account, which then needs no linked method at all: one made by a link has none (#391).
 */
export function providerProofOf(
  methods: readonly SignInMethod[] | null | undefined,
  fresh: boolean,
  emailLink = false,
): ProviderProof | null {
  if (!methods || (methods.length === 0 && !emailLink)) return null
  const providers: OAuthProviderId[] = []
  let passkeys = false
  for (const { kind } of methods) {
    if (kind === "password") return null
    if (kind === "passkey") passkeys = true
    else providers.push(kind)
  }
  return emailLink ? { providers, passkeys, emailLink, fresh } : { providers, passkeys, fresh }
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
  if (proof.passkeys) names.push("a passkey")
  if (proof.emailLink) names.push("a sign-in link")
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
        {proof.passkeys && proof.onPasskey && (
          <Button
            type="button"
            variant="secondary"
            busy={proof.passkeyPending}
            busyLabel="Waiting for your device…"
            onClick={proof.onPasskey}
            data-e2e="provider-proof-passkey"
          >
            Sign in with a passkey again
          </Button>
        )}
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
        {proof.emailLink && (
          // A plain link: the link's page reloads into the app once used.
          <Button
            href={withNext(SCREEN_PATHS.signInLink, next)}
            variant="secondary"
            data-e2e="provider-proof-link"
          >
            Email me a sign-in link
          </Button>
        )}
      </Cluster>
    </Stack>
  )
}
