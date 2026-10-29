import { type } from "arktype"
import {
  ADMIN_SEARCH_MAX_LENGTH,
  type AdminDailyCount,
  type AdminStatChange,
  EMAIL_INPUT_MAX_LENGTH,
  isLanguage,
  type Language,
  LANGUAGES,
} from "@domain/identity"

/**
 * The mailing lists a visitor may join. A list is a plain string: every subscriber row, send log
 * row and token secret is scoped to one. Add a list here and it is open to subscribe to.
 */
export const SUBSCRIBER_LISTS = [`news`] as const
export type SubscriberList = typeof SUBSCRIBER_LISTS[number]

/** The list a subscribe form joins when it names none. */
export const DEFAULT_SUBSCRIBER_LIST: SubscriberList = `news`

/** Whether `value` names one of {@link SUBSCRIBER_LISTS}. */
export function isSubscriberList(value: unknown): value is SubscriberList {
  return SUBSCRIBER_LISTS.includes(value as SubscriberList)
}

/** Longest token a link or form may carry. A real one is a few hundred characters. */
export const SUBSCRIBER_TOKEN_MAX_LENGTH = 2048

/**
 * The language of the page a subscribe or confirm request came from (#527), one the apps ship:
 * the mails to the address are written in it. Left out, they are in the product's main language.
 */
const pageLanguage = { "language?": type.enumerated(...LANGUAGES) } as const

/** The body of a subscribe request: the address to confirm, the list to join, the page's language. */
export const subscribeSchema = type({
  email: `string <= ${EMAIL_INPUT_MAX_LENGTH}`,
  list: `string <= 64`,
  ...pageLanguage,
})
export type Subscribe = typeof subscribeSchema.infer

/** The fields of the unsubscribe form: the list and the token from the unsubscribe link. */
export const unsubscribeSchema = type({
  list: `string <= 64`,
  token: `string <= ${SUBSCRIBER_TOKEN_MAX_LENGTH}`,
})
export type Unsubscribe = typeof unsubscribeSchema.infer

/**
 * The body of a confirm: the list and the token from the confirm link, and the language of the
 * page it was confirmed on, which the subscriber keeps.
 */
export const subscriptionConfirmSchema = unsubscribeSchema.and(pageLanguage)
export type SubscriptionConfirm = typeof subscriptionConfirmSchema.infer

/**
 * What a confirm link page shows. `confirm` asks for the click; `done` follows it. `expired` and
 * `invalid` say why the link no longer works; `error` is a failure on our side.
 */
export type SubscriptionConfirmState = `confirm` | `done` | `expired` | `invalid` | `error`

/** What an unsubscribe link page shows, the same way. */
export type UnsubscribeState = `confirm` | `done` | `not-recognised` | `error`

/**
 * The states a token route answers as an error, carried as its `reason`: the link is malformed,
 * expired or not one of ours, or the link was used too often.
 */
export type SubscriberTokenRefusal = `invalid` | `expired` | `not-recognised` | `limited`

// The newsletter module of the operator area (#428): `/api/admin/newsletter/...`.

/** How many subscribers one page of the operator's list holds. */
export const ADMIN_SUBSCRIBERS_PAGE_SIZE = 25

/** How many sent issues the operator's list shows, newest first. */
export const ADMIN_NEWSLETTER_SENDS_LIMIT = 100

/**
 * Where an address on the operator's list stands. `confirmed` is on the list and gets every
 * issue. `pending` asked to join and its confirm mail is still queued. Nothing else is stored: an
 * unconfirmed address is forgotten once its confirm mail leaves, and an address that unsubscribes
 * is deleted at once, leaving only a keyed mark that names no address.
 */
export type AdminSubscriberStatus = `confirmed` | `pending`

/** The status filter of the operator's list: one status, or both. */
export type AdminSubscriberStatusFilter = `any` | AdminSubscriberStatus

