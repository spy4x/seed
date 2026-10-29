import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import type postgres from "postgres"
import { type } from "arktype"
import { validate } from "@spy4x/validation"
import { parseBareAddress } from "@spy4x/email/address"
import { maskEmail } from "@spy4x/platform/universal/text"
import { readJsonBody } from "@spy4x/server/http/bounded-body"
import { type AuthAuditBase, AuthAuditEventType } from "@domain/identity"
import {
  ADMIN_NEWSLETTER_SENDS_LIMIT,
  ADMIN_SUBSCRIBERS_PAGE_SIZE,
  type AdminNewsletterSendsResponse,
  type AdminNewsletterStats,
  adminSubscriberActionSchema,
  type AdminSubscriberFilter,
  type AdminSubscriberListResponse,
  type AdminSubscriberRow,
  DEFAULT_SUBSCRIBER_LIST,
  parseAdminSubscriberFilter,
  type SubscriberList,
} from "@domain/subscribers"
import {
  adminSubscribersCsv,
  allAdminSubscribers,
  findAdminSubscriber,
  listAdminNewsletterSends,
  listAdminSubscribers,
  readAdminNewsletterStats,
  removeAdminSubscriber,
  resendAdminConfirmation,
} from "@server/subscribers/admin-newsletter.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import { auditRow } from "@api/services/sign-in.ts"
import type { AppDbBase } from "@api/services/db-base.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"
import { errorResponse } from "../../services/error-response.ts"

export const NEWSLETTER_INVALID_ADDRESS = `Enter a valid e-mail address`
export const NEWSLETTER_NOT_LISTED = `This address is not on the list`
export const NEWSLETTER_ALREADY_CONFIRMED = `This address has already confirmed`
export const NEWSLETTER_OFF = `Mail subscriptions are off`

/** An action's body is one address: 4 KiB holds any real one. */
const ACTION_MAX_BYTES = 4 * 1024

/** A search's body is the filter's four short fields: 4 KiB holds any the page sends. */
const SEARCH_MAX_BYTES = 4 * 1024

/**
 * The body of a search: the list's query-string fields (`q`, `status`, `language`, `page`), each as text and
 * each optional, so `parseAdminSubscriberFilter` reads them by the same rules as before.
 */
const searchBodySchema = type({
  "q?": `string`,
  "status?": `string`,
  "language?": `string`,
  "page?": `string`,
})

/** What a search answers when its body is not the filter's fields. */
export const NEWSLETTER_INVALID_SEARCH = `This search could not be read`

/**
 * What the newsletter routes read and write, for one list. Who may call it is the route's
 * business; every address it takes is already parsed.
 */
export interface AdminNewsletterService {
  /** False when mail subscriptions are off: the list still reads, the actions answer 503. */
  enabled: boolean
  stats(): Promise<AdminNewsletterStats>
  list(filter: AdminSubscriberFilter): Promise<AdminSubscriberListResponse>
  sends(): Promise<AdminNewsletterSendsResponse>
  find(email: string): Promise<AdminSubscriberRow | null>
  /** Every address, for the CSV. */
  all(): Promise<AdminSubscriberRow[]>
  /** Takes the address off the list and records its unsubscribe. */
  remove(email: string): Promise<void>
  /** Queues a new confirm mail to the address. */
  resend(email: string): Promise<void>
  /** Writes one row of the audit trail. */
  audit(row: AuthAuditBase): Promise<void>
}

/** What the newsletter routes call. */
export interface AdminNewsletterRouteDependencies {
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  newsletter: AdminNewsletterService
  /** The list these routes serve; its name prefixes every audit row's `identifier`. */
  list: SubscriberList
  now(): Date
}

/**
 * The newsletter routes of the operator area (#428), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them, and every `POST` passed the
 * same-origin guard.
 *
 * - `GET /newsletter/stats` answers {@link AdminNewsletterStats}: counts only.
 * - `POST /newsletter/subscribers/search` takes `{ q?, status?, language?, page? }`, each as text, and lists
 *   the matching addresses, newest first. A `POST`, so the search text never sits in a URL, where
 *   access logs and the browser's history would keep it.
 * - `GET /newsletter/sends` lists the issues sent, newest first, with their counts.
 * - `POST /newsletter/subscribers/remove` takes `{ email }`: the address leaves the list as by its
 *   unsubscribe link, and no confirm link mailed before can add it back.
 * - `POST /newsletter/subscribers/resend` takes `{ email }` of a pending address and queues a new
 *   confirm mail.
 * - `POST /newsletter/subscribers/export` answers every address as a CSV download. A `POST`, so
 *   another site cannot make an operator's browser run it.
 *
 * Each action writes an audit row on the operator before it acts, so no change goes unrecorded;
 * the row masks the address (`news:j***@e***.com`), because a removal must not keep it.
 */
