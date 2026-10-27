/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  CONTACT_LINK_AUDIT_KINDS,
  CONTACT_LINKS_MAX,
  ContactLinkError,
  type ContactLinkFields,
  ContactLinkVersionConflictError,
} from "@domain/contact-links"
import {
  type ContactLinkActor,
  listPublicContactLinks,
  PostgresContactLinks,
} from "@server/contact-links/postgres-contact-links.ts"
import { applyMigrations } from "./migrations.ts"

/**
 * Contact links (#465) against a real Postgres with every migration applied: the admin's writes
 * and their audit rows, the version check, a retried create, reordering and the public read.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `contact_test_${uuidV7().replaceAll(`-`, ``)}`
  const sql = postgres({
    ...settings,
    max: 5,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await applyMigrations(sql)
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

async function operator(sql: postgres.Sql): Promise<ContactLinkActor> {
  const [{ id }] = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id, first_name, last_name, role)
    SELECT id, 'Maya', 'Chen', 3 FROM auth_user RETURNING id
  `
  return { userId: id, requestId: `req-${id}` }
}

const TELEGRAM: ContactLinkFields = { kind: `telegram`, value: `my_shop`, label: null }
const PHONE: ContactLinkFields = { kind: `phone`, value: `+84912345678`, label: `Call us` }
const EMAIL: ContactLinkFields = { kind: `email`, value: `hello@example.com`, label: null }

async function auditKinds(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ eventKind: string }[]>`
    SELECT event_kind FROM audit_events WHERE entity_type = 'contact_link' ORDER BY id
  `
  return rows.map((row) => row.eventKind)
}

Deno.test(`adds, edits, reorders and removes links, each with its audit row`, async () => {
  await withSchema(async (sql) => {
    const links = new PostgresContactLinks(sql)
    const actor = await operator(sql)
    const [a, b, c] = [uuidV7(), uuidV7(), uuidV7()]
    await links.create(a, TELEGRAM, actor)
    await links.create(b, PHONE, actor)
    await links.create(c, EMAIL, actor)
    expect((await links.list()).map((link) => [link.id, link.position])).toEqual([
      [a, 0],
      [b, 1],
      [c, 2],
    ])

    const edited = await links.update(a, 1, { ...TELEGRAM, label: `Order` }, actor)
    expect(edited.version).toBe(2)

    await links.reorder([c, a, b], actor)
    expect(await listPublicContactLinks(sql)).toEqual([
      EMAIL,
      { ...TELEGRAM, label: `Order` },
      PHONE,
    ])

    await links.delete(a, 2, actor)
    expect((await links.list()).map((link) => [link.id, link.position])).toEqual([
      [c, 0],
      [b, 1],
    ])
    expect(await auditKinds(sql)).toEqual([
      CONTACT_LINK_AUDIT_KINDS.created,
      CONTACT_LINK_AUDIT_KINDS.created,
      CONTACT_LINK_AUDIT_KINDS.created,
      CONTACT_LINK_AUDIT_KINDS.updated,
      CONTACT_LINK_AUDIT_KINDS.reordered,
      CONTACT_LINK_AUDIT_KINDS.deleted,
    ])
  })
})

Deno.test(`answers a retried create with the first link, and refuses an id reused`, async () => {
  await withSchema(async (sql) => {
    const links = new PostgresContactLinks(sql)
    const actor = await operator(sql)
    const id = uuidV7()
    const first = await links.create(id, TELEGRAM, actor)
    expect(await links.create(id, TELEGRAM, actor)).toEqual(first)
    await expect(links.create(id, PHONE, actor)).rejects.toThrow(ContactLinkError)
    expect(await links.list()).toHaveLength(1)
    expect(await auditKinds(sql)).toEqual([CONTACT_LINK_AUDIT_KINDS.created])
  })
})

Deno.test(`refuses a write at an old version, and a reorder that misses a link`, async () => {
  await withSchema(async (sql) => {
    const links = new PostgresContactLinks(sql)
    const actor = await operator(sql)
    const [a, b] = [uuidV7(), uuidV7()]
    await links.create(a, TELEGRAM, actor)
    await links.create(b, PHONE, actor)
    await links.update(a, 1, EMAIL, actor)

    await expect(links.update(a, 1, PHONE, actor)).rejects.toThrow(ContactLinkVersionConflictError)
    await expect(links.delete(a, 1, actor)).rejects.toThrow(ContactLinkVersionConflictError)
    await expect(links.reorder([b], actor)).rejects.toThrow(`changed since`)
    await expect(links.reorder([b, b], actor)).rejects.toThrow(`changed since`)
    expect((await links.list()).map((link) => link.id)).toEqual([a, b])
  })
})

Deno.test(`keeps at most the website's number of links`, async () => {
  await withSchema(async (sql) => {
    const links = new PostgresContactLinks(sql)
    const actor = await operator(sql)
    for (let i = 0; i < CONTACT_LINKS_MAX - 1; i++) {
      await links.create(
        uuidV7(),
        { ...PHONE, value: `+8491234${String(i).padStart(4, `0`)}` },
        actor,
      )
    }
    const both = await Promise.allSettled([
      links.create(uuidV7(), TELEGRAM, actor),
      links.create(uuidV7(), EMAIL, actor),
    ])
    expect(both.map((result) => result.status).sort()).toEqual([`fulfilled`, `rejected`])
    const list = await links.list()
    expect(list).toHaveLength(CONTACT_LINKS_MAX)
    expect(list.map((link) => link.position)).toEqual([...Array(CONTACT_LINKS_MAX).keys()])
  })
})
