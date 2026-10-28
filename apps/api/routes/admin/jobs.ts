import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { type } from "arktype"
import { searchEntries } from "@spy4x/platform/universal/text"
import {
  ADMIN_JOBS_PAGE_SIZE,
  ADMIN_JOBS_RETRY_ALL_MAX,
  type AdminJobAbout,
  AdminJobActionOutcome,
  type AdminJobDetail,
  type AdminJobFilter,
  type AdminJobListResponse,
  type AdminJobPhoto,
  type AdminJobRow,
  type AdminRepeatingJob,
  parseAdminJobFilter,
} from "@domain/identity"
import type {
  AdminJobMatch,
  AdminJobPage,
  AdminJobRecord,
  RepeatingJobRuns,
} from "@server/jobs/admin-jobs.ts"
import { OUTBOX_RETENTION_DAYS } from "@server/jobs/jobs.ts"
import { describeRepeat, type JobDefinition, JOBS } from "@server/jobs/registry.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"
import { errorResponse } from "../../services/error-response.ts"

export const ADMIN_JOB_NOT_FOUND =
  `No job has this id. It may have been removed a week after it finished.`
export const ADMIN_JOB_STALE =
  `This job already finished or was cancelled. The list now shows its current state.`
export const ADMIN_JOB_SUPERSEDED =
  `A newer run of this job is already waiting, so this one is not run again.`
export const ADMIN_JOB_RUNNING = `This job is running now. Try again once it finishes.`
export const ADMIN_REPEATING_JOB_NOT_FOUND = `No repeating job has this name.`

/** A job's id in the path: the outbox row's UUID. */
const jobId = type(`string.uuid`)

const DAY_MS = 86_400_000

/** The Jobs module's reads and actions; each action writes its audit row in one transaction. */
export interface AdminJobsStore {
  list(filter: AdminJobFilter, match: AdminJobMatch | null): Promise<AdminJobPage>
  job(id: string): Promise<AdminJobRecord | null>
  user(table: string, aggregateId: string): Promise<{ id: number; name: string } | null>
  group(groupId: string): Promise<{ id: string; name: string } | null>
  /** The catalog photos among these images, by image id, named in the first of `languages`. */
  photos(
    imageIds: readonly string[],
    languages: readonly string[],
  ): Promise<Map<string, AdminJobPhoto>>
  repeating(kinds: readonly string[]): Promise<RepeatingJobRuns[]>
  retry(id: string, operatorId: number, requestId: string | null): Promise<AdminJobActionOutcome>
  retryAll(operatorId: number, requestId: string | null, limit: number): Promise<number>
  runNow(id: string, operatorId: number, requestId: string | null): Promise<AdminJobActionOutcome>
  runRepeatingNow(
    kind: string,
    operatorId: number,
    requestId: string | null,
  ): Promise<{ outcome: AdminJobActionOutcome; id: string | null }>
  cancel(id: string, operatorId: number, requestId: string | null): Promise<AdminJobActionOutcome>
}

/** What the Jobs routes call. */
export interface AdminJobsRouteDependencies {
  limit: MiddlewareHandler<APIContext>
  jobs: AdminJobsStore
  /** The job registry; {@link JOBS} unless a test passes its own. */
  registry?: readonly JobDefinition[]
  /** The catalog's languages, the default first: an image job names its item in the first. */
  languages: readonly string[]
}

/**
 * What a search box value matches: the kinds whose name or code it finds, in any word order, as a
 * prefix, in the other keyboard layout or with a typo (`searchEntries`), and the text inside a
 * kind the registry does not know. `null` for an empty search.
 */
export function jobMatch(query: string, registry: readonly JobDefinition[]): AdminJobMatch | null {
  if (query.trim() === ``) return null
  const entries = registry.map((job) => ({ label: job.label, aliases: [job.kind], kind: job.kind }))
  return { kinds: searchEntries(query, entries).map((match) => match.entry.kind), text: query }
}

