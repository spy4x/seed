/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { sha256Hex } from "@spy4x/platform/tokens"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { API_TOKEN_PURGE_GRACE_DAYS, ApiTokenAccess } from "@domain/api-tokens"
import { AuthAuditEventType } from "@domain/identity"
import {
  API_TOKEN_PURGE_AUDIT_IDS,
  purgeExpiredApiTokens,
} from "@server/api-tokens/purge-expired-api-tokens.ts"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { createOutboxProcessor, scheduleNightlyJobs } from "@server/jobs/wiring.ts"
import { team } from "./group-team.ts"

/**
 * The worker's purge of expired personal API tokens (#293) against a real Postgres, on a schema
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

Deno.test("purge: each owner gets one audit row with the count and the ids of their tokens", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin } = await team(sql)
    const mine = await seed(sql, owner, groupId, { "old-a": OLD, "old-b": OLD + 200, "live": -30 })
    const theirs = await seed(sql, admin, groupId, { "old-c": OLD })

    expect(await purgeExpiredApiTokens(sql)).toBe(3)

    const audits = await purgeAudits(sql)
    expect(audits.toSorted((a, b) => a.userId - b.userId)).toEqual(
      [
        { userId: owner, identifier: `2:${[mine["old-a"].id, mine["old-b"].id].sort().join(",")}` },
        { userId: admin, identifier: `1:${theirs["old-c"].id}` },
      ].toSorted((a, b) => a.userId - b.userId),
    )
    const stored = JSON.stringify(audits)
    for (const token of [...Object.values(mine), ...Object.values(theirs)]) {
      expect(stored).not.toContain(token.hash)
    }
    expect(stored).not.toContain("old-")
  })
})

Deno.test("purge: an owner who lost more tokens than one audit row holds gets a second row", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    const total = API_TOKEN_PURGE_AUDIT_IDS + 1
    const tokens = await seed(
      sql,
      owner,
      groupId,
      Object.fromEntries(Array.from({ length: total }, (_, index) => [`old-${index}`, OLD])),
    )

    expect(await purgeExpiredApiTokens(sql)).toBe(total)

    const audits = await purgeAudits(sql)
    expect(audits.map((row) => row.identifier.split(":")[0]).sort()).toEqual([
      "1",
      `${API_TOKEN_PURGE_AUDIT_IDS}`,
    ])
    const audited = audits.flatMap((row) => row.identifier.split(":")[1].split(","))
    expect(audited.sort()).toEqual(Object.values(tokens).map((token) => token.id).sort())
    for (const row of audits) expect(row.identifier.length).toBeLessThanOrEqual(320)
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

    await scheduleNightlyJobs(sql)
    await sql`
      UPDATE outbox_events SET available_at = now() - interval '1 second'
      WHERE event_kind = ${OUTBOX_CLEANUP_JOB} AND processed_at IS NULL
    `
    expect((await processor.drainOnce()).failed).toBe(0)

    expect(await names(sql)).toEqual(["just-expired", "live"])
    expect(await purgeAudits(sql)).toEqual([
      { userId: owner, identifier: `1:${tokens["long-expired"].id}` },
    ])
  })
})
