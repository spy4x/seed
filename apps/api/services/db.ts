import postgres from "postgres"
import { createSqlFromEnv, type Sql } from "@spy4x/server/db"
import { publicAPICache } from "./cache.ts"
import { AppDbBase } from "./db-base.ts"
// import { getLatestMetrics } from "../routes/metric.ts"

/**
 * The client every table method and the group repository run against.
 *
 * `DB_PORT` is optional so existing environments that omit it keep the 5432 default,
 * but it is honoured when set - `.env.example` and CI both define it.
 */
export const sql: Sql = (() => {
  const client = createSqlFromEnv(Deno.env.toObject(), {
    transform: postgres.camel,
    applicationName: "app-backend",
    // The driver's own default (postgres@3.4.7 src/index.js:449) was 10, not the
    // package's default of 15; compose limits Postgres to max_connections=30 and both
    // this pool and the worker's draw from it, so the old ceiling is kept explicitly.
    max: 10,
  })
  if (!client) {
    throw new Error("Missing environment variable: DB_HOST")
  }
  return client
})()

export class DbService extends AppDbBase {
  constructor() {
    super({ sql, userCache: publicAPICache.user })
  }
}

export const db = new DbService()
await db.connect()
console.log(`✅ Connected to DB`)