/**
 * The Jobs routes of the operator area (#394), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them, and a write passes its
 * cross-site checks first. Names, states, attempts, error classes and times only: a job row
 * holds no payload and no error message.
 *
 * - `GET /jobs?q=&state=&page=`: one page of runs, newest first, and each state chip's count.
 * - `GET /jobs/repeating`: each repeating job with its schedule, last run and next run.
 * - `GET /jobs/:id`: one run, with what it is about.
 * - `POST /jobs/:id/retry`, `/run-now`, `/cancel`: the action, then `{ job }` as it is now. 404
 *   for an id no job has; 409 when the job's state no longer allows it, another run waits, or its
 *   kind may not be cancelled (the registry's `cannotCancel`, sent as the error).
 * - `POST /jobs/repeating/:kind/run-now`: the repeating job's next run becomes due now. 409 while
 *   it runs.
 * - `POST /jobs/retry-failed`: every failed job runs again, up to {@link ADMIN_JOBS_RETRY_ALL_MAX}.
 *
 * Every action writes an audit entry naming the operator, the request and the job's kind.
 */
export function createAdminJobsRoutes(dependencies: AdminJobsRouteDependencies): Hono<APIContext> {
  const { limit, jobs, languages } = dependencies
  const registry = dependencies.registry ?? JOBS
  const definition = (kind: string) => registry.find((job) => job.kind === kind)

  /** The records as rows: each with its name, and an image job with its catalog photo. */
  async function rows(records: readonly AdminJobRecord[]): Promise<AdminJobRow[]> {
    const ofImage = (record: AdminJobRecord) => {
      const about = definition(record.kind)?.about
      return about !== undefined && `image` in about
    }
    const imageIds = [...new Set(records.filter(ofImage).map((record) => record.aggregateId))]
    const photos = imageIds.length > 0 ? await jobs.photos(imageIds, languages) : new Map()
    return records.map(({ aggregateId, ...row }) => ({
      ...row,
      label: definition(row.kind)?.label ?? row.kind,
      photo: ofImage({ aggregateId, ...row }) ? photos.get(aggregateId) ?? null : null,
    }))
  }

  async function about(record: AdminJobRecord): Promise<AdminJobAbout | null> {
    const target = definition(record.kind)?.about
    if (!target) return null
    if (`image` in target) return null
    if (`group` in target) {
      const group = await jobs.group(record.aggregateId)
      return group && { type: `group`, ...group }
    }
    const user = await jobs.user(target.userIn, record.aggregateId)
    return user && { type: `user`, ...user }
  }

  async function detail(record: AdminJobRecord): Promise<AdminJobDetail> {
    const [row] = await rows([record])
    const job = definition(record.kind)
    return {
      ...row,
      repeats: job?.repeat ? describeRepeat(job.repeat) : null,
      sendsMail: job?.sendsMail === true,
      cancellable: !job?.cannotCancel,
      about: await about(record),
      keptUntil: record.finishedAt
        ? new Date(Date.parse(record.finishedAt) + OUTBOX_RETENTION_DAYS * DAY_MS).toISOString()
        : null,
    }
  }

  type Action = `retry` | `runNow` | `cancel`
  const act = (action: Action) => async (c: Context<APIContext>) => {
    const id = jobId(c.req.param(`id`))
    if (id instanceof type.errors) {
      return errorResponse(c, `not_found`, { message: ADMIN_JOB_NOT_FOUND })
    }
    const outcome = await jobs[action](
      id.toLowerCase(),
      c.get(`auth`)!.user.id,
      c.get(`requestId`) ?? null,
    )
    const record = await jobs.job(id.toLowerCase())
    if (outcome === AdminJobActionOutcome.Superseded) {
      return errorResponse(c, `conflict`, { message: ADMIN_JOB_SUPERSEDED })
    }
    if (!record) return errorResponse(c, `not_found`, { message: ADMIN_JOB_NOT_FOUND })
    if (outcome === AdminJobActionOutcome.NotCancellable) {
      return errorResponse(c, `conflict`, {
        message: definition(record.kind)?.cannotCancel ?? ADMIN_JOB_STALE,
      })
    }
    if (outcome === AdminJobActionOutcome.NotFound) {
      return errorResponse(c, `conflict`, { message: ADMIN_JOB_STALE })
    }
    return c.json({ job: await detail(record) })
  }

  return new Hono<APIContext>()
    .get(`/jobs`, limit, async (c) => {
      const filter = parseAdminJobFilter(new URL(c.req.url).searchParams)
      const page = await jobs.list(filter, jobMatch(filter.query, registry))
      const body: AdminJobListResponse = {
        jobs: await rows(page.jobs),
        counts: page.counts,
        total: page.total,
        page: filter.page,
        pageSize: ADMIN_JOBS_PAGE_SIZE,
        keptDays: OUTBOX_RETENTION_DAYS,
      }
      return c.json(body)
    })
    .get(`/jobs/repeating`, limit, async (c) => {
      const repeating = registry.filter((job) => job.repeat)
      const runs = await jobs.repeating(repeating.map((job) => job.kind))
      const body: AdminRepeatingJob[] = repeating.map((job, index) => ({
        kind: job.kind,
        label: job.label,
        schedule: describeRepeat(job.repeat!),
        sendsMail: job.sendsMail === true,
        lastRunAt: runs[index]?.lastRunAt?.toISOString() ?? null,
        lastFailed: runs[index]?.lastFailed ?? false,
        nextId: runs[index]?.nextId ?? null,
        nextRunAt: runs[index]?.nextRunAt?.toISOString() ?? null,
        running: runs[index]?.running ?? false,
      }))
      return c.json({ jobs: body })
    })
    .post(`/jobs/repeating/:kind/run-now`, limit, async (c) => {
      const job = definition(c.req.param(`kind`))
      if (!job?.repeat) {
        return errorResponse(c, `not_found`, { message: ADMIN_REPEATING_JOB_NOT_FOUND })
      }
      const { outcome } = await jobs.runRepeatingNow(
        job.kind,
        c.get(`auth`)!.user.id,
        c.get(`requestId`) ?? null,
      )
      if (outcome !== AdminJobActionOutcome.Done) {
        return errorResponse(c, `conflict`, { message: ADMIN_JOB_RUNNING })
      }
      return c.json({ job: null })
    })
    .post(`/jobs/retry-failed`, limit, async (c) => {
      const retried = await jobs.retryAll(
        c.get(`auth`)!.user.id,
        c.get(`requestId`) ?? null,
        ADMIN_JOBS_RETRY_ALL_MAX,
      )
      return c.json({ retried })
    })
    .get(`/jobs/:id`, limit, async (c) => {
      const id = jobId(c.req.param(`id`))
      if (id instanceof type.errors) {
        return errorResponse(c, `not_found`, { message: ADMIN_JOB_NOT_FOUND })
      }
      const record = await jobs.job(id.toLowerCase())
      if (!record) return errorResponse(c, `not_found`, { message: ADMIN_JOB_NOT_FOUND })
      return c.json(await detail(record))
    })
    .post(`/jobs/:id/retry`, limit, act(`retry`))
    .post(`/jobs/:id/run-now`, limit, act(`runNow`))
    .post(`/jobs/:id/cancel`, limit, act(`cancel`))
}

