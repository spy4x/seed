/** What the toast says after a password change: who was signed out and how many tokens went. */
export function passwordChangedMessage(signedOutOthers: boolean, revokedTokens: number): string {
  return [
    signedOutOthers ? `Every other device was signed out.` : null,
    revokedTokens === 1 ? `Your API token was revoked.` : null,
    revokedTokens > 1 ? `Your ${revokedTokens} API tokens were revoked.` : null,
    `Use the new password next time you sign in.`,
  ].filter((part) => part !== null).join(` `)
}
