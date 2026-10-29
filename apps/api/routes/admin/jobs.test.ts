import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import {
  ADMIN_JOBS_RETRY_ALL_MAX,
  AdminJobActionOutcome,
  AdminJobState,
  type AdminJobStateFilter,
  UserRole,
} from "@domain/identity"
import type { AdminJobRecord } from "@server/jobs/admin-jobs.ts"
import { defineJob } from "@server/jobs/registry.ts"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import {
  ADMIN_JOB_NOT_FOUND,
  ADMIN_JOB_RUNNING,
  ADMIN_JOB_STALE,
  ADMIN_JOB_SUPERSEDED,
  type AdminJobsStore,
  createAdminJobsRoutes,
  jobMatch,
} from "./jobs.ts"
import { apiError } from "../../_testing/api-error.ts"

const JOB_ID = `01927f3e-6b2a-7c3d-8e4f-5a6b7c8d9e0f`
const ABOUT_ID = `01927f3e-6b2a-7c3d-8e4f-000000000001`
const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()
const noop = () => async () => {}

/**
 * A registry of five jobs: one about a person that mails, one repeating, one about a group, one
 * the admin may not cancel, and one about an image.
 */
const REGISTRY = [
  defineJob({
    kind: `auth.password-reset-mail`,
    label: `Password reset email`,
    sendsMail: true,
    about: { userIn: `password_requests` },
    handler: noop,
  }),
  defineJob({
    kind: `outbox.cleanup`,
    label: `Nightly cleanup`,
    repeat: { everyMs: 86_400_000 },
    handler: noop,
  }),
  defineJob({
    kind: `billing.seat-sync`,
    label: `Seat count sync`,
    about: { group: true },
    handler: noop,
  }),
  defineJob({
    kind: `blog.publish`,
    label: `Publish a blog post`,
    cannotCancel: `Unschedule the post on the Blog page.`,
    handler: noop,
  }),
  defineJob({
    kind: `files.image-process`,
    label: `Image processing: preview`,
    about: { image: true },
    handler: noop,
  }),
]

const PHOTO_ID = `01927f3e-6b2a-7c3d-8e4f-000000000002`
const PICTURE_ID = `01927f3e-6b2a-7c3d-8e4f-000000000003`
const ITEM_ID = `01927f3e-6b2a-7c3d-8e4f-000000000004`

/** An image job about a catalog photo, and one about an image that is no catalog photo. */
const imageJob = (aggregateId: string): AdminJobRecord => ({
  ...failed,
  id: aggregateId === PHOTO_ID
    ? `01927f3e-6b2a-7c3d-8e4f-0000000000a1`
    : `01927f3e-6b2a-7c3d-8e4f-0000000000a2`,
  kind: `files.image-process`,
  aggregateId,
  state: AdminJobState.Done,
  errorCode: null,
})

const failed: AdminJobRecord = {
  id: JOB_ID,
  kind: `auth.password-reset-mail`,
  aggregateId: ABOUT_ID,
  state: AdminJobState.Failed,
  attempts: 20,
  maxAttempts: 20,
  createdAt: `2026-10-16T08:00:00.000Z`,
  dueAt: `2026-10-16T10:30:00.000Z`,
  startedAt: `2026-10-16T10:30:00.000Z`,
  finishedAt: `2026-10-16T10:30:01.000Z`,
  errorCode: `TimeoutError`,
}

const COUNTS: Record<AdminJobStateFilter, number> = {
  all: 3,
  failed: 1,
  retrying: 0,
  scheduled: 2,
  running: 0,
  done: 0,
  cancelled: 0,
}

interface Options {
  role?: UserRole
  signedOut?: boolean
  outcome?: AdminJobActionOutcome
  /** The job read back after an action; `null` for one the table no longer has. */
  record?: AdminJobRecord | null
  /** The page of runs the list reads; the failed run alone unless given. */
  list?: AdminJobRecord[]
}

