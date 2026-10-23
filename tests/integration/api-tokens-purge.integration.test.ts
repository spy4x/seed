/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { sha256Hex } from "@spy4x/platform/tokens"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { API_TOKEN_PURGE_GRACE_DAYS, ApiTokenAccess } from "@domain/api-tokens"
import { AuthAuditEventType } from "@domain/identity"
import { purgeExpiredApiTokens } from "@server/api-tokens/purge-expired-api-tokens.ts"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { createOutboxProcessor, startRepeatingJobs } from "@server/jobs/wiring.ts"
import { team } from "./group-team.ts"

/**
 * The worker's purge of expired and revoked personal API tokens (#293) against a real Postgres, on a schema
 * built from the migrations, so the audit row's event type meets the migrated check. Needs the
 * `DB_*` values (recipe in docs/handoff.md); it fails when they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `api_tokens_purge_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name).sort()
    for (const name of names) {
      await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
    }
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

interface PurgeAudit {
  userId: number
  identifier: string
}

/** Every purge audit row, oldest first. */
async function purgeAudits(sql: postgres.Sql): Promise<PurgeAudit[]> {
  return await sql<PurgeAudit[]>`
    SELECT user_id, identifier FROM auth_audits
    WHERE event_type = ${AuthAuditEventType.API_TOKENS_PURGED} ORDER BY id
  `
}

/** The names of the tokens left in the table, sorted. */
async function names(sql: postgres.Sql): Promise<string[]> {
  return (await sql<{ name: string }[]>`SELECT name FROM api_tokens ORDER BY name`)
    .map((row) => row.name)
}

interface Seeded {
  id: string
  hash: string
}

/**
 * Writes one token per entry for `userId` in `groupId`. A number is how many days ago the token
 * expired, by the database clock (negative: it expires that far ahead); `null` never expires.
 */
async function seed(
  sql: postgres.Sql,
  userId: number,
  groupId: string,
  tokens: Record<string, number | null>,
): Promise<Record<string, Seeded>> {
  const seeded: Record<string, Seeded> = {}
  for (const [name, expiredDaysAgo] of Object.entries(tokens)) {
    const token = { id: uuidV7(), hash: await sha256Hex(`${name}-${uuidV7()}`) }
    seeded[name] = token
    await sql`
      INSERT INTO api_tokens (id, user_id, group_id, name, token_hash, access, expires_at)
      VALUES (${token.id}, ${userId}, ${groupId}, ${name}, ${token.hash}, ${ApiTokenAccess.READ},
        now() - make_interval(days => ${expiredDaysAgo}::int))
    `
  }
  return seeded
}

/** What a purge row says of a seeded token: its id, group, access and name. */
function named(token: Seeded, groupId: string, name: string): string {
  return `${token.id} group=${groupId} access=read name=${name}`
}

const OLD = API_TOKEN_PURGE_GRACE_DAYS + 1
const RECENT = API_TOKEN_PURGE_GRACE_DAYS - 1

Deno.test("purge: a token expired longer ago than the grace period is deleted, others stay", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    await seed(sql, owner, groupId, {
      "long-expired": OLD,
      "just-expired": RECENT,
      "live": -30,
      "never-expires": null,
    })

    expect(await purgeExpiredApiTokens(sql)).toBe(1)

    expect(await names(sql)).toEqual(["just-expired", "live", "never-expires"])
  })
})

Deno.test("purge: a token of a soft-deleted group or account goes by its own expiry only", async () => {
  await withSchema(async (sql) => {
    const gone = await team(sql)
    await seed(sql, gone.owner, gone.groupId, {
      "deleted-group-live": -30,
      "deleted-group-never": null,
      "deleted-group-just-expired": RECENT,
      "deleted-group-long-expired": OLD,
    })
    await sql`
      UPDATE groups SET deleted_at = now() - make_interval(days => ${OLD}) WHERE id = ${gone.groupId}
    `
    const left = await team(sql)
    await seed(sql, left.owner, left.groupId, { "deleted-account-live": -30 })
    await sql`
      UPDATE users SET deleted_at = now() - make_interval(days => ${OLD}) WHERE id = ${left.owner}
    `

    expect(await purgeExpiredApiTokens(sql)).toBe(1)

    expect(await names(sql)).toEqual([
      "deleted-account-live",
      "deleted-group-just-expired",
      "deleted-group-live",
      "deleted-group-never",
    ])
  })
})

