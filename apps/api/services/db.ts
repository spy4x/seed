import postgres from "postgres"
import { createSqlFromEnv, type Sql } from "@spy4x/server/db"
import { publicAPICache } from "./cache.ts"
import { AppDbBase } from "./db-base.ts"
import { directDbEnv } from "./db-direct.ts"
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
    // In Compose these are connections to PgBouncer, which holds the connections to Postgres
    // (docs/stack.md, "Database connections"). 10 is the driver's own default
    // (postgres@3.4.7 src/index.js:449), kept explicitly over the package's 15.
    max: 10,
  })
  if (!client) {
    throw new Error("Missing environment variable: DB_HOST")
  }
  return client
})()

/**
 * The client `LISTEN` runs on, and nothing else: it connects to Postgres directly, past
 * PgBouncer (`directDbEnv`). The driver opens one connection of its own for every channel listened
 * to, so this pool never opens another.
 */
export const listenSql: Sql = (() => {
  const client = createSqlFromEnv(directDbEnv(Deno.env.toObject()), {
    transform: postgres.camel,
    applicationName: "app-backend-listen",
    max: 1,
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
