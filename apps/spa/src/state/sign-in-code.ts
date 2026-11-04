/**
 * The sign-in code this tab asked for last (#391, #752): the address and when, in `sessionStorage`,
 * so a reload of the code step keeps the wait before a new code. It lives as long as the tab and
 * never leaves the browser. The server's cookie decides whether a code still waits; blocked
 * storage only loses the wait.
 */
export interface SentCode {
  email: string
  /** When the code was asked for, in milliseconds since the epoch. */
  sentAt: number
}

const SENT_CODE = "sign-in-code:sent"

/** Keeps the code just asked for. */
export function rememberSentCode(sent: SentCode): void {
  try {
    globalThis.sessionStorage?.setItem(SENT_CODE, JSON.stringify(sent))
  } catch (_blocked) {
    // Nothing kept: a reload loses only the wait.
  }
}

/** The code this tab asked for last, or `null`. */
export function readSentCode(): SentCode | null {
  try {
    const value = JSON.parse(globalThis.sessionStorage?.getItem(SENT_CODE) ?? "null")
    return typeof value?.email === "string" && typeof value?.sentAt === "number" ? value : null
  } catch (_blocked) {
    return null
  }
}

/** Forgets the code: "Use a different one", or a code was used. */
export function forgetSentCode(): void {
  try {
    globalThis.sessionStorage?.removeItem(SENT_CODE)
  } catch (_blocked) {
    // Nothing to forget.
  }
}