export function createAdminNewsletterRoutes(
  { limit, newsletter, list, now }: AdminNewsletterRouteDependencies,
): Hono<APIContext> {
  /** The address in the action's body, parsed, or `null` when it is no address. */
  const addressOf = async (c: Parameters<MiddlewareHandler<APIContext>>[0]) => {
    const checked = validate(
      adminSubscriberActionSchema,
      await readJsonBody(c, { maxBytes: ACTION_MAX_BYTES }),
    )
    return checked.error ? null : parseBareAddress(checked.data.email.trim())
  }
  const audit = (
    c: Parameters<MiddlewareHandler<APIContext>>[0],
    eventType: AuthAuditEventType,
    detail: string,
  ) => newsletter.audit(auditRow(c, c.get(`auth`)!.user.id, eventType, `${list}:${detail}`))

  return new Hono<APIContext>()
    .get(`/newsletter/stats`, limit, async (c) => c.json(await newsletter.stats()))
    .post(`/newsletter/subscribers/search`, limit, async (c) => {
      const checked = validate(
        searchBodySchema,
        await readJsonBody(c, { maxBytes: SEARCH_MAX_BYTES }),
      )
      if (checked.error) {
        return errorResponse(c, `bad_request`, { message: NEWSLETTER_INVALID_SEARCH })
      }
      const { q = ``, status = ``, language = ``, page = `` } = checked.data
      const filter = parseAdminSubscriberFilter(new URLSearchParams({ q, status, language, page }))
      return c.json(await newsletter.list(filter))
    })
    .get(`/newsletter/sends`, limit, async (c) => c.json(await newsletter.sends()))
    .post(`/newsletter/subscribers/remove`, limit, async (c) => {
      if (!newsletter.enabled) {
        return errorResponse(c, `internal`, { message: NEWSLETTER_OFF, status: 503 })
      }
      const email = await addressOf(c)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: NEWSLETTER_INVALID_ADDRESS })
      }
      if (!await newsletter.find(email)) {
        return errorResponse(c, `not_found`, { message: NEWSLETTER_NOT_LISTED })
      }
      await audit(
        c,
        AuthAuditEventType.NEWSLETTER_SUBSCRIBER_REMOVED,
        maskEmail(email, { domain: true }),
      )
      await newsletter.remove(email)
      return c.json({ removed: true })
    })
    .post(`/newsletter/subscribers/resend`, limit, async (c) => {
      if (!newsletter.enabled) {
        return errorResponse(c, `internal`, { message: NEWSLETTER_OFF, status: 503 })
      }
      const email = await addressOf(c)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: NEWSLETTER_INVALID_ADDRESS })
      }
      const found = await newsletter.find(email)
      if (!found) return errorResponse(c, `not_found`, { message: NEWSLETTER_NOT_LISTED })
      if (found.status === `confirmed`) {
        return errorResponse(c, `conflict`, { message: NEWSLETTER_ALREADY_CONFIRMED })
      }
      await audit(
        c,
        AuthAuditEventType.NEWSLETTER_CONFIRMATION_RESENT,
        maskEmail(email, { domain: true }),
      )
      await newsletter.resend(email)
      return c.json({}, 202)
    })
    .post(`/newsletter/subscribers/export`, limit, async (c) => {
      const rows = await newsletter.all()
      await audit(c, AuthAuditEventType.NEWSLETTER_SUBSCRIBERS_EXPORTED, String(rows.length))
      const day = now().toISOString().slice(0, 10)
      return new Response(adminSubscribersCsv(rows), {
        headers: {
          "Content-Type": `text/csv; charset=utf-8`,
          "Content-Disposition": `attachment; filename="newsletter-${list}-${day}.csv"`,
          "Cache-Control": `no-store`,
        },
      })
    })
}

/** The service over the app's database for `list`. */
export function createAdminNewsletter(
  { sql, db, setup, list, now }: {
    sql: postgres.Sql
    db: AppDbBase
    setup: SubscribersSetup | null
    list: SubscriberList
    now(): Date
  },
): AdminNewsletterService {
  return {
    enabled: setup !== null,
    stats: () => readAdminNewsletterStats(sql, list, now()),
    async list(filter) {
      const page = await listAdminSubscribers(sql, list, filter, ADMIN_SUBSCRIBERS_PAGE_SIZE)
      return { ...page, page: filter.page, pageSize: ADMIN_SUBSCRIBERS_PAGE_SIZE }
    },
    sends: async () => ({
      sends: await listAdminNewsletterSends(sql, list, ADMIN_NEWSLETTER_SENDS_LIMIT),
    }),
    find: (email) => findAdminSubscriber(sql, list, email),
    all: () => allAdminSubscribers(sql, list),
    async remove(email) {
      if (!setup) throw new Error(`mail subscriptions are off`)
      await removeAdminSubscriber({ sql, setup, list, email, now: now() })
    },
    resend: (email) => resendAdminConfirmation(sql, list, email),
    audit: (row) => db.authAudit.insert(row),
  }
}

/** The newsletter module: its subscribers, its numbers, its sent issues and the actions. */
export const newsletterAdminModule: AdminApiModule = {
  id: `newsletter`,
  routes: ({ db, sql, subscribers, limit, now }) =>
    createAdminNewsletterRoutes({
      limit,
      now,
      list: DEFAULT_SUBSCRIBER_LIST,
      newsletter: createAdminNewsletter({
        sql,
        db,
        setup: subscribers,
        list: DEFAULT_SUBSCRIBER_LIST,
        now,
      }),
    }),
}
