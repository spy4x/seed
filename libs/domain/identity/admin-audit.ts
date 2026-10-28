/**
 * The operator area's audit log (#429): every audit entry across the product, newest first. Two
 * tables feed it: `auth_audits`, each person's own trail (sign-ins, profile and token changes, and
 * what an operator did to them), and `audit_events`, the activity of groups and the operator's
 * actions on the system. Types only, plus the filter's parsing; the SQL is
 * `libs/server/auth/admin-audit.ts`.
 *
 * This module imports nothing from `+lib.ts` at run time: `+lib.ts` re-exports it.
 *
 * @module
 */

import { BLOG_AUDIT_KINDS } from "@domain/blog"
import { CONTACT_LINK_AUDIT_KINDS } from "@domain/contact-links"

/** Which table an entry comes from: a person's trail, or group and system activity. */
export type AdminAuditSource = "account" | "activity"

/** How many entries one page of the log holds. */
export const ADMIN_AUDIT_PAGE_SIZE = 50

/** The most rows one CSV export holds; a wider filter is cut at this many, newest first. */
export const ADMIN_AUDIT_EXPORT_MAX = 10_000

/** The longest person search the log takes; the rest is cut off. */
export const ADMIN_AUDIT_SEARCH_MAX = 100

/** The `audit_events.event_kind` of an operator running a failed job again (#429). */
export const ADMIN_JOB_RETRIED_KIND = "system.job_retried"

/** The `audit_events.event_kind` of an operator running a waiting job now (#394). */
export const ADMIN_JOB_RUN_NOW_KIND = "system.job_run_now"

/** The `audit_events.event_kind` of an operator cancelling a waiting job (#394). */
export const ADMIN_JOB_CANCELLED_KIND = "system.job_cancelled"

/** The operator's actions on a job: each entry's details name the job's kind. */
export const ADMIN_JOB_AUDIT_KINDS: readonly string[] = [
  ADMIN_JOB_RETRIED_KIND,
  ADMIN_JOB_RUN_NOW_KIND,
  ADMIN_JOB_CANCELLED_KIND,
]

/** The `audit_events.event_kind` of an operator downloading the log as a file (#429). */
export const ADMIN_AUDIT_EXPORTED_KIND = "system.audit_exported"

/**
 * The `audit_events.event_kind` of an operator opening one of a group's files in the admin app
 * (#478). The row belongs to the group and names the file in `details.name`.
 */
export const ADMIN_FILE_OPENED_KIND = "operator.file_opened"

/** The `audit_events.event_kind` of an operator downloading one of a group's files (#478). */
export const ADMIN_FILE_DOWNLOADED_KIND = "operator.file_downloaded"

/**
 * An operator's reads of a group's files. They are kept out of the group's own activity log and
 * its "last activity": a read changes nothing in the group.
 */
export const ADMIN_FILE_AUDIT_KINDS: readonly string[] = [
  ADMIN_FILE_OPENED_KIND,
  ADMIN_FILE_DOWNLOADED_KIND,
]

/** The kinds of `audit_events` an operator writes, so the operator filter finds them. */
export const ADMIN_OPERATOR_ACTIVITY_KINDS: readonly string[] = [
  ...ADMIN_JOB_AUDIT_KINDS,
  ...ADMIN_FILE_AUDIT_KINDS,
  ADMIN_AUDIT_EXPORTED_KIND,
  ...Object.values(BLOG_AUDIT_KINDS),
  ...Object.values(CONTACT_LINK_AUDIT_KINDS),
]

/** The filter value of an `auth_audits` event type: `account:2`. */
export function accountAuditEvent(eventType: number): string {
  return `account:${eventType}`
}

/** The filter value of an `audit_events` kind: `activity:note.created`. */
export function activityAuditEvent(kind: string): string {
  return `activity:${kind}`
}

const ACCOUNT_EVENT = /^account:([1-9]\d{0,4})$/
const ACTIVITY_EVENT = /^activity:([a-z][a-z_]{0,30}\.[a-z][a-z_]{0,30})$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** The characters of an IPv4 or IPv6 address, so a prefix of either is accepted. */
const IP_PREFIX = /^[0-9a-fA-F:.]{1,45}$/
const OPERATOR_ID = /^[1-9]\d{0,9}$/

/** An event filter split into its table and its value, or `null` for a value that is neither. */
export function parseAuditEvent(
  value: string | null,
): { source: "account"; eventType: number } | { source: "activity"; kind: string } | null {
  if (!value) return null
  const account = ACCOUNT_EVENT.exec(value)
  if (account) return { source: "account", eventType: Number(account[1]) }
  const activity = ACTIVITY_EVENT.exec(value)
  if (activity) return { source: "activity", kind: activity[1] }
  return null
}

