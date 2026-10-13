/**
 * Whether a provider sign-in still confirms what an account with no password cannot give a
 * password for. `until` is the time the server said it does so, or `null` when it does not.
 */
export function isProviderProofFresh(until: string | null, now: number = Date.now()): boolean {
  return until !== null && Date.parse(until) > now
}