/** The Jobs module: every job's runs, the repeating jobs, and run again, run now and cancel. */
export const jobsAdminModule: AdminApiModule = {
  id: `jobs`,
  routes: ({ db, limit, catalog }) =>
    createAdminJobsRoutes({
      limit,
      languages: catalog.settings.languages,
      // Read at call time: the routes are built before any request, and with no database in tests.
      jobs: {
        list: (filter, match) => db.adminJobs.list(filter, match),
        job: (id) => db.adminJobs.job(id),
        user: (table, aggregateId) => db.adminJobs.user(table, aggregateId),
        group: (groupId) => db.adminJobs.group(groupId),
        photos: (imageIds, languages) => db.adminJobs.photos(imageIds, languages),
        repeating: (kinds) => db.adminJobs.repeating(kinds),
        retry: (id, operatorId, requestId) =>
          db.begin((tx) => tx.adminJobs.retry(id, operatorId, requestId)),
        retryAll: (operatorId, requestId, max) =>
          db.begin((tx) => tx.adminJobs.retryAll(operatorId, requestId, max)),
        runNow: (id, operatorId, requestId) =>
          db.begin((tx) => tx.adminJobs.runNow(id, operatorId, requestId)),
        runRepeatingNow: (kind, operatorId, requestId) =>
          db.begin((tx) => tx.adminJobs.runRepeatingNow(kind, operatorId, requestId)),
        cancel: (id, operatorId, requestId) =>
          db.begin((tx) => tx.adminJobs.cancel(id, operatorId, requestId)),
      },
    }),
}