function buildApp(options: Options = {}) {
  const calls: unknown[][] = []
  const outcome = options.outcome ?? AdminJobActionOutcome.Done
  const record = options.record === undefined ? failed : options.record
  const action = (name: string) => (id: string, operatorId: number, requestId: string | null) => (
    calls.push([name, id, operatorId, requestId]), Promise.resolve(outcome)
  )
  const jobs: AdminJobsStore = {
    list: (
      filter,
      match,
    ) => (calls.push([`list`, filter, match]),
      Promise.resolve({ jobs: options.list ?? [failed], counts: COUNTS, total: 1 })),
    job: (id) => (calls.push([`job`, id]), Promise.resolve(record)),
    user: (
      table,
      aggregateId,
    ) => (calls.push([`user`, table, aggregateId]),
      Promise.resolve({ id: 42, name: `Ada Lovelace` })),
    group: (groupId) => (calls.push([`group`, groupId]), Promise.resolve(null)),
    photos: (imageIds, languages) => (calls.push([`photos`, imageIds, languages]),
      Promise.resolve(
        new Map(
          imageIds.filter((id) => id === PHOTO_ID).map((id) => [id, {
            id,
            ready: true,
            itemId: ITEM_ID,
            itemName: `Zip jacket`,
          }]),
        ),
      )),
    repeating: (kinds) => (calls.push([`repeating`, kinds]),
      Promise.resolve([{
        kind: `outbox.cleanup`,
        lastRunAt: new Date(`2026-10-16T03:00:05.000Z`),
        lastFailed: false,
        nextId: JOB_ID,
        nextRunAt: new Date(`2026-10-17T03:00:05.000Z`),
        running: false,
      }])),
    retry: action(`retry`),
    runNow: action(`runNow`),
    cancel: action(`cancel`),
    retryAll: (
      operatorId,
      requestId,
      limit,
    ) => (calls.push([`retryAll`, operatorId, requestId, limit]), Promise.resolve(3)),
    runRepeatingNow: (kind, operatorId, requestId) => (
      calls.push([`runRepeatingNow`, kind, operatorId, requestId]),
        Promise.resolve({ outcome, id: outcome === AdminJobActionOutcome.Done ? JOB_ID : null })
    ),
  }
  const app = mountRoute(
    `/admin`,
    createAdminRoute({
      auth: testSessionGuards(),
      mutationGuards: testMutationGuards,
      modules: [
        createAdminJobsRoutes({
          limit: passThrough,
          jobs,
          registry: REGISTRY,
          languages: [`vi`, `en`],
        }),
      ],
    }),
    options.signedOut ? null : buildAuthData({
      user: { id: 7, role: options.role ?? UserRole.OPERATOR },
    }),
  )
  return { app, calls }
}

