/**
 * The words a store or a state module hands a screen (#275), and the API's refusals in the
 * person's language. A store has no translator, so it names a message of the `app` catalog instead
 * of writing the sentence: the key alone, or the key with its values. The screen translates it in
 * the person's language. Text that is no key, such as the API's own message, is shown as it came.
 *
 * @module
 */
import {
  createTranslator,
  type MessageValues,
  type Translator,
} from "@spy4x/platform/universal/i18n"
import type { FieldError, FieldErrors } from "@spy4x/validation"
import type { OAuthNotice } from "@domain/identity"
import app from "@i18n/app/en.json" with { type: "json" }
import errors from "@i18n/errors/en.json" with { type: "json" }

/** A message key of the `app` catalog with the values its sentence names. */
export interface KeyedMessage {
  key: string
  values?: MessageValues
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

/** `message` in the translator's language, or an empty string for none. */
export function say(t: Translator<string>, message: Message): string {
  return messageText(t, message) ?? ``
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

let english: Translator<string> | undefined

/**
 * `key` of the `app` catalog in English, whatever the person's language: for search aliases, so a
 * person who types the English word still finds the entry, and for a string a screen without a
 * translator shows.
 */
export function englishText(key: string, values?: MessageValues): string {
  english ??= createTranslator({ language: `en`, catalogs: [{ source: app }] })
  return english.t(key, values)
}

/**
 * What a refusal of the API says, on any transport (`docs/api-errors.md`): an `apiFetch` error, a
 * `RealtimeRequestError` and a body `readApiError` read all have this shape.
 */
export interface ErrorAnswer {
  /** The server's English sentence: shown when nothing finer is known ({@link errorText}). */
  message: string
  /** One of the eight protocol codes; absent for a body that is not the API's, such as a proxy's. */
  code?: string
  /** The HTTP status, when the answer came over HTTP. */
  status?: number
  /** The feature's finer name for the refusal, such as `GROUP_NOT_FOUND`. */
  reason?: string
  /** Each failed field's code and rule, by path. */
  fields?: FieldErrors
}

/** Whether the `errors` catalog has `key`. Its English is the source every language follows. */
export function known(key: string): boolean {
  return Object.hasOwn(errors, key)
}

/**
 * The text of one failed field in the translator's language: `Field.<code>` of the `errors`
 * catalog with the rule filled in, or a plain "not valid" for a code the catalog lacks. A numeric
 * rule is also the plural count, so "at most 1 character" and "at most 5 characters" both read
 * right.
 */
export function fieldText(t: Translator<string>, field: FieldError): string {
  const { code, values = {} } = field
  const rule = values.rule
  // A string that must not be empty fails `minLength` 1: say "fill this in", not "1 character".
  if (code === `minLength` && rule === 1) return t.t(`Field.required`)
  const exclusive = values.exclusive === true && (code === `min` || code === `max`)
  const key = `Field.${code}${exclusive ? `Exclusive` : ``}`
  if (!known(key)) return t.t(`Field.invalid`)
  const filled: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== `boolean`) filled[name] = value
  }
  if (typeof rule === `number`) filled.count = rule
  return t.t(key, filled)
}

/** Each failed field's text by its path; an empty record for none. */
export function fieldTexts(
  t: Translator<string>,
  fields: FieldErrors | undefined,
): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const [path, field] of Object.entries(fields ?? {})) texts[path] = fieldText(t, field)
  return texts
}

/** The protocol code of an answer that is not the API's own, such as a proxy's page. */
const STATUS_CODES: Readonly<Record<number, string>> = {
  400: `bad_request`,
  401: `unauthorized`,
  403: `forbidden`,
  404: `not_found`,
  408: `timeout`,
  409: `conflict`,
  429: `rate_limited`,
  504: `timeout`,
}

function codeOf(error: ErrorAnswer): string | null {
  if (error.code !== undefined) return error.code
  if (error.status === undefined) return null
  return STATUS_CODES[error.status] ?? (error.status >= 500 ? `internal` : null)
}

/**
 * A refusal in the translator's language. The first failed field says what to fix when the answer
 * names one; else the text of its `reason`; else the general sentence of its code. In English, a
 * refusal with neither a field nor a known reason keeps the server's own `message`, which often
 * says more than its code, unless the server failed (`internal`, `timeout`), whose message names
 * nothing. Every part is plain text: a screen renders it as text, never as markup.
 */
export function errorText(t: Translator<string>, error: ErrorAnswer): string {
  const [first] = Object.values(error.fields ?? {})
  if (first) return fieldText(t, first)
  if (error.reason !== undefined && known(`Reason.${error.reason}`)) {
    return t.t(`Reason.${error.reason}`)
  }
  const code = codeOf(error)
  const general = t.language !== `en` || code === `internal` || code === `timeout`
  return general && code !== null && known(`Code.${code}`) ? t.t(`Code.${code}`) : error.message
}

/** `error` with its `message` in the translator's language ({@link errorText}). */
export function translatedError<E extends ErrorAnswer>(t: Translator<string>, error: E): E {
  return { ...error, message: errorText(t, error) }
}
