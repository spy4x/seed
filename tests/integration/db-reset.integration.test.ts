/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { recreateDatabase } from "../../infra/scripts/db-reset.ts"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

Deno.test("recreateDatabase empties an existing database and keeps its name", async () => {
  const { connection: c } = requireDbConnection()
  const name = `reset_${uuidV7().replaceAll("-", "").slice(-12)}`
  const env = {
    DB_HOST: c.host,
    DB_PORT: String(c.port),
    DB_USER: c.user,
    DB_PASS: c.password,
    DB_NAME: name,
  }
  const connect = (database: string) => postgres({ ...c, database, max: 1 })
  const admin = connect(c.database)
  try {
    await recreateDatabase(env)
    let sql = connect(name)
    await sql`CREATE TABLE leftover (id int)`
    // An open connection must not stop the reset.
    await recreateDatabase(env)
    sql = connect(name)
    const [row] = await sql`SELECT to_regclass('leftover') AS t`
    expect(row.t).toBeNull()
    await sql.end({ timeout: 5 })
  } finally {
    await admin`DROP DATABASE IF EXISTS ${admin(name)} WITH (FORCE)`
    await admin.end({ timeout: 5 })
  }
})