Deno.test("purge: every expired token deleted gets an audit row for its owner that names it, never its hash", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin } = await team(sql)
    const mine = await seed(sql, owner, groupId, { "old-a": OLD, "old-b": OLD + 200, "live": -30 })
    const theirs = await seed(sql, admin, groupId, { "old-c": OLD })

    expect(await purgeExpiredApiTokens(sql)).toBe(3)

    const audits = await purgeAudits(sql)
    const sorted = (rows: PurgeAudit[]) =>
      rows.map((row) => `${row.userId} ${row.identifier}`).toSorted()
    expect(sorted([...audits])).toEqual(sorted([
      { userId: owner, identifier: named(mine["old-a"], groupId, "old-a") },
      { userId: owner, identifier: named(mine["old-b"], groupId, "old-b") },
      { userId: admin, identifier: named(theirs["old-c"], groupId, "old-c") },
    ]))
    const stored = JSON.stringify(audits)
    for (const token of [...Object.values(mine), ...Object.values(theirs)]) {
      expect(stored).not.toContain(token.hash)
    }
  })
})

Deno.test("purge: the longest name and ids fit the audit row", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    const name = "🔑".repeat(60)
    const tokens = await seed(sql, owner, groupId, { [name]: OLD })

    expect(await purgeExpiredApiTokens(sql)).toBe(1)

    expect(await purgeAudits(sql)).toEqual([
      { userId: owner, identifier: named(tokens[name], groupId, name) },
    ])
  })
})

Deno.test("purge: a token revoked longer ago than the grace period is deleted without a second audit row", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    const tokens = await seed(sql, owner, groupId, {
      "revoked-long-ago": -30,
      "revoked-lately": null,
      "live": -30,
    })
    await sql`
      UPDATE api_tokens SET revoked_at = now() - make_interval(days => ${OLD})
      WHERE id = ${tokens["revoked-long-ago"].id}
    `
    await sql`
      UPDATE api_tokens SET revoked_at = now() - make_interval(days => ${RECENT})
      WHERE id = ${tokens["revoked-lately"].id}
    `

    expect(await purgeExpiredApiTokens(sql)).toBe(1)

    expect(await names(sql)).toEqual(["live", "revoked-lately"])
    expect(await purgeAudits(sql)).toEqual([])
  })
})

Deno.test("purge: a run that finds nothing to delete writes no audit row", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    await seed(sql, owner, groupId, { "just-expired": RECENT, "live": -30 })

    expect(await purgeExpiredApiTokens(sql)).toBe(0)

    expect(await purgeAudits(sql)).toEqual([])
    expect(await names(sql)).toEqual(["just-expired", "live"])
  })
})

Deno.test("purge: when the audit row cannot be written, no token is deleted", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    await seed(sql, owner, groupId, { "long-expired": OLD })
    await sql`
      CREATE FUNCTION refuse_audit_row() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'no audit rows in this test'; END $$
    `
    await sql`
      CREATE TRIGGER refuse_audit_row BEFORE INSERT ON auth_audits
      FOR EACH ROW EXECUTE FUNCTION refuse_audit_row()
    `

    await expect(purgeExpiredApiTokens(sql)).rejects.toThrow("no audit rows in this test")

    expect(await names(sql)).toEqual(["long-expired"])
  })
})

Deno.test("purge: the worker's nightly cleanup deletes long-expired tokens and audits it once", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    const tokens = await seed(sql, owner, groupId, {
      "long-expired": OLD,
      "just-expired": RECENT,
      "live": -30,
    })
    const processor = createOutboxProcessor(sql, {
      store: {} as never,
      sender: { send: () => Promise.reject(new Error("no mail in this test")) },
      brand: { webAppUrl: "http://app.localhost" },
      log: () => {},
    })

    // Started two days ago: its first 03:00 UTC run is due, and the next one it writes differs.
    await startRepeatingJobs(sql, new Date(Date.now() - 2 * 86_400_000))
    await sql`
      UPDATE outbox_events SET available_at = now() - interval '1 second'
      WHERE event_kind = ${OUTBOX_CLEANUP_JOB} AND processed_at IS NULL
    `
    expect((await processor.drainOnce()).failed).toBe(0)

    expect(await names(sql)).toEqual(["just-expired", "live"])
    expect(await purgeAudits(sql)).toEqual([
      { userId: owner, identifier: named(tokens["long-expired"], groupId, "long-expired") },
    ])
  })
})
