import { createLastSignIn, type LastSignInStore } from "@spy4x/platform/browser/last-sign-in"
import { oauthProviderId, type SignInMethod } from "@domain/identity"
import type { LastSignInHint } from "@ui/auth-screen.tsx"
import { signInMethodsHttp } from "./sign-in-methods.ts"

/**
 * How a person last signed in on this browser (#142): the method and the address with most of it
 * hidden, in `localStorage`. The sign-in page shows it so that someone with two Google accounts
 * picks the one they used before. It is not a secret and not a session: signing out keeps it, and
 * "Not you? Forget" on the sign-in page drops it.
 */
export const lastSignIn: LastSignInStore = createLastSignIn("last-sign-in")

/** What the sign-in page shows: the remembered sign-in when its method is one this app has. */
export function lastSignInHint(store: LastSignInStore = lastSignIn): LastSignInHint | null {
  const kept = store.read()
  if (!kept) return null
  const method = kept.method === "password" || kept.method === "passkey" || kept.method === "link"
    ? kept.method
    : oauthProviderId(kept.method)
  return method === null ? null : { method, email: kept.email }
}

/**
 * Remembers the method `session` signed in with, once someone is signed in with every factor
 * done. A refused password or an unanswered one-time code remembers nothing, and asks the API
 * nothing: it lists the methods only for a finished sign-in, and marks the one the session used.
 */
export async function rememberSignIn(
  session: { user: unknown; isMfaRequired: boolean },
  list: () => Promise<{ ok: boolean; methods?: readonly SignInMethod[] }> = signInMethodsHttp.list,
  store: LastSignInStore = lastSignIn,
): Promise<void> {
  if (!session.user || session.isMfaRequired) return
  const answer = await list().catch(() => null)
  const used = answer?.methods?.find((method) => method.current)
  if (used) store.remember(used.kind, used.email)
}
