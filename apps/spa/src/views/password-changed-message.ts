import type { Translator } from "@spy4x/platform/universal/i18n"

/** What the toast says after a password change: who was signed out and how many tokens went. */
export function passwordChangedMessage(
  t: Translator<string>,
  signedOutOthers: boolean,
  revokedTokens: number,
): string {
  return [
    signedOutOthers ? t.t(`ProfileView.othersSignedOut`) : null,
    revokedTokens > 0 ? t.t(`ProfileView.tokensRevoked`, { count: revokedTokens }) : null,
    t.t(`ProfileView.usePassword`),
  ].filter((part) => part !== null).join(` `)
}
