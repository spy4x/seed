/**
 * The words a store hands a screen (#275). A store has no translator, so it names a message of the
 * `app` catalog instead of writing the sentence: the key alone, or the key with its values. The
 * screen translates it in the person's language. Text that is no key, such as the API's own
 * message, is shown as it came.
 *
 * @module
 */
import { createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.json" with { type: "json" }

/** A message key of the `app` catalog with the values its sentence names. */
export interface KeyedMessage {
  key: string
  values?: Record<string, string | number>
}

/** A store's words: a key, a key with its values, or the API's text as it came. */
export type Message = string | KeyedMessage

/** `message` in the translator's language; `null` for no message. */
export function messageText(
  t: Translator<string>,
  message: Message | null | undefined,
): string | null {
  if (message === null || message === undefined || message === ``) return null
  return typeof message === `string` ? t.t(message) : t.t(message.key, message.values)
}

let english: Translator<string> | undefined

/**
 * `key` of the `app` catalog in English, whatever the person's language: for search aliases, so a
 * person who types the English word still finds the entry, and for a string a screen without a
 * translator shows.
 */
export function englishText(key: string, values?: Record<string, string | number>): string {
  english ??= createTranslator({ language: `en`, catalogs: [{ source: app }] })
  return english.t(key, values)
}
