import { Hono } from "hono"
import { createHealthHandler } from "@spy4x/server/http/health"

interface HealthChecks {
  isDbConnected: () => Promise<boolean>
  isCacheConnected: () => Promise<boolean>
}

/**
 * `GET /` reports the database and the cache as `{ status, checks: { database, cache }, date }`.
 * With the database down it answers 503 and `status: "down"`: nothing works. With only Valkey down
 * it stays 200 and says `"degraded"`: the API still serves from Postgres, and a container restart
 * would not bring Valkey back.
 */
export function createHealthRoute(checks: HealthChecks): Hono {
  const health = createHealthHandler({
    required: { database: checks.isDbConnected },
    optional: { cache: checks.isCacheConnected },
  })
  return new Hono().get("/", () => health())
}
