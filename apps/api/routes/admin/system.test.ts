import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { AdminHealth, type AdminSystemSnapshot, UserRole } from "@domain/identity"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import { type AdminSystemStore, createAdminSystemRoutes } from "./system.ts"

const NOW = new Date("2026-10-16T09:00:00.000Z")
const PROBE_TIMEOUT_MS = 30
const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

interface Options {
  role?: UserRole
  /** No session at all. */
  signedOut?: boolean
  /** A database read that never answers. */
  hang?: keyof AdminSystemStore
  databaseConnected?: boolean
  cache?: () => Promise<boolean>
  files?: () => Promise<boolean>
  oldestDueAt?: Date | null
  failed?: number
  lastBackup?: Date | null
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
  }
  const route = createAdminSystemRoutes({
    limit: passThrough,
    now: () => NOW,
    system,
    cacheConnected: options.cache ?? (() => Promise.resolve(true)),
    fileStoreReachable: options.files ?? (() => Promise.resolve(true)),
    build: { version: "v1.2.3", commit: "abc1234" },
    runtime: "Deno/2.9.7",
    startedAt: new Date("2026-10-16T08:00:00.000Z"),
    probeTimeoutMs: PROBE_TIMEOUT_MS,
  })
  if (options.hang) {
    // Never settles, like a database that took the query and stopped answering.
    system[options.hang] = () => new Promise<never>(() => {})
  }
  const app = mountRoute(
    "/admin",
    createAdminRoute({
      auth: testSessionGuards(),
      mutationGuards: testMutationGuards,
      modules: [route],
    }),
    options.signedOut ? null : buildAuthData({
      user: { id: 7, role: options.role ?? UserRole.OPERATOR },
    }),
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
  for (const [method, path] of [["GET", "/system"]]) {
    it(`answers 404 to a viewer on ${method} ${path} and reads nothing`, async () => {
      const { app, calls } = buildApp({ role: UserRole.VIEWER })
      const response = await send(app, method, path)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
    })

    it(`answers 401 without a session on ${method} ${path} and reads nothing`, async () => {
      const { app, calls } = buildApp({ signedOut: true })
      const response = await send(app, method, path, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })
  }

  // Each database read waits no longer than a probe: one that hangs shows its part as an error
  // and the page still answers.
  const hangs: [keyof AdminSystemStore, (body: AdminSystemSnapshot) => unknown, Options][] = [
    ["databaseConnected", (body) => body.database.reachable, {}],
    ["database", (body) => body.database.health, {}],
    ["queue", (body) => body.queue.health, {}],
    ["lastBackup", (body) => body.backup.health, {}],
    ["migrations", (body) => body.migrations.health, {}],
  ]
  for (const [read, part, options] of hangs) {
    it(`answers in time and shows the part as missing when ${read} never answers`, async () => {
      const healthy = part(await snapshot(options))
      const body = await snapshot({ ...options, hang: read })

      expect(part(body)).not.toEqual(healthy)
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
    expect(body.fileStore).toMatchObject({ health: AdminHealth.OK, reachable: true })
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
      "fileStore",
      "health",
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
    expect(Object.keys(body.fileStore).sort()).toEqual(["health", "latencyMs", "reachable"])
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

  it("shows the file store as an error, and the stack with it, when it does not answer", async () => {
    const body = await snapshot({ files: () => Promise.resolve(false) })

    expect(body.fileStore).toMatchObject({ health: AdminHealth.ERROR, reachable: false })
    expect(body.cache.health).toBe(AdminHealth.OK)
    expect(body.health).toBe(AdminHealth.ERROR)
  })

  it("warns about a queue whose oldest due job waits more than five minutes", async () => {
    const body = await snapshot({ oldestDueAt: new Date("2026-10-16T08:54:00.000Z") })

    expect(body.queue.health).toBe(AdminHealth.WARNING)
    expect(body.health).toBe(AdminHealth.WARNING)
  })

  it("warns while any job failed", async () => {
    const body = await snapshot({ failed: 1 })

    expect(body.queue).toMatchObject({ failed: 1, health: AdminHealth.WARNING })
  })

  it("shows a missing backup as an error", async () => {
    const body = await snapshot({ lastBackup: null })

    expect(body.backup).toEqual({ health: AdminHealth.ERROR, succeededAt: null })
  })
})
