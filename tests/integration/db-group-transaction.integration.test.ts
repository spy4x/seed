/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations } from "./migrations.ts"

/**
 * Proves docs/handoff.md trap 5 against the real class `apps/api/services/db.ts`'s `DbService`
 * extends: `AppDbBase.group` must be built fresh on every access, not cached on the
 * instance, because `DbServiceBase.begin()` derives its transactional clone with
 * `Object.create(this)` and rebinds `sql` on the clone - a repository built once and
 * reused would keep pointing at the pool client instead of the transaction handle, and a
 * write made through it inside `begin()` would commit outside the rollback it was supposed
 * to be part of.
 *
 * This test imports `AppDbBase` itself rather than a lookalike class defined here. An
 * earlier version of this file defined its own `TestDb` with the same `get group()`
 * shape, and a reviewer showed that guards nothing: caching `group` in the real
 * `AppDbBase` (then still inline in `DbService`) left that copy, and this test, green -
 * only the e2e sign-up flow went red. `tests/integration/db.integration.test.ts` covers
 * the same `begin()`/cache-deferral mechanics but never constructs a `group`-shaped
 * repository, so it cannot catch this regression either. See the PR body for the red/green
 * run against `AppDbBase` itself that demonstrates this test now does.
 */

interface IdRow extends postgres.Row {
  id: number
}

interface CountRow extends postgres.Row {
  count: number
}

Deno.test({
  name: "a repository built through db.group rolls back with its transaction",
  async fn() {
    const connection = buildPostgresOptions(requireDbConnection())
    const admin = postgres({ ...connection, max: 1 })
    const schema = `db_group_tx_test_${uuidV7().replace(/-/g, "")}`
    const sql = postgres({
      ...connection,
      max: 5,
      transform: postgres.camel,
      connection: { options: `-c search_path=${schema}` },
    })

    try {
      await admin`CREATE SCHEMA ${admin(schema)}`
      await applyMigrations(sql)

      const [{ id: userId }] = await sql<IdRow[]>`
        WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
        INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
      `
      const groupId = uuidV7()
      const db = new AppDbBase({ sql })

      await expect(
        db.begin(async (tx) => {
          await tx.group.createFirst({ id: groupId, name: "must roll back" }, userId)
          throw new Error("rollback")
        }),
      ).rejects.toThrow("rollback")

      const rows = await sql<CountRow[]>`
        SELECT COUNT(*)::int AS count FROM groups WHERE id = ${groupId}
      `
      expect(rows[0].count).toBe(0)
    } finally {
      await sql.end({ timeout: 5 })
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
      await admin.end({ timeout: 5 })
    }
  },
})
