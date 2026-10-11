/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { createPushTokenStore } from "../../apps/api/services/push-token-store.ts"
import { createWebPushService } from "../../apps/api/services/web-push-service.ts"
import { browserKeys, fakePushService } from "../../apps/api/_testing/web-push.ts"
import { generateVapidKeyPair } from "@spy4x/integrations/push"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

interface IdRow extends postgres.Row {
  id: number
}

interface CountRow extends postgres.Row {
  count: number
}

const MIGRATIONS = "libs/server/db/migrations"
const PUSH_MIGRATION = "2026_09_30_0001_push_token_one_per_device.sql"

const KEYS = await browserKeys()
const VAPID_JSON = JSON.stringify((await generateVapidKeyPair()).keys)

/** A service over `sql` whose push service is in memory and answers `failures` per endpoint. */
async function serviceOver(sql: postgres.Sql, failures: Record<string, number> = {}) {
  const push = fakePushService(failures)
  const service = await createWebPushService(VAPID_JSON, push.options, createPushTokenStore(sql))
  return { service, endpoints: () => push.requests.map((request) => request.endpoint) }
}

async function applyMigration(sql: postgres.Sql, name: string): Promise<void> {
  await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS}/${name}`))
}

async function insertUser(sql: postgres.Sql): Promise<number> {
  const rows = await sql<IdRow[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `
  return rows[0].id
}

Deno.test({
  name: "web push subscriptions in Postgres",
  async fn(t) {
    const connection = buildPostgresOptions(requireDbConnection())
    const admin = postgres({ ...connection, max: 1 })
    const schema = `web_push_test_${uuidV7().replace(/-/g, "")}`
    const open = () =>
      postgres({
        ...connection,
        max: 2,
        transform: postgres.camel,
        connection: { options: `-c search_path=${schema}` },
      })
    const opened: postgres.Sql[] = []
    const connect = () => {
      const sql = open()
      opened.push(sql)
      return sql
    }
    const sql = connect()

    try {
      await admin`CREATE SCHEMA ${admin(schema)}`
      const names = [...Deno.readDirSync(MIGRATIONS)].map((entry) => entry.name).sort()
      const before = names.filter((name) => name < PUSH_MIGRATION)
      for (const name of before) await applyMigration(sql, name)

      const userA = await insertUser(sql)
      const userB = await insertUser(sql)
      // Two live rows for the same user and device, as the old code could leave behind. The
      // lower id was refreshed later (the old code updated the existing row in place), so it is
      // the live subscription and must survive.
      await sql`
        INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh, updated_at)
        VALUES (${userA}, ${"phone"}, ${"https://push.example/new"}, ${KEYS.auth}, ${KEYS.p256dh},
          '2026-09-02T00:00:00Z')`
      await sql`
        INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh, updated_at)
        VALUES (${userA}, ${"phone"}, ${"https://push.example/old"}, ${KEYS.auth}, ${KEYS.p256dh},
          '2026-09-01T00:00:00Z')`
      await applyMigration(sql, PUSH_MIGRATION)

      await t.step(
        "the migration keeps the most recently refreshed live row of a duplicated device",
        async () => {
          const rows = await sql<{ endpoint: string }[]>`
          SELECT endpoint FROM user_push_tokens WHERE deleted_at IS NULL`
          expect(rows.map((row) => row.endpoint)).toEqual(["https://push.example/new"])
        },
      )

      await t.step("subscribing twice from one device keeps one live subscription", async () => {
        const { service } = await serviceOver(sql)
        for (const endpoint of ["https://push.example/a1", "https://push.example/a2"]) {
          await service.subscribe(
            { endpoint, keys: KEYS, expirationTime: null },
            "tablet",
            userB,
          )
        }
        const rows = await sql<CountRow[]>`
          SELECT COUNT(*)::int AS count FROM user_push_tokens
          WHERE user_id = ${userB} AND device_id = ${"tablet"} AND deleted_at IS NULL`
        expect(rows[0].count).toBe(1)
      })

      await t.step("subscriptions survive an API restart and send stays per user", async () => {
        const { service: before } = await serviceOver(sql)
        await before.subscribe(
          {
            endpoint: "https://push.example/a-laptop",
            keys: KEYS,
            expirationTime: null,
          },
          "laptop",
          userA,
        )
        // A restart: a new client and a new service over the same database, nothing in memory.
        const restartedSql = connect()
        const { service: restarted, endpoints } = await serviceOver(restartedSql)
        await restarted.send(userA, { title: "Hi", body: "There", url: null })
        expect(endpoints().sort()).toEqual([
          "https://push.example/a-laptop",
          "https://push.example/new",
        ])
      })

      await t.step("a gone subscription is deleted for its user only", async () => {
        // The same browser signed in as user B holds the same endpoint; it is not A's to delete.
        await sql`
          INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
          VALUES (${userB}, ${"phone"}, ${"https://push.example/new"}, ${KEYS.auth}, ${KEYS.p256dh})`
        const { service } = await serviceOver(sql, { "https://push.example/new": 410 })
        await service.send(userA, { title: "Hi", body: "There", url: null })
        const devices = await service.deviceList(userA)
        expect(devices.map((device) => device.deviceId)).toEqual(["laptop"])
        expect((await service.deviceList(userB)).length).toBe(2)
      })

      await t.step("unsubscribing one user leaves another user's same device id live", async () => {
        const { service } = await serviceOver(sql)
        for (const user of [userA, userB]) {
          await service.subscribe(
            {
              endpoint: `https://push.example/shared-${user}`,
              keys: KEYS,
              expirationTime: null,
            },
            "shared",
            user,
          )
        }
        await service.unsubscribe("shared", userA)
        const ids = (device: string, user: number) =>
          service.deviceList(user).then((list) => list.filter((d) => d.deviceId === device).length)
        expect(await ids("shared", userA)).toBe(0)
        expect(await ids("shared", userB)).toBe(1)
      })
    } finally {
      try {
        await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
      } finally {
        for (const client of opened) await client.end()
        await admin.end()
      }
    }
  },
})
