/**
 * The app's own words for a state module, which has no hook to read the translator with. A message
 * is translated into the page's language when the state sets it; a later language switch shows it
 * in the new language once the state sets it again.
 *
 * @module
 */
import type { MessageValues } from "@spy4x/platform/universal/i18n"
import { type ErrorAnswer, errorText, fieldText } from "@ui/message.ts"
import { languages } from "../i18n.ts"

/** The message of `key` in the `app` catalog, in the language the page shows now. */
export function appText(key: string, values?: MessageValues): string {
  return languages.translator.peek().t(key, values)
}

/**
 * What a refused call says about `field`, in the language the page shows now, or `null` when the
 * refusal names no failure of that field. A form shows it under the field (#275).
 */
export function refusedField(cause: unknown, field: string): string | null {
  const fields = cause instanceof Error ? (cause as Partial<ErrorAnswer>).fields : undefined
  const failed = fields && Object.hasOwn(fields, field) ? fields[field] : undefined
  return failed ? fieldText(languages.translator.peek(), failed) : null
}

/** A refusal of the API in the language the page shows now, translated by its code (#275). */
export function apiErrorText(error: ErrorAnswer): string {
  return errorText(languages.translator.peek(), error)
}