function send(
  app: ReturnType<typeof buildApp>[`app`],
  method: string,
  path: string,
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}/admin${path}`, { method, headers: { ...headers } })
}

const ROUTES: [string, string][] = [
  [`GET`, `/jobs`],
  [`GET`, `/jobs/repeating`],
  [`GET`, `/jobs/${JOB_ID}`],
  [`POST`, `/jobs/${JOB_ID}/retry`],
  [`POST`, `/jobs/${JOB_ID}/run-now`],
  [`POST`, `/jobs/${JOB_ID}/cancel`],
  [`POST`, `/jobs/repeating/outbox.cleanup/run-now`],
  [`POST`, `/jobs/retry-failed`],
]

describe(`jobs routes`, () => {
  for (const [method, path] of ROUTES) {
    it(`answers 404 to a viewer on ${method} ${path} and touches nothing`, async () => {
      const { app, calls } = buildApp({ role: UserRole.VIEWER })
      expect((await send(app, method, path)).status).toBe(404)
      expect(calls).toEqual([])
    })

    it(`answers 401 without a session on ${method} ${path} and touches nothing`, async () => {
      const { app, calls } = buildApp({ signedOut: true })
      expect((await send(app, method, path, sameOriginWithoutCookieHeaders)).status).toBe(401)
      expect(calls).toEqual([])
    })
  }

  for (const [method, path] of ROUTES.filter(([method]) => method === `POST`)) {
    it(`refuses a cross-site ${path} before it reaches a job`, async () => {
      const { app, calls } = buildApp()
      expect((await send(app, method, path, crossSiteHeaders)).status).toBe(403)
      expect(calls).toEqual([])
    })
  }

  it(`lists runs with their names, the chips' counts and no aggregate id`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, `GET`, `/jobs?state=failed&q=reset&page=2`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(calls[0].slice(0, 2)).toEqual([`list`, { query: `reset`, state: `failed`, page: 2 }])
    expect(body).toMatchObject({ counts: COUNTS, total: 1, page: 2, pageSize: 50, keptDays: 7 })
    const { aggregateId: _, ...row } = failed
    expect(body.jobs).toEqual([{ ...row, label: `Password reset email`, photo: null }])
    expect(calls.map((call) => call[0])).not.toContain(`photos`)
  })

  it(`names an image job's catalog photo and its item, in the list and on its page`, async () => {
    const { app, calls } = buildApp({
      list: [imageJob(PHOTO_ID), imageJob(PICTURE_ID), failed],
      record: imageJob(PHOTO_ID),
    })
    const photo = { id: PHOTO_ID, ready: true, itemId: ITEM_ID, itemName: `Zip jacket` }

    const list = await (await send(app, `GET`, `/jobs`)).json()
    expect(list.jobs.map((job: { photo: unknown }) => job.photo)).toEqual([photo, null, null])
    // One read for the page, of the image jobs only, in the catalog's languages.
    expect(calls.filter((call) => call[0] === `photos`)).toEqual([
      [`photos`, [PHOTO_ID, PICTURE_ID], [`vi`, `en`]],
    ])

    const page = await (await send(app, `GET`, `/jobs/${imageJob(PHOTO_ID).id}`)).json()
    expect(page).toMatchObject({ photo, about: null })
  })

  it(`finds a job by its name's words in any order, a prefix or its kind`, () => {
    expect(jobMatch(`email reset`, REGISTRY)?.kinds).toEqual([`auth.password-reset-mail`])
    expect(jobMatch(`nigh`, REGISTRY)?.kinds).toEqual([`outbox.cleanup`])
    expect(jobMatch(`billing.seat`, REGISTRY)?.kinds).toContain(`billing.seat-sync`)
    expect(jobMatch(`group.changed`, REGISTRY)).toEqual({ kinds: [], text: `group.changed` })
    expect(jobMatch(`  `, REGISTRY)).toBeNull()
  })

  it(`shows one run with its name, what it is about and when it is removed`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, `GET`, `/jobs/${JOB_ID.toUpperCase()}`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      id: JOB_ID,
      label: `Password reset email`,
      sendsMail: true,
      repeats: null,
      about: { type: `user`, id: 42, name: `Ada Lovelace` },
      keptUntil: `2026-10-23T10:30:01.000Z`,
    })
    expect(body.aggregateId).toBeUndefined()
    expect(calls).toContainEqual([`user`, `password_requests`, ABOUT_ID])
  })

  it(`answers 404 for an id that is no UUID, or no job's, and touches nothing for the first`, async () => {
    const bad = buildApp()
    expect((await send(bad.app, `GET`, `/jobs/1%20OR%201=1`)).status).toBe(404)
    expect((await send(bad.app, `POST`, `/jobs/1%20OR%201=1/cancel`)).status).toBe(404)
    expect(bad.calls).toEqual([])

    const { app } = buildApp({ record: null })
    const response = await send(app, `GET`, `/jobs/${JOB_ID}`)
    expect(response.status).toBe(404)
    expect((await apiError(response)).message).toBe(ADMIN_JOB_NOT_FOUND)
  })

  for (const [path, name] of [[`retry`, `retry`], [`run-now`, `runNow`], [`cancel`, `cancel`]]) {
    it(`${path}: acts for the operator, naming them and the request, and answers the run`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, `POST`, `/jobs/${JOB_ID}/${path}`)

      expect(response.status).toBe(200)
      expect((await response.json()).job).toMatchObject({
        id: JOB_ID,
        label: `Password reset email`,
      })
      expect(calls[0]).toEqual([name, JOB_ID, 7, `req-test-1`])
    })

    it(`${path}: answers 409 when the run's state no longer allows it`, async () => {
      const { app } = buildApp({ outcome: AdminJobActionOutcome.NotFound })
      const response = await send(app, `POST`, `/jobs/${JOB_ID}/${path}`)

      expect(response.status).toBe(409)
      expect((await apiError(response)).message).toBe(ADMIN_JOB_STALE)
    })

    it(`${path}: answers 404 when no job has the id`, async () => {
      const { app } = buildApp({ outcome: AdminJobActionOutcome.NotFound, record: null })
      expect((await send(app, `POST`, `/jobs/${JOB_ID}/${path}`)).status).toBe(404)
    })
  }

  it(`refuses to cancel a kind the registry marks, with its reason, and says so on its page`, async () => {
    const waiting = { ...failed, kind: `blog.publish`, state: AdminJobState.Scheduled }
    const { app } = buildApp({ outcome: AdminJobActionOutcome.NotCancellable, record: waiting })
    const response = await send(app, `POST`, `/jobs/${JOB_ID}/cancel`)

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(`Unschedule the post on the Blog page.`)
    expect((await (await send(app, `GET`, `/jobs/${JOB_ID}`)).json()).cancellable).toBe(false)
    expect((await (await send(buildApp().app, `GET`, `/jobs/${JOB_ID}`)).json()).cancellable)
      .toBe(true)
  })

  it(`answers 409 to run again when a newer run of the job already waits`, async () => {
    const { app } = buildApp({ outcome: AdminJobActionOutcome.Superseded })
    const response = await send(app, `POST`, `/jobs/${JOB_ID}/retry`)

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(ADMIN_JOB_SUPERSEDED)
  })

  it(`lists each repeating job with its schedule in words, last run and next run`, async () => {
    const { app, calls } = buildApp()
    const body = await (await send(app, `GET`, `/jobs/repeating`)).json()

    expect(calls).toEqual([[`repeating`, [`outbox.cleanup`]]])
    expect(body.jobs).toEqual([{
      kind: `outbox.cleanup`,
      label: `Nightly cleanup`,
      schedule: `Every day`,
      sendsMail: false,
      lastRunAt: `2026-10-16T03:00:05.000Z`,
      lastFailed: false,
      nextId: JOB_ID,
      nextRunAt: `2026-10-17T03:00:05.000Z`,
      running: false,
    }])
  })

  it(`runs a repeating job now, and refuses a kind that does not repeat without touching it`, async () => {
    const { app, calls } = buildApp()
    expect((await send(app, `POST`, `/jobs/repeating/outbox.cleanup/run-now`)).status).toBe(200)
    expect(calls).toEqual([[`runRepeatingNow`, `outbox.cleanup`, 7, `req-test-1`]])

    const other = buildApp()
    expect((await send(other.app, `POST`, `/jobs/repeating/billing.seat-sync/run-now`)).status)
      .toBe(404)
    expect((await send(other.app, `POST`, `/jobs/repeating/no.such/run-now`)).status).toBe(404)
    expect(other.calls).toEqual([])
  })

  it(`answers 409 to run a repeating job now while it runs`, async () => {
    const { app } = buildApp({ outcome: AdminJobActionOutcome.Superseded })
    const response = await send(app, `POST`, `/jobs/repeating/outbox.cleanup/run-now`)

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(ADMIN_JOB_RUNNING)
  })

  it(`runs every failed job again, up to the cap, and says how many`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, `POST`, `/jobs/retry-failed`)

    expect(await response.json()).toEqual({ retried: 3 })
    expect(calls).toEqual([[`retryAll`, 7, `req-test-1`, ADMIN_JOBS_RETRY_ALL_MAX]])
  })
})
