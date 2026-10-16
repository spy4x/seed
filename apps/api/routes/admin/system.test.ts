import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import {
  ADMIN_FAILED_JOBS_LIMIT,
  type AdminFailedJob,
  AdminHealth,
  AdminJobRetryOutcome,
  UserRole,
} from "@domain/identity"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import {
  ADMIN_JOB_NOT_FOUND,
  ADMIN_JOB_SUPERSEDED,
  type AdminSystemStore,
  createAdminSystemRoutes,
} from "./system.ts"

const NOW = new Date("2026-10-16T09:00:00.000Z")
const JOB_ID = "01927f3e-6b2a-7c3d-8e4f-5a6b7c8d9e0f"
const PROBE_TIMEOUT_MS = 30
const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const failedJob: AdminFailedJob = {
  id: JOB_ID,
  kind: "mail.password_reset",
  attempts: 20,
  errorCode: "MailSendError",
  failedAt: "2026-10-16T08:00:00.000Z",
  retryable: true,
}

interface Options {
  role?: UserRole
  databaseConnected?: boolean
  cache?: () => Promise<boolean>
  oldestDueAt?: Date | null
  failed?: number
  lastBackup?: Date | null
  outcome?: AdminJobRetryOutcome
}

function buildApp(options: Options = {}) {
  const calls: unknown[][] = []
  const system: AdminSystemStore = {
    databaseConnected: () => Promise.resolve(options.databaseConnected ?? true),
    database: () => (calls.push(["database"]),
      Promise.resolve({
        sizeBytes: 9_000_000,
        version: "18.6",
        startedAt: new Date("2026-10-10T00:00:00.000Z"),
      })),
    queue: () => (calls.push(["queue"]),
      Promise.resolve({
        due: options.oldestDueAt ? 1 : 0,
        oldestDueAt: options.oldestDueAt ?? null,
        scheduled: 2,
        running: 0,
        retrying: 0,
        failed: options.failed ?? 0,
        now: NOW,
      })),
    jobKinds: () =>
      Promise.resolve([{
        kind: "outbox.cleanup",
        lastRunAt: "2026-10-16T08:30:00.000Z",
        lastFailed: false,
        nextRunAt: "2026-10-16T09:30:00.000Z",
      }]),
    failedJobs: (
      limit,
    ) => (calls.push(["failedJobs", limit]), Promise.resolve(options.failed ? [failedJob] : [])),
    lastBackup: () =>
      Promise.resolve(
        options.lastBackup === undefined
          ? new Date("2026-10-16T03:00:00.000Z")
          : options.lastBackup,
      ),
    migrations: () =>
      Promise.resolve({
        applied: 60,
        latest: "2026_11_14_0001_backup_status",
        latestAt: new Date("2026-10-15T00:00:00.000Z"),
      }),
    retryJob: (id, operatorId, requestId) => (
      calls.push(["retryJob", id, operatorId, requestId]),
        Promise.resolve(options.outcome ?? AdminJobRetryOutcome.Retried)
    ),
  }
  const route = createAdminSystemRoutes({
    limit: passThrough,
    now: () => NOW,
    system,
    cacheConnected: options.cache ?? (() => Promise.resolve(true)),
    build: { version: "v1.2.3", commit: "abc1234" },
    runtime: "Deno/2.9.7",
    startedAt: new Date("2026-10-16T08:00:00.000Z"),
    probeTimeoutMs: PROBE_TIMEOUT_MS,
  })
  const app = mountRoute(
    "/admin",
    createAdminRoute({
      auth: testSessionGuards(),
      mutationGuards: testMutationGuards,
      modules: [route],
    }),
    buildAuthData({ user: { id: 7, role: options.role ?? UserRole.OPERATOR } }),
  )
  return { app, calls }
}

