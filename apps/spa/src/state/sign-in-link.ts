/**
 * The sign-in link this tab asked for last (#391): the address and when, in `sessionStorage`, so a
 * reload of "Check your inbox" keeps the address and the wait before a new link. It lives as long
 * as the tab and never leaves the browser. Blocked storage keeps nothing: the page then shows the
 * form again after a reload.
 */
export interface SentLink {
  email: string
  /** When the link was asked for, in milliseconds since the epoch. */
  sentAt: number
}

const SENT_LINK = "sign-in-link:sent"

/** Keeps the link just asked for. */
export function rememberSentLink(sent: SentLink): void {
  try {
    globalThis.sessionStorage?.setItem(SENT_LINK, JSON.stringify(sent))
  } catch (_blocked) {
    // Nothing kept: a reload shows the form.
  }
}

/** The link this tab asked for last, or `null`. */
export function readSentLink(): SentLink | null {
  try {
    const value = JSON.parse(globalThis.sessionStorage?.getItem(SENT_LINK) ?? "null")
    return typeof value?.email === "string" && typeof value?.sentAt === "number" ? value : null
  } catch (_blocked) {
    return null
  }
}

/** Forgets the link: "Use a different address", or a link was used. */
export function forgetSentLink(): void {
  try {
    globalThis.sessionStorage?.removeItem(SENT_LINK)
  } catch (_blocked) {
    // Nothing to forget.
  }
}
