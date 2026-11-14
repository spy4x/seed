import { Hono } from "hono"
import { createHealthHandler } from "@spy4x/server/http/health"

interface HealthChecks {
  isDbConnected: () => Promise<boolean>
  isCacheConnected: () => Promise<boolean>
  /** `null` while files are off (`FILES=false`): the report then has no `files` check. */
  isFileStoreReachable: (() => Promise<boolean>) | null
}

/**
 * `GET /` reports the database, the cache and the file store as
 * `{ status, checks: { database, cache, files }, date }`, without `files` while files are off: a store
 * nobody runs is never asked, so it cannot hold the answer past the container probe's timeout.
 * With the database down it answers 503 and `status: "down"`: nothing works. With only Valkey down
 * it stays 200 and says `"degraded"`: the API still serves from Postgres, and a container restart
 * would not bring Valkey back. The file store is the same: without it only uploads and downloads fail.
 */
export function createHealthRoute(checks: HealthChecks): Hono {
  const health = createHealthHandler({
    required: { database: checks.isDbConnected },
    optional: {
      cache: checks.isCacheConnected,
      ...(checks.isFileStoreReachable ? { files: checks.isFileStoreReachable } : {}),
    },
  })
  return new Hono().get("/", () => health())
}
