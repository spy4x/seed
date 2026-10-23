import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import { createKeysetCursorCodec, KeysetCursorError } from "@spy4x/platform/keyset-cursor"
import { type CsvColumn, toCsvBytes } from "@spy4x/platform/universal/csv"
import {
  ADMIN_AUDIT_EXPORT_MAX,
  ADMIN_AUDIT_PAGE_SIZE,
  type AdminAuditEntry,
  type AdminAuditFilter,
  adminAuditFilterQuery,
  type AdminAuditOperator,
  AuthAuditEventType,
  parseAdminAuditFilter,
  parseAuditEvent,
} from "@domain/identity"
import { BILLING_AUDIT_EVENTS } from "@domain/billing"
import type { AdminAuditPageKey } from "@server/auth/admin-audit.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"
import { ADMIN_EXPORT_CROSS_SITE } from "./users.ts"
import { errorResponse } from "../../services/error-response.ts"

export const ADMIN_AUDIT_BAD_CURSOR =
  "This page of the audit log is no longer valid. Start again from the newest entries."

/** The longest cursor the log accepts; a real one is far shorter. */
const CURSOR_MAX_LENGTH = 1024

/** The page key a cursor carries; anything else in it is refused. */
const pageKey = type({
  "+": "reject",
  at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
  source: "'account' | 'activity'",
  id: /^[1-9]\d{0,18}$/,
})

/** The log's own reads and the one write an export makes. */
export interface AdminAuditStore {
  list(
    filter: AdminAuditFilter,
    limit: number,
    after: AdminAuditPageKey | null,
  ): Promise<{ entries: AdminAuditEntry[]; next: AdminAuditPageKey | null }>
  operators(): Promise<AdminAuditOperator[]>
  recordExport(operatorId: number, rows: number, requestId: string | null): Promise<void>
}

/** Signs a page key into a cursor bound to the operator and the filter, and reads one back. */
export interface AdminAuditCursor {
  encode(operatorId: number, filter: string, key: AdminAuditPageKey): Promise<string>
  /** `null` for every cursor it refuses. */
  decode(cursor: string, operatorId: number, filter: string): Promise<AdminAuditPageKey | null>
}

/**
 * The audit log's cursor: a keyset cursor under the purpose `admin.audit`, bound to the operator
 * and to the filter it was issued for, so a cursor that another operator was given, or one pasted
 * under another filter, is refused. The codec is made on first use: the module's routes are built
 * before any request, and with no database or secret in some tests.
 */
export function createAdminAuditCursor(secret: string): AdminAuditCursor {
  let codec: ReturnType<typeof make> | null = null
  function make() {
    return createKeysetCursorCodec({
      secret,
      purpose: `admin.audit`,
      scope: [`operatorId`, `filter`],
      pageKey,
    })
  }
  const ready = () => (codec ??= make())
  return {
    encode: async (operatorId, filter, key) => (await ready()).encode(key, { operatorId, filter }),
    async decode(cursor, operatorId, filter) {
      try {
        return await (await ready()).decode(cursor, { operatorId, filter })
      } catch (error) {
        if (error instanceof KeysetCursorError) return null
        throw error
      }
    },
  }
}

/** What the audit routes call. */
export interface AdminAuditRouteDependencies {
  limit: MiddlewareHandler<APIContext>
  audit: AdminAuditStore
  cursor: AdminAuditCursor
  now(): Date
}

/** The billing events by number, named as their keys in snake case: `payment_refunded`. */
const BILLING_EVENT_NAMES = new Map<number, string>(
  Object.entries(BILLING_AUDIT_EVENTS).map((
    [key, eventType],
  ) => [eventType, key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]),
)

/** An entry's event as a stable name for a spreadsheet: `signed_in`, `note.created`. */
export function auditEventName(event: string): string {
  const parsed = parseAuditEvent(event)
  if (!parsed) return event
  if (parsed.source === "activity") return parsed.kind
  return AuthAuditEventType[parsed.eventType]?.toLowerCase() ??
    BILLING_EVENT_NAMES.get(parsed.eventType) ?? `account_${parsed.eventType}`
}

/** One row of the file. Every text cell goes through the CSV writer's formula guard. */
interface AuditCsvRow {
  at: string
  event: string
  personId: number | ``
  person: string
  personEmail: string
  actorId: number | ``
  actor: string
  byOperator: string
  group: string
  identifier: string
  ip: string
  userAgent: string
  job: string
}

const CSV_COLUMNS: CsvColumn<AuditCsvRow>[] = [
  { key: `at`, header: `Time (UTC)` },
  { key: `event`, header: `Event` },
  { key: `personId`, header: `Person id` },
  { key: `person`, header: `Person` },
  { key: `personEmail`, header: `Person address` },
  { key: `actorId`, header: `Done by id` },
  { key: `actor`, header: `Done by` },
  { key: `byOperator`, header: `By an operator` },
  { key: `group`, header: `Group` },
  { key: `identifier`, header: `Detail` },
  { key: `ip`, header: `IP address` },
  { key: `userAgent`, header: `Device` },
  { key: `job`, header: `Job` },
]