function send(
  app: ReturnType<typeof buildApp>["app"],
  method: string,
  path: string,
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}/admin${path}`, { method, headers: { ...headers } })
}

async function snapshot(options: Options = {}) {
  const { app } = buildApp(options)
  const response = await send(app, "GET", "/system")
  expect(response.status).toBe(200)
  return await response.json()
}

describe("system routes", () => {
  for (const [method, path] of [["GET", "/system"], ["POST", `/system/jobs/${JOB_ID}/retry`]]) {
    it(`answers 404 to a viewer on ${method} ${path} and reads nothing`, async () => {
      const { app, calls } = buildApp({ role: UserRole.VIEWER })
      const response = await send(app, method, path)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
    })
  }

  it("shows every part as OK when the stack is healthy, with the build that answered", async () => {
    const body = await snapshot()

    expect(body.health).toBe(AdminHealth.OK)
    expect(body.database).toMatchObject({
      health: AdminHealth.OK,
      reachable: true,
      sizeBytes: 9_000_000,
      version: "18.6",
    })
    expect(body.cache).toMatchObject({ health: AdminHealth.OK, reachable: true })
    expect(body.queue.health).toBe(AdminHealth.OK)
    expect(body.backup).toEqual({
      health: AdminHealth.OK,
      succeededAt: "2026-10-16T03:00:00.000Z",
    })
    expect(body.migrations).toMatchObject({ applied: 60, latest: "2026_11_14_0001_backup_status" })
    expect(body.build).toEqual({
      version: "v1.2.3",
      commit: "abc1234",
      runtime: "Deno/2.9.7",
      startedAt: "2026-10-16T08:00:00.000Z",
    })
  })

  it("names only parts and states, never a service's address or a secret", async () => {
    const body = await snapshot({ failed: 1, oldestDueAt: new Date("2026-10-16T08:59:00.000Z") })

    expect(Object.keys(body).sort()).toEqual([
      "backup",
      "build",
      "cache",
      "checkedAt",
      "database",
      "failedJobs",
      "health",
      "jobs",
      "migrations",
      "queue",
    ])
    expect(Object.keys(body.database).sort()).toEqual([
      "health",
      "latencyMs",
      "reachable",
      "sizeBytes",
      "startedAt",
      "version",
    ])
    expect(Object.keys(body.cache).sort()).toEqual(["health", "latencyMs", "reachable"])
    expect(Object.keys(body.queue).sort()).toEqual([
      "due",
      "failed",
      "health",
      "oldestDueAt",
      "retrying",
      "running",
      "scheduled",
    ])
    expect(Object.keys(body.backup).sort()).toEqual(["health", "succeededAt"])
    expect(Object.keys(body.migrations).sort()).toEqual([
      "applied",
      "health",
      "latest",
      "latestAt",
    ])
    expect(Object.keys(body.build).sort()).toEqual(["commit", "runtime", "startedAt", "version"])
    expect(body.jobs).toHaveLength(1)
    expect(Object.keys(body.jobs[0]).sort()).toEqual([
      "kind",
      "lastFailed",
      "lastRunAt",
      "nextRunAt",
    ])
    expect(body.failedJobs).toHaveLength(1)
    expect(Object.keys(body.failedJobs[0]).sort()).toEqual([
      "attempts",
      "errorCode",
      "failedAt",
      "id",
      "kind",
      "retryable",
    ])
  })

  it("shows the database as an error and reads nothing from it when it does not answer", async () => {
    const { app, calls } = buildApp({ databaseConnected: false })
    const body = await (await send(app, "GET", "/system")).json()

    expect(body.health).toBe(AdminHealth.ERROR)
    expect(body.database).toMatchObject({ health: AdminHealth.ERROR, reachable: false })
    expect(body.backup.health).toBe(AdminHealth.ERROR)
    expect(calls).toEqual([])
  })

  it("shows the cache as an error when it does not answer in time", async () => {
    const body = await snapshot({ cache: () => new Promise(() => {}) })

    expect(body.cache.health).toBe(AdminHealth.ERROR)
    expect(body.cache.reachable).toBe(false)
    expect(body.cache.latencyMs).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS - 5)
    expect(body.health).toBe(AdminHealth.ERROR)
  })

  it("warns about a queue whose oldest due job waits more than five minutes", async () => {
    const body = await snapshot({ oldestDueAt: new Date("2026-10-16T08:54:00.000Z") })

    expect(body.queue.health).toBe(AdminHealth.WARNING)
    expect(body.health).toBe(AdminHealth.WARNING)
  })

  it("lists the failed jobs and warns while any is left", async () => {
    const { app, calls } = buildApp({ failed: 1 })
    const body = await (await send(app, "GET", "/system")).json()

    expect(body.failedJobs).toEqual([failedJob])
    expect(body.queue).toMatchObject({ failed: 1, health: AdminHealth.WARNING })
    expect(calls).toContainEqual(["failedJobs", ADMIN_FAILED_JOBS_LIMIT])
  })

  it("shows a missing backup as an error", async () => {
    const body = await snapshot({ lastBackup: null })

    expect(body.backup).toEqual({ health: AdminHealth.ERROR, succeededAt: null })
  })

  it("runs a failed job again for the operator and names them and the request", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, "POST", `/system/jobs/${JOB_ID.toUpperCase()}/retry`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ retried: true })
    expect(calls).toEqual([["retryJob", JOB_ID, 7, "req-test-1"]])
  })

  it("answers 404 for an id that is no UUID and touches nothing", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, "POST", `/system/jobs/1%20OR%201=1/retry`)

    expect(response.status).toBe(404)
    expect(calls).toEqual([])
  })

  it("answers 404 when no failed job has the id", async () => {
    const { app } = buildApp({ outcome: AdminJobRetryOutcome.NotFound })
    const response = await send(app, "POST", `/system/jobs/${JOB_ID}/retry`)

    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe(ADMIN_JOB_NOT_FOUND)
  })

  it("answers 409 when a newer run of the job already waits", async () => {
    const { app } = buildApp({ outcome: AdminJobRetryOutcome.Superseded })
    const response = await send(app, "POST", `/system/jobs/${JOB_ID}/retry`)

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe(ADMIN_JOB_SUPERSEDED)
  })

  it("refuses a cross-site retry before it reaches the job", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, "POST", `/system/jobs/${JOB_ID}/retry`, crossSiteHeaders)

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })
})
