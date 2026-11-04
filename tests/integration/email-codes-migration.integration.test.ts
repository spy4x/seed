/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { enqueueJob } from "@server/jobs/jobs.ts"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import { PASSWORD_RESET_MAIL_JOB } from "@server/jobs/password-reset-mail.ts"
import { applyMigrations, migrationNames } from "./migrations.ts"

/**
 * The migration that swaps mailed links for mailed codes (#752), on a database that still holds
 * link and reset mails queued before it. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME`
 * (recipe in docs/handoff.md); it fails when they are missing rather than skipping.
 */

const CODES_MIGRATION = "2026_12_14_0002_email_codes.sql"

Deno.test("mails queued before the code migration are dropped or end quietly, and send nothing", async () => {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `email_codes_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 1,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = migrationNames()
    const at = names.indexOf(CODES_MIGRATION)
    expect(at).toBeGreaterThan(0)
    await applyMigrations(sql, names.slice(0, at))

    const linkRequest = uuidV7()
    await sql`INSERT INTO sign_in_link_requests (id, email) VALUES (${linkRequest}, 'ann@example.com')`
    await enqueueJob(sql, `auth.sign-in-link-mail`, linkRequest, { inMs: 0 })
    const resetRequest = uuidV7()
    await sql`INSERT INTO password_reset_requests (id, email) VALUES (${resetRequest}, 'ann@example.com')`
    await enqueueJob(sql, PASSWORD_RESET_MAIL_JOB, resetRequest, { inMs: 0 })

    await applyMigrations(sql, names.slice(at))

    const kinds = await sql<{ event_kind: string }[]>`SELECT event_kind FROM outbox_events`
    expect(kinds.map((row) => row.event_kind)).toEqual([PASSWORD_RESET_MAIL_JOB])

    const sent: EmailMessage[] = []
    const sender = {
      send(message: EmailMessage) {
        sent.push(message)
        return Promise.resolve({ ok: true as const, id: String(sent.length) })
      },
    } as unknown as EmailSender
    const logged: string[] = []
    const processor = createOutboxProcessor(sql, {
      store: createPostgresAuthStore(sql),
      sender,
      brand: { webAppUrl: "http://app.localhost" },
      log: (line) => logged.push(line),
    })
    const result = await processor.drainOnce()
    expect({ published: result.published, failed: result.failed }).toEqual({
      published: 1,
      failed: 0,
    })
    expect(sent).toEqual([])
    expect(logged).toEqual([])
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
})
