import { Hono } from "hono"
import { deadline } from "@std/async/deadline"
import type { MiddlewareHandler } from "hono"
import {
  AdminHealth,
  type AdminSystemSnapshot,
  backupHealth,
  queueHealth,
  worstHealth,
} from "@domain/identity"
import type { DatabaseFacts, QueueCounts } from "@server/jobs/admin-system.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/**
 * How long the page waits for the database, the cache or the file store to answer before it
 * counts it as down, and for each of its database reads before it shows that part as an error.
 */
export const CACHE_PROBE_TIMEOUT_MS = 2_000

/** When this process started: the API's uptime is counted from it. */
const PROCESS_STARTED_AT = new Date(performance.timeOrigin)

/** The System page's reads. */
export interface AdminSystemStore {
  databaseConnected(): Promise<boolean>
  database(): Promise<DatabaseFacts>
  queue(): Promise<QueueCounts>
  lastBackup(): Promise<Date | null>
  migrations(): Promise<{ applied: number; latest: string | null; latestAt: Date | null }>
}

/** What the System routes call. */
export interface AdminSystemRouteDependencies {
  limit: MiddlewareHandler<APIContext>
  system: AdminSystemStore
  cacheConnected(): Promise<boolean>
  fileStoreReachable(): Promise<boolean>
  build: { version: string | null; commit: string | null }
  now(): Date
  /** The runtime's name and version; `navigator.userAgent` by default, such as `Deno/2.9.7`. */
  runtime?: string
  /** When the API process started; the process's own start by default. */
  startedAt?: Date
  /** How long a probe or a read may take; {@link CACHE_PROBE_TIMEOUT_MS} by default. */
  probeTimeoutMs?: number
}

/**
 * `read()`, or `null` when it throws or outlasts `timeoutMs`: one part that cannot be read leaves
 * the others readable, and a database that stops answering half-way never holds the page.
 */
async function attempt<T>(read: () => Promise<T>, timeoutMs: number): Promise<T | null> {
  try {
    return await deadline(read(), timeoutMs)
  } catch {
    return null
  }
}

/** `probe()` and how long it took; `false` when it throws or outlasts `timeoutMs`. */
async function timed(
  probe: () => Promise<boolean>,
  timeoutMs: number,
): Promise<{ ok: boolean; ms: number }> {
  const started = performance.now()
  const ok = await deadline(probe(), timeoutMs).catch(() => false)
  return { ok, ms: Math.round(performance.now() - started) }
}

/**
 * Reads every part of the System page. A part that cannot be read shows as an error rather than
 * failing the page: the page exists to show what is broken.
 */
export async function readSystemSnapshot(
  dependencies: AdminSystemRouteDependencies,
): Promise<AdminSystemSnapshot> {
  const { system } = dependencies
  const now = dependencies.now()
  const timeout = dependencies.probeTimeoutMs ?? CACHE_PROBE_TIMEOUT_MS
  const [db, cache, files] = await Promise.all([
    timed(() => system.databaseConnected(), timeout),
    timed(() => dependencies.cacheConnected(), timeout),
    timed(() => dependencies.fileStoreReachable(), timeout),
  ])
  const [facts, queue, backup, migrations] = db.ok
    ? await Promise.all([
      attempt(() => system.database(), timeout),
      attempt(() => system.queue(), timeout),
      attempt(() => system.lastBackup(), timeout),
      attempt(() => system.migrations(), timeout),
    ])
    : [null, null, undefined, null]

  const database = {
    health: db.ok && facts ? AdminHealth.OK : AdminHealth.ERROR,
    reachable: db.ok,
    latencyMs: db.ms,
    sizeBytes: facts?.sizeBytes ?? null,
    version: facts?.version ?? null,
    startedAt: facts?.startedAt.toISOString() ?? null,
  }
  const cacheCard = {
    health: cache.ok ? AdminHealth.OK : AdminHealth.ERROR,
    reachable: cache.ok,
    latencyMs: cache.ms,
  }
  const fileStoreCard = {
    health: files.ok ? AdminHealth.OK : AdminHealth.ERROR,
    reachable: files.ok,
    latencyMs: files.ms,
  }
  const queueCard = {
    health: queue ? queueHealth(queue.oldestDueAt, queue.failed, queue.now) : AdminHealth.ERROR,
    due: queue?.due ?? 0,
    oldestDueAt: queue?.oldestDueAt?.toISOString() ?? null,
    scheduled: queue?.scheduled ?? 0,
    running: queue?.running ?? 0,
    retrying: queue?.retrying ?? 0,
    failed: queue?.failed ?? 0,
  }
  // `undefined`: the database could not be asked; `null`: it was, and no backup was ever recorded.
  const backupCard = {
    health: backup === undefined ? AdminHealth.ERROR : backupHealth(backup, now),
    succeededAt: backup?.toISOString() ?? null,
  }
  const migrationsCard = {
    health: migrations && migrations.applied > 0 ? AdminHealth.OK : AdminHealth.ERROR,
    applied: migrations?.applied ?? 0,
    latest: migrations?.latest ?? null,
    latestAt: migrations?.latestAt?.toISOString() ?? null,
  }
  return {
    health: worstHealth(
      database.health,
      cacheCard.health,
      fileStoreCard.health,
      queueCard.health,
      backupCard.health,
      migrationsCard.health,
    ),
    checkedAt: now.toISOString(),
    database,
    cache: cacheCard,
    fileStore: fileStoreCard,
    queue: queueCard,
    backup: backupCard,
    migrations: migrationsCard,
    build: {
      version: dependencies.build.version,
      commit: dependencies.build.commit,
      runtime: dependencies.runtime ?? navigator.userAgent,
      startedAt: (dependencies.startedAt ?? PROCESS_STARTED_AT).toISOString(),
    },
  }
}

/**
 * The System routes of the operator area (#429), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them.
 *
 * - `GET /system` is the snapshot: each part of the stack with its status, the queue, the backup,
 *   the migrations and the build. Names and states only: no environment value, address of a
 *   service or secret. The jobs themselves are the Jobs module's (`jobs.ts`, #394).
 */
export function createAdminSystemRoutes(
  dependencies: AdminSystemRouteDependencies,
): Hono<APIContext> {
  const { limit } = dependencies
  return new Hono<APIContext>()
    .get(`/system`, limit, async (c) => c.json(await readSystemSnapshot(dependencies)))
}

/** The System module: the health of the stack and the job queue. */
export const systemAdminModule: AdminApiModule = {
  id: `system`,
  routes: ({ db, limit, now, cacheConnected, fileStoreReachable, build }) =>
    createAdminSystemRoutes({
      limit,
      now,
      cacheConnected,
      fileStoreReachable,
      build,
      // Read at call time: the routes are built before any request, and with no database in tests.
      system: {
        databaseConnected: () => db.isConnected(),
        database: () => db.adminSystem.database(),
        queue: () => db.adminSystem.queue(),
        lastBackup: () => db.adminSystem.lastBackup(),
        migrations: () => db.adminSystem.migrations(),
      },
    }),
}