function csvRowOf(entry: AdminAuditEntry): AuditCsvRow {
  return {
    at: entry.at,
    event: auditEventName(entry.event),
    personId: entry.person?.id ?? ``,
    person: entry.person?.name ?? ``,
    personEmail: entry.person?.email ?? ``,
    actorId: entry.actor?.id ?? ``,
    actor: entry.actor?.name ?? ``,
    byOperator: entry.byOperator ? `yes` : `no`,
    group: entry.group?.name ?? ``,
    identifier: entry.identifier ?? ``,
    ip: entry.ip ?? ``,
    userAgent: entry.userAgent ?? ``,
    job: entry.jobKind ?? ``,
  }
}

/**
 * The audit log routes of the operator area (#429), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them.
 *
 * - `GET /audit?event=&person=&operator=&from=&to=&ip=&cursor=` is one page, newest first:
 *   `{ entries, next }`. `next` is the cursor of the following page, or `null` at the oldest entry.
 *   A cursor works only for the operator and the filter it was issued with (400 otherwise).
 * - `GET /audit/operators` lists everyone with the operator role or above: `{ operators }`.
 * - `GET /audit/export.csv?<the same filter>` downloads up to {@link ADMIN_AUDIT_EXPORT_MAX}
 *   matching entries, newest first, as CSV. Every text cell is guarded against spreadsheet formula
 *   injection. The download writes an audit entry naming the operator and the row count, so it
 *   answers 403 unless `Sec-Fetch-Site` is `same-origin`: the session cookie is `SameSite=Lax`,
 *   which another site's link or top-level navigation still carries.
 *
 * A filter value that is not well formed is dropped, as on the people list: an edited address
 * shows more, never an error. Group activity leaves its details (a note's title) in the database.
 */
export function createAdminAuditRoutes(
  dependencies: AdminAuditRouteDependencies,
): Hono<APIContext> {
  const { audit, cursor, limit } = dependencies
  return new Hono<APIContext>()
    .get(`/audit`, limit, async (c) => {
      const params = new URL(c.req.url).searchParams
      const filter = parseAdminAuditFilter(params)
      const scope = adminAuditFilterQuery(filter)
      const operatorId = c.get(`auth`)!.user.id
      const raw = params.get(`cursor`)
      let after: AdminAuditPageKey | null = null
      if (raw) {
        after = raw.length > CURSOR_MAX_LENGTH ? null : await cursor.decode(raw, operatorId, scope)
        if (!after) return errorResponse(c, `bad_request`, { message: ADMIN_AUDIT_BAD_CURSOR })
      }
      const page = await audit.list(filter, ADMIN_AUDIT_PAGE_SIZE, after)
      return c.json({
        entries: page.entries,
        next: page.next ? await cursor.encode(operatorId, scope, page.next) : null,
      })
    })
    .get(`/audit/operators`, limit, async (c) => c.json({ operators: await audit.operators() }))
    .get(`/audit/export.csv`, limit, async (c) => {
      // A GET the mutation guards let through, yet it reads the log and writes an audit row in the
      // operator's name. The admin app's download link is same-origin; a missing header is refused.
      if (c.req.header(`sec-fetch-site`) !== `same-origin`) {
        return errorResponse(c, `forbidden`, { message: ADMIN_EXPORT_CROSS_SITE })
      }
      const filter = parseAdminAuditFilter(new URL(c.req.url).searchParams)
      const { entries } = await audit.list(filter, ADMIN_AUDIT_EXPORT_MAX, null)
      await audit.recordExport(c.get(`auth`)!.user.id, entries.length, c.get(`requestId`) ?? null)
      const day = dependencies.now().toISOString().slice(0, 10)
      return c.body(toCsvBytes(CSV_COLUMNS, entries.map(csvRowOf)), 200, {
        "Content-Type": `text/csv; charset=utf-8`,
        "Content-Disposition": `attachment; filename="audit-log-${day}.csv"`,
        "Cache-Control": `no-store`,
      })
    })
}

/** The audit module: the product-wide audit log, its filters and its CSV export. */
export const auditAdminModule: AdminApiModule = {
  id: `audit`,
  routes: ({ db, limit, now, cursorSecret }) =>
    createAdminAuditRoutes({
      limit,
      now,
      cursor: createAdminAuditCursor(cursorSecret),
      // Read at call time: the routes are built before any request, and with no database in tests.
      audit: {
        list: (filter, size, after) => db.adminAudit.list(filter, size, after),
        operators: () => db.adminAudit.operators(),
        recordExport: (operatorId, rows, requestId) =>
          db.adminAudit.recordExport(operatorId, rows, requestId),
      },
    }),
}
