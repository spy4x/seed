/**
 * The operator area's Jobs module (#394): every background job's runs, the repeating jobs and the
 * operator's actions on them. Types only, plus the list filter's parsing; the SQL is
 * `libs/server/jobs/admin-jobs.ts` and the job names come from the job registry
 * (`libs/server/jobs/registry.ts`).
 *
 * An operator sees a job's name, state, attempts, error class, times and what it is about, never
 * its data or an error's message: a job row stores neither.
 *
 * This module imports nothing from `+lib.ts` at run time: `+lib.ts` re-exports it.
 *
 * @module
 */

/** Where a job's run stands. The order is the one the state chips show. */
export enum AdminJobState {
  /** Waiting for its time. */
  Scheduled = 1,
  /** Its time has come and no worker holds it yet. */
  Due = 2,
  /** A worker holds it. */
  Running = 3,
  /** It failed at least once and waits for another attempt. */
  Retrying = 4,
  /** It used up its attempts: the worker gave up. */
  Failed = 5,
  /** It ran well. */
  Done = 6,
  /** An operator cancelled it before it ran. */
  Cancelled = 7,
}

/** A state chip of the Runs list: `scheduled` covers jobs due now too. */
export type AdminJobStateFilter =
  | "all"
  | "failed"
  | "retrying"
  | "scheduled"
  | "running"
  | "done"
  | "cancelled"

/** Every {@link AdminJobStateFilter}, in the order the chips show them. */
export const ADMIN_JOB_STATE_FILTERS: readonly AdminJobStateFilter[] = [
  "all",
  "failed",
  "retrying",
  "scheduled",
  "running",
  "done",
  "cancelled",
]

/** The states each filter shows. */
export const ADMIN_JOB_FILTER_STATES: Readonly<Record<AdminJobStateFilter, AdminJobState[]>> = {
  all: [],
  failed: [AdminJobState.Failed],
  retrying: [AdminJobState.Retrying],
  scheduled: [AdminJobState.Scheduled, AdminJobState.Due],
  running: [AdminJobState.Running],
  done: [AdminJobState.Done],
  cancelled: [AdminJobState.Cancelled],
}

/** How many runs one page of the list holds. */
export const ADMIN_JOBS_PAGE_SIZE = 50

/** The longest search the list takes; the rest is cut off. */
export const ADMIN_JOB_SEARCH_MAX = 64

/** How many failed jobs "Run again all failed" starts in one press, oldest first. */
export const ADMIN_JOBS_RETRY_ALL_MAX = 500

/** The search and state filter of the Runs list, as the address and the API's query carry them. */
export interface AdminJobFilter {
  /** Words that must each appear in the job's name or kind, in any order. */
  query: string
  state: AdminJobStateFilter
  /** 1-based. */
  page: number
}

/** Every run, first page. */
export const ADMIN_JOB_NO_FILTER: AdminJobFilter = { query: "", state: "all", page: 1 }

/**
 * Reads the list's filter from query parameters (`q`, `state`, `page`). A value it does not
 * understand falls back to the default for that part, so a hand-edited address still shows a list.
 */
export function parseAdminJobFilter(params: URLSearchParams): AdminJobFilter {
  const query = (params.get("q") ?? "").trim().slice(0, ADMIN_JOB_SEARCH_MAX)
  const rawState = params.get("state") as AdminJobStateFilter | null
  const state = rawState && ADMIN_JOB_STATE_FILTERS.includes(rawState) ? rawState : "all"
  const pageNumber = Number(params.get("page"))
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 100_000
    ? pageNumber
    : 1
  return { query, state, page }
}

/** The query string of `filter`, leaving out every part at its default. No leading `?`. */
export function adminJobFilterQuery(filter: AdminJobFilter): string {
  const params = new URLSearchParams()
  if (filter.query) params.set("q", filter.query)
  if (filter.state !== "all") params.set("state", filter.state)
  if (filter.page > 1) params.set("page", String(filter.page))
  return params.toString()
}

/** One run of a job, as the list and the detail page show it. Times are ISO 8601. */
export interface AdminJobRow {
  /** The outbox row's id, a UUID. */
  id: string
  /** The code, such as `auth.password-reset-mail`. */
  kind: string
  /** The name, such as "Password reset email"; the kind for a job the registry does not know. */
  label: string
  state: AdminJobState
  attempts: number
  /** How many attempts the worker makes before it gives up. */
  maxAttempts: number
  createdAt: string
  /** When it runs, or ran: the row's due time. Moves on with each retry. */
  dueAt: string
  /** When a worker last took it, or `null` for never. */
  startedAt: string | null
  /** When it finished, failed for good or was cancelled, or `null` while it waits. */
  finishedAt: string | null
  /** The error's class from its last failed attempt, never its message, or `null`. */
  errorCode: string | null
}

/** One page of runs, the count of each state chip, and the paging. */
export interface AdminJobListResponse {
  jobs: AdminJobRow[]
  /** How many runs each chip holds, over the search but not the state filter. */
  counts: Record<AdminJobStateFilter, number>
  total: number
  page: number
  pageSize: number
  /** How many days a finished run is kept. */
  keptDays: number
}

/** What a job is about, when the admin can link it. */
export type AdminJobAbout =
  | { type: "user"; id: number; name: string }
  | { type: "group"; id: string; name: string }

/** One run with everything its page shows. */
export interface AdminJobDetail extends AdminJobRow {
  /** The schedule in words, such as "Every day", for a repeating job; `null` for a one-off. */
  repeats: string | null
  /** It sends mail: the admin asks before running it again or now. */
  sendsMail: boolean
  /** An operator may cancel it while it waits; `false` for a kind whose own page stops it. */
  cancellable: boolean
  /** What it is about, while that still exists and the job names it; otherwise `null`. */
  about: AdminJobAbout | null
  /** When the nightly cleanup removes a finished run. `null` while it waits. */
  keptUntil: string | null
}

/** One repeating job: its schedule, its last run and its next. */
export interface AdminRepeatingJob {
  kind: string
  label: string
  /** The schedule in words, such as "Every day". */
  schedule: string
  sendsMail: boolean
  /** When a run last finished, or `null` when none is kept. */
  lastRunAt: string | null
  /** Whether that run failed. */
  lastFailed: boolean
  /** The waiting run's id and due time, or `null` when none waits. */
  nextId: string | null
  nextRunAt: string | null
  /** A worker holds the waiting run now: "Run now" is off. */
  running: boolean
}

/** What an operator's action on a job came to. */
export enum AdminJobActionOutcome {
  /** It went through. */
  Done = 1,
  /** No job has that id, or the action does not apply to its state any more. */
  NotFound = 2,
  /** Another run of the same job waits already: a second one would run it twice. */
  Superseded = 3,
  /** The job's kind may not be cancelled from the admin (`cannotCancel` in the registry). */
  NotCancellable = 4,
}

/** The answer of every action route: the run as it is now, or `null` for a repeating job's start. */
export interface AdminJobActionResponse {
  job: AdminJobDetail | null
}

/** The answer of "Run again all failed": how many runs started again. */
export interface AdminJobRetryAllResponse {
  retried: number
}
