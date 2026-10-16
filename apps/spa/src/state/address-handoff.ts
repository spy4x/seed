/**
 * An address one page hands the next (#142): "Sign in instead" and "Forgot your password?" after a
 * sign-up found an account, and "Use a different address" back to the sign-up form. It lives in
 * memory only, never in the URL, so it reaches no log, history entry or referrer, and the page that
 * takes it takes it once.
 */

let handed: string | null = null

/** Hands `email` to the next page that asks. */
export function handOffAddress(email: string): void {
  handed = email
}

/** The address handed over, once; `null` when none was, or it was already taken. */
export function takeHandedOffAddress(): string | null {
  const email = handed
  handed = null
  return email
}
