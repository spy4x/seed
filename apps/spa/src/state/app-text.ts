/**
 * The app's own words for a state module, which has no hook to read the translator with. A message
 * is translated into the page's language when the state sets it; a later language switch shows it
 * in the new language once the state sets it again.
 *
 * @module
 */
import type { MessageValues } from "@spy4x/platform/universal/i18n"
import { languages } from "../i18n.ts"

/** The message of `key` in the `app` catalog, in the language the page shows now. */
export function appText(key: string, values?: MessageValues): string {
  return languages.translator.peek().t(key, values)
}
