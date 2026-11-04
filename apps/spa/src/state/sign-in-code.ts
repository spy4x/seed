/**
 * The sign-in or sign-up code this tab asked for last (#391, #752): the address and when, in
 * `sessionStorage`, so a reload of the code step keeps the wait before a new code. It lives as long as the tab and
 * never leaves the browser. The server's cookie decides whether a code still waits; blocked
 * storage only loses the wait.
 */
export interface SentCode {
  email: string
  /** When the code was asked for, in milliseconds since the epoch. */
  sentAt: number
}

/** Which code step the code is for: each keeps its own. */
export type CodeKind = "sign-in" | "sign-up"

const key = (kind: CodeKind) => `${kind}-code:sent`

/** Keeps the code just asked for. */
export function rememberSentCode(sent: SentCode, kind: CodeKind = "sign-in"): void {
  try {
    globalThis.sessionStorage?.setItem(key(kind), JSON.stringify(sent))
  } catch (_blocked) {
    // Nothing kept: a reload loses only the wait.
  }
}

/** The code this tab asked for last, or `null`. */
export function readSentCode(kind: CodeKind = "sign-in"): SentCode | null {
  try {
    const value = JSON.parse(globalThis.sessionStorage?.getItem(key(kind)) ?? "null")
    return typeof value?.email === "string" && typeof value?.sentAt === "number" ? value : null
  } catch (_blocked) {
    return null
  }
}

/** Forgets the code: "Use a different one", or a code was used. */
export function forgetSentCode(kind: CodeKind = "sign-in"): void {
  try {
    globalThis.sessionStorage?.removeItem(key(kind))
  } catch (_blocked) {
    // Nothing to forget.
  }
}

/**
 * The tab's record of the code the server says waits for `email`: the kept one when it names that
 * address, as typed or as the server keeps it, otherwise one sent long ago, so a new code is
 * offered at once.
 */
export function sentCodeFor(kept: SentCode | null, email: string): SentCode {
  const same = (address: string) => address.trim().toLowerCase()
  return kept && same(kept.email) === same(email)
    ? { email, sentAt: kept.sentAt }
    : { email, sentAt: 0 }
}
