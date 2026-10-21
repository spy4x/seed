import { supportsPasskeys } from "@spy4x/platform/browser/passkey"
import type { ProviderProof } from "@ui/provider-proof.tsx"
import type { SignInMethodsStore } from "../state/sign-in-methods.ts"

/**
 * Whether a provider sign-in still confirms what an account with no password cannot give a
 * password for. `until` is the time the server said it does so, or `null` when it does not.
 */
export function isProviderProofFresh(until: string | null, now: number = Date.now()): boolean {
  return until !== null && Date.parse(until) > now
}

/**
 * `proof` with a passkey button (#222) when the account has a passkey and this browser can use
 * one: it signs in again on the spot, through the methods store, instead of on the sign-in page.
 */
export function withPasskeyProof(
  proof: ProviderProof | null,
  methods: Pick<SignInMethodsStore, "confirmWithPasskey" | "pending">,
  supported: boolean = supportsPasskeys(),
): ProviderProof | null {
  if (!proof?.passkeys || !supported) return proof
  return {
    ...proof,
    onPasskey: () => void methods.confirmWithPasskey(),
    passkeyPending: methods.pending.value,
  }
}