/** One address on the operator's list. Dates are ISO 8601. */
export interface AdminSubscriberRow {
  email: string
  status: AdminSubscriberStatus
  /** When the newest queued confirm mail was asked for; `null` once the address confirmed. */
  requestedAt: string | null
  /** When the address confirmed; `null` while it is pending. */
  confirmedAt: string | null
  /**
   * The language its mails are written in (#527): the page it signed up on. One with none counts as
   * the main language's.
   */
  language: Language
}

/**
 * What the operator's list shows: a search in the address, a status, a language (`any`: every one)
 * and a page.
 */
export interface AdminSubscriberFilter {
  query: string
  status: AdminSubscriberStatusFilter
  language: Language | `any`
  page: number
}

/** The list with nothing filtered: everyone, first page. */
export const ADMIN_SUBSCRIBERS_NO_FILTER: AdminSubscriberFilter = {
  query: ``,
  status: `any`,
  language: `any`,
  page: 1,
}

/**
 * Reads the filter from a query string (`q`, `status`, `language`, `page`); anything unusable is the
 * default.
 */
export function parseAdminSubscriberFilter(params: URLSearchParams): AdminSubscriberFilter {
  const query = (params.get(`q`) ?? ``).trim().slice(0, ADMIN_SEARCH_MAX_LENGTH)
  const rawStatus = params.get(`status`)
  const status: AdminSubscriberStatusFilter = rawStatus === `confirmed` || rawStatus === `pending`
    ? rawStatus
    : `any`
  const rawLanguage = params.get(`language`)
  const language = isLanguage(rawLanguage) ? rawLanguage : `any`
  const pageNumber = Number(params.get(`page`))
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 100_000
    ? pageNumber
    : 1
  return { query, status, language, page }
}

/** The query string of `filter`, leaving out every part at its default. No leading `?`. */
export function adminSubscriberFilterQuery(filter: AdminSubscriberFilter): string {
  const params = new URLSearchParams()
  if (filter.query !== ``) params.set(`q`, filter.query)
  if (filter.status !== `any`) params.set(`status`, filter.status)
  if (filter.language !== `any`) params.set(`language`, filter.language)
  if (filter.page !== 1) params.set(`page`, String(filter.page))
  return params.toString()
}

/** The answer of `POST /api/admin/newsletter/subscribers/search`. */
export interface AdminSubscriberListResponse {
  subscribers: AdminSubscriberRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * The answer of `GET /api/admin/newsletter/stats`. Counts only. Growth counts the addresses still
 * on the list by the day they confirmed: one that left since is not counted on any day.
 */
export interface AdminNewsletterStats {
  /** When the numbers were read. ISO 8601. */
  generatedAt: string
  confirmed: number
  pending: number
  /** Addresses that confirmed in the last 30 days, and in the 30 days before. */
  joined: AdminStatChange
  /** The list's size at the end of each UTC day, oldest first, 30 days ending today. */
  subscribersPerDay: AdminDailyCount[]
  /** Issues sent to the list, finished or not. */
  issues: number
}

/** One issue the list was sent, from the send log. */
export interface AdminNewsletterSend {
  /** The issue's id, as `deno task subscribers:send` named it. */
  issue: string
  subject: string
  /** ISO 8601. */
  startedAt: string
  /** `null` while the send runs, and after a send that ended with failures until a rerun. */
  completedAt: string | null
  /** How many addresses the issue was meant for; `null` on a log entry older than that count. */
  recipients: number | null
  /** Mails delivered to the mail service so far; `null` on a log entry older than that count. */
  sent: number | null
  /** Mails the mail service refused; `null` until the send ends. */
  failed: number | null
}

/** The answer of `GET /api/admin/newsletter/sends`. */
export interface AdminNewsletterSendsResponse {
  sends: AdminNewsletterSend[]
}

/** The body of an operator's action on one address: remove it, or mail its confirm link again. */
export const adminSubscriberActionSchema = type({
  email: `string <= ${EMAIL_INPUT_MAX_LENGTH}`,
})
export type AdminSubscriberAction = typeof adminSubscriberActionSchema.infer