/** `value` when it is a real UTC day written `YYYY-MM-DD`, else `null`. */
function dayOf(value: string | null): string | null {
  if (!value || !DAY.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null
}

/** The filters of the audit log, as the page's address and the API's query carry them. */
export interface AdminAuditFilter {
  /** One event ({@link accountAuditEvent} or {@link activityAuditEvent}), or `null` for every one. */
  event: string | null
  /**
   * Whom an entry is about or who did it: a person's id, or words that must each appear in their
   * name or address. `""` for everyone.
   */
  person: string
  /** Only what this operator did, by their id, or `null`. */
  operator: number | null
  /** The first UTC day, `YYYY-MM-DD`, or `null`. */
  from: string | null
  /** The last UTC day, included, or `null`. */
  to: string | null
  /** The start of the address a request came from; `""` for any. */
  ip: string
}

/** The log with no filter: every entry. */
export const ADMIN_AUDIT_NO_FILTER: AdminAuditFilter = {
  event: null,
  person: "",
  operator: null,
  from: null,
  to: null,
  ip: "",
}

/**
 * The filter `params` ask for. A value that is not well formed is dropped rather than refused, so
 * an edited address shows the whole log instead of an error. Days in the wrong order are swapped.
 */
export function parseAdminAuditFilter(params: URLSearchParams): AdminAuditFilter {
  const rawEvent = params.get("event")
  const event = parseAuditEvent(rawEvent) ? rawEvent : null
  const person = (params.get("person") ?? "").trim().slice(0, ADMIN_AUDIT_SEARCH_MAX)
  const rawOperator = params.get("operator") ?? ""
  const operator = OPERATOR_ID.test(rawOperator) && Number(rawOperator) <= 2_147_483_647
    ? Number(rawOperator)
    : null
  let from = dayOf(params.get("from"))
  let to = dayOf(params.get("to"))
  if (from && to && from > to) [from, to] = [to, from]
  const rawIp = (params.get("ip") ?? "").trim()
  const ip = IP_PREFIX.test(rawIp) ? rawIp : ""
  return { event, person, operator, from, to, ip }
}

/** The query string of `filter`, leaving out every part at its default. No leading `?`. */
export function adminAuditFilterQuery(filter: AdminAuditFilter): string {
  const params = new URLSearchParams()
  if (filter.event) params.set("event", filter.event)
  if (filter.person) params.set("person", filter.person)
  if (filter.operator !== null) params.set("operator", String(filter.operator))
  if (filter.from) params.set("from", filter.from)
  if (filter.to) params.set("to", filter.to)
  if (filter.ip) params.set("ip", filter.ip)
  return params.toString()
}

/** Whether `filter` narrows the log at all. */
export function isAdminAuditFiltered(filter: AdminAuditFilter): boolean {
  return adminAuditFilterQuery(filter) !== ""
}

/** A person an entry names. `name` is their full name, or their address when they set none. */
export interface AdminAuditPerson {
  id: number
  name: string
  email: string | null
}

/** One entry of the log. Dates are ISO 8601. */
export interface AdminAuditEntry {
  /** Unique across both tables: `account-12`, `activity-40`. */
  key: string
  source: AdminAuditSource
  /** The entry's event, as the event filter names it. */
  event: string
  at: string
  /**
   * Whom the entry is about: the person whose trail it is, or the member a group change names.
   * `null` when the account is gone.
   */
  person: AdminAuditPerson | null
  /**
   * Who did it: the operator for an operator's action, the group member for group activity, and
   * the person themselves otherwise. `null` when that account is gone.
   */
  actor: AdminAuditPerson | null
  /** An operator did it. */
  byOperator: boolean
  /** The group a group entry belongs to, while the group exists. */
  group: { id: string; name: string } | null
  /**
   * What a person's entry names besides them: a sign-in method, an API token's description, a
   * reason. `null` for group activity, whose text (a note's title) never leaves the API.
   */
  identifier: string | null
  ip: string | null
  userAgent: string | null
  /** The job an operator acted on, for each of {@link ADMIN_JOB_AUDIT_KINDS}. */
  jobKind: string | null
  /** The file an operator opened or downloaded, for each of {@link ADMIN_FILE_AUDIT_KINDS}. */
  fileName: string | null
}

/** One page of the log, and the cursor of the next one, or `null` at the oldest entry. */
export interface AdminAuditPage {
  entries: AdminAuditEntry[]
  next: string | null
}

/** Someone with the operator role or above, for the operator filter. */
export type AdminAuditOperator = AdminAuditPerson
