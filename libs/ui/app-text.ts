/**
 * Text an app state module hands a screen (#275). A state module has no translator, so it names
 * its own words by their key in the `app` catalog; the screen translates them. A plain string is
 * the server's own words, shown as they came until the errors catalog translates its codes.
 *
 * @module
 */
import type { MessageValues, Translator } from "@spy4x/platform/universal/i18n"
import type { OAuthNotice } from "@domain/identity"

/** The app's own words: a key of the `app` catalog and the values its message names. */
export interface AppText {
  key: string
  values?: MessageValues
}

/** A message for a screen: the server's words as they came, or the app's own by key. */
export type Said = string | AppText

/** The message in the person's language: the app's own words translated, the server's as they are. */
export function say(t: Translator<string>, said: Said): string {
  return typeof said === `string` ? said : t.t(said.key, said.values)
}

/** What each provider sign-in notice (`?oauth=`) says, by its key in `app`. */
export const OAUTH_NOTICE_KEYS: Record<OAuthNotice, string> = {
  failed: `OAuthNotice.failed`,
  linked: `OAuthNotice.linked`,
  "link-exists": `OAuthNotice.linkExists`,
  "link-taken": `OAuthNotice.linkTaken`,
  busy: `OAuthNotice.busy`,
  kept: `OAuthNotice.kept`,
  "guest-taken": `OAuthNotice.guestTaken`,
}
