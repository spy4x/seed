/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { unzipSync } from "fflate"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { DataExportStatus, TELEGRAM_METHOD } from "@domain/identity"
import { NotificationKind } from "@domain/notifications"
import {
  DATA_EXPORT_BUILD_JOB,
  dataExportKey,
  latestDataExport,
  readyDataExportFile,
  requestDataExport,
} from "@server/auth/data-export.ts"
import type { ServerFiles } from "@server/files/files.ts"
import {
  buildDataExport,
  DATA_EXPORT_EXPIRE_JOB,
  DATA_EXPORT_MAIL_JOB,
  dataExportBuildJob,
  dataExportExpireJob,
} from "@server/jobs/data-export.ts"
import { DATA_EXPORT_SECTIONS } from "@server/jobs/data-export-sections.ts"
import { team, withSchema } from "./group-team.ts"

/**
 * A person's data export against a real Postgres built from schema.sql: what the ZIP holds and
 * leaves out, one request a day, the build job and the file's expiry. Needs "DB_HOST", "DB_USER",
 * "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when they are missing.
 */

/** Values that must never leave the database in an export. */
const SECRETS = {
  password: `argon2id$secret-password-hash`,
  session: `a1`.repeat(32),
  totp: `JBSWY3DPEHPK3PXPSECRET`,
  apiToken: `b2`.repeat(32),
  invitation: `c3`.repeat(32),
  pushAuth: `push-auth-secret`,
  pushKey: `push-p256dh-secret`,
  pushEndpoint: `https://push.example.com/send/endpoint-secret`,
  subscriberKey: `subscriber-unsubscribe-key`,
}

/** A fake store that keeps what it was given. */
function memoryFiles() {
  const stored = new Map<string, Uint8Array>()
  const files: ServerFiles = {
    put: (key, body) => (stored.set(key, body), Promise.resolve()),
    delete: (key) => (stored.delete(key), Promise.resolve()),
    deleteOlderThan: () => Promise.resolve(0),
  }
  return { files, stored }
}

async function note(sql: postgres.Sql, groupId: string, userId: number, title: string) {
  const id = uuidV7()
  await sql`
    INSERT INTO notes (id, group_id, title, body, change_sequence, created_by_user_id,
      updated_by_user_id)
    VALUES (${id}, ${groupId}, ${title}, ${`Body of ${title}`}, 1, ${userId}, ${userId})
  `
  return id
}

/** The person's sign-in rows, every one holding a secret from {@link SECRETS}. */
async function signInRows(sql: postgres.Sql, userId: number, groupId: string) {
  const email = `person-${userId}@example.com`
  await sql`INSERT INTO auth_email_owners (email, user_id) VALUES (${email}, ${userId})`
  const [key] = await sql<{ id: number }[]>`
    INSERT INTO auth_keys (user_id, method, subject, email, secret, proven_at)
    VALUES (${userId}, 'password', ${email}, ${email}, ${SECRETS.password}, now())
    RETURNING id
  `
  await sql`
    INSERT INTO auth_sessions (user_id, key_id, token_hash, status, second_factor, expires_at,
      device_name)
    VALUES (${userId}, ${key.id}, ${SECRETS.session}, 1, 1, now() + interval '1 day',
      'Firefox on Linux')
  `
  await sql`INSERT INTO user_totp (user_id, secret, confirmed_at) VALUES (${userId}, ${SECRETS.totp}, now())`
  await sql`
    INSERT INTO api_tokens (id, user_id, group_id, name, token_hash, access)
    VALUES (${uuidV7()}, ${userId}, ${groupId}, 'Zapier', ${SECRETS.apiToken}, 1)
  `
  await sql`
    INSERT INTO group_invitations (id, group_id, token_hash, role, email, created_by_user_id,
      expires_at)
    VALUES (${uuidV7()}, ${groupId}, ${SECRETS.invitation}, 1, 'invitee@example.com', ${userId},
      now() + interval '7 days')
  `
  await sql`
    INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
    VALUES (${userId}, 'device-1', ${SECRETS.pushEndpoint}, ${SECRETS.pushAuth}, ${SECRETS.pushKey})
  `
  await sql`
    INSERT INTO subscribers (list_id, email, key, subscribed_at)
    VALUES ('news', ${email}, ${SECRETS.subscriberKey}, now())
  `
}

/** The ZIP's files as text, a byte-order mark kept. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const decoder = new TextDecoder(`utf-8`, { ignoreBOM: true })
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([name, file]) => [name, decoder.decode(file)]),
  )
}

Deno.test("data export: holds the person's own rows, as JSON and one CSV per section", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    await sql`UPDATE users SET first_name = 'Ada', last_name = 'Lovelace' WHERE id = ${editor}`
    const mine = await note(sql, groupId, editor, `Mine, with "quotes", commas`)
    await signInRows(sql, editor, groupId)

    const files = unzip(await buildDataExport(sql, editor, new Date(`2026-10-23T10:00:00Z`)))

    expect(Object.keys(files).sort()).toEqual(
      [`README.txt`, `data.json`, ...DATA_EXPORT_SECTIONS.map((s) => `${s.name}.csv`)].sort(),
    )
    const data = JSON.parse(files[`data.json`])
    expect(data).toMatchObject({
      format: `seed.data-export`,
      exportedAt: `2026-10-23T10:00:00.000Z`,
    })
    expect(data.sections.profile).toEqual([expect.objectContaining({
      firstName: `Ada`,
      lastName: `Lovelace`,
    })])
    expect(data.sections.notes.map((n: { id: string }) => n.id)).toEqual([mine])
    expect(data.sections.groups.map((g: { role: string }) => g.role).sort()).toEqual([
      `editor`,
      `owner`,
    ])
    expect(data.sections.sessions[0]).toMatchObject({
      device: `Firefox on Linux`,
      status: `active`,
    })
    // Dates are ISO 8601 in UTC.
    expect(data.sections.notes[0].createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    // A CSV file is UTF-8 with a byte-order mark and a header row, its cells quoted as needed.
    const notes = files[`notes.csv`].split(`\r\n`)
    expect(notes[0]).toBe(`\uFEFFid,groupId,title,body,tagIds,createdAt,updatedAt,deletedAt`)
    expect(notes[1]).toContain(`"Mine, with ""quotes"", commas"`)
  })
})

Deno.test("data export: leaves out other people's notes, tags and groups, even in a shared group", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor, owner, stranger } = await team(sql)
    const [strangers] = await sql<{ groupId: string }[]>`
      SELECT group_id FROM group_members WHERE user_id = ${stranger}
    `
    await note(sql, groupId, editor, `Editor's note`)
    await note(sql, groupId, owner, `Owner's note in the shared group`)
    await note(sql, strangers.groupId, stranger, `Stranger's note`)
    await sql`
      INSERT INTO tags (id, group_id, name, change_sequence, created_by_user_id)
      VALUES (${uuidV7()}, ${groupId}, 'Owner tag', 1, ${owner})
    `

    const text = Object.values(unzip(await buildDataExport(sql, editor, new Date()))).join(`\n`)

    expect(text).toContain(`Editor's note`)
    expect(text).not.toContain(`Owner's note`)
    expect(text).not.toContain(`Stranger's note`)
    expect(text).not.toContain(`Owner tag`)
    expect(text).not.toContain(strangers.groupId)
  })
})

Deno.test("data export: lists the files the person attached, never another person's or the stored key", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor, owner } = await team(sql)
    const shared = await note(sql, groupId, owner, `Owner's note`)
    const [mine, theirs] = [uuidV7(), uuidV7()]
    await sql`
      INSERT INTO note_attachments (
        id, note_id, object_key, name, content_type, size_bytes, created_by_user_id
      ) VALUES
        (${mine}, ${shared}, ${`attachments/${mine}`}, 'scan.pdf', 'application/pdf', 700, ${editor}),
        (${theirs}, ${shared}, ${`attachments/${theirs}`}, 'owner.png', 'image/png', 300, ${owner})
    `

    const files = unzip(await buildDataExport(sql, editor, new Date()))
    const rows = JSON.parse(files[`data.json`]).sections.note_attachments

    expect(rows).toEqual([expect.objectContaining({
      id: mine,
      noteId: shared,
      groupId,
      name: `scan.pdf`,
      contentType: `application/pdf`,
      sizeBytes: 700,
    })])
    const text = Object.values(files).join(`\n`)
    expect(text).not.toContain(`owner.png`)
    expect(text).not.toContain(`attachments/${mine}`)
    expect(files[`note_attachments.csv`].split(`\r\n`)[0]).toBe(
      `\uFEFFid,noteId,groupId,name,contentType,sizeBytes,createdAt`,
    )
  })
})

Deno.test("data export: holds no secret, token, hash or key, nor another person's address", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    await signInRows(sql, editor, groupId)

    const files = unzip(await buildDataExport(sql, editor, new Date()))
    const text = Object.values(files).join(`\n`)

    for (const [name, secret] of Object.entries(SECRETS)) {
      expect({ name, found: text.includes(secret) }).toEqual({ name, found: false })
    }
    expect(text).not.toContain(`invitee@example.com`)
    const fields = DATA_EXPORT_SECTIONS.flatMap((section) => section.columns)
    expect(fields.filter((field) => /token|hash|secret|password|p256dh|^auth$|^key$/i.test(field)))
      .toEqual([])
    // Each section still held the person's row, so the check above read real data.
    const data = JSON.parse(files[`data.json`]).sections
    for (
      const name of [`sign_in_methods`, `sessions`, `api_tokens`, `push_devices`, `newsletters`]
    ) {
      expect({ name, rows: data[name].length }).toEqual({ name, rows: 1 })
    }
  })
})

Deno.test("data export: lists the person's linked Telegram account and when it was linked, not as a sign-in method, and no one else's", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor, owner } = await team(sql)
    await signInRows(sql, editor, groupId)
    await sql`
      INSERT INTO auth_keys (user_id, method, subject, created_at)
      VALUES (${editor}, ${TELEGRAM_METHOD}, '900000001', '2026-10-20T08:00:00Z'),
        (${owner}, ${TELEGRAM_METHOD}, '900000002', now())
    `

    const files = unzip(await buildDataExport(sql, editor, new Date()))
    const data = JSON.parse(files[`data.json`]).sections

    expect(data.telegram).toEqual([
      { telegramUserId: `900000001`, linkedAt: `2026-10-20T08:00:00.000Z` },
    ])
    expect(data.sign_in_methods.map((row: { method: string }) => row.method)).toEqual([`password`])
    expect(files[`telegram.csv`].split(`\r\n`)[0]).toBe(`﻿telegramUserId,linkedAt`)
    expect(Object.values(files).join(`\n`)).not.toContain(`900000002`)
  })
})

Deno.test("data export: keeps an operator's action on the person but not the operator's address or browser", async () => {
  await withSchema(async (sql) => {
    const { editor } = await team(sql)
    await sql`
      INSERT INTO auth_audits (user_id, event_type, identifier, ip, user_agent) VALUES
        (${editor}, 1, 'operator:1', '198.51.100.77', 'OperatorBrowser/1.0'),
        (${editor}, 1, ${`own@example.com`}, '192.0.2.10', 'MyBrowser/2.0')
    `

    const files = unzip(await buildDataExport(sql, editor, new Date()))
    const text = Object.values(files).join(`\n`)

    expect(text).not.toContain(`198.51.100.77`)
    expect(text).not.toContain(`OperatorBrowser/1.0`)
    // The person's own sign-in keeps its address and browser, and the operator's row stays.
    const activity = JSON.parse(files[`data.json`]).sections.account_activity
    expect(activity).toContainEqual(
      expect.objectContaining({ ip: `192.0.2.10`, userAgent: `MyBrowser/2.0` }),
    )
    expect(activity).toContainEqual(expect.objectContaining({ ip: null, userAgent: null }))
  })
})

Deno.test("data export: one request a day; a second, even at the same moment, gets the first", async () => {
  await withSchema(async (sql) => {
    const { editor, viewer } = await team(sql)

    const [first, second] = await Promise.all([
      requestDataExport(sql, editor),
      requestDataExport(sql, editor),
    ])
    const made = [first, second].filter((result) => result.success)
    const refused = [first, second].filter((result) => !result.success)
    expect(made.length).toBe(1)
    expect(refused[0]).toMatchObject({ error: `TOO_SOON`, output: { id: made[0].output.id } })
    expect(made[0].output.status).toBe(DataExportStatus.Preparing)
    const jobs = await sql`
      SELECT 1 FROM outbox_events
      WHERE event_kind = ${DATA_EXPORT_BUILD_JOB} AND aggregate_id = ${made[0].output.id}
    `
    expect(jobs.length).toBe(1)

    // Another person is not held back by it.
    expect((await requestDataExport(sql, viewer)).success).toBe(true)

    // A day later the person may ask again.
    await sql`UPDATE data_exports SET requested_at = now() - interval '25 hours' WHERE user_id = ${editor}`
    expect((await requestDataExport(sql, editor)).success).toBe(true)
  })
})

Deno.test("data export: the build job stores the file once, tells the person, and queues mail and expiry", async () => {
  await withSchema(async (sql) => {
    const { editor } = await team(sql)
    const { output } = await requestDataExport(sql, editor)
    const { files, stored } = memoryFiles()
    const puts: string[] = []
    const counted: ServerFiles = {
      ...files,
      put: (key, body) => (puts.push(key), files.put(key, body)),
    }
    const job = dataExportBuildJob({ sql, files: counted })
    const event = { aggregateId: output.id } as Parameters<typeof job>[0]

    await job(event)
    await job(event)

    expect(puts).toEqual([dataExportKey(output.id)])
    expect(Object.keys(unzipSync(stored.get(dataExportKey(output.id))!))).toContain(`data.json`)
    const latest = await latestDataExport(sql, editor)
    expect(latest).toMatchObject({ status: DataExportStatus.Ready })
    expect(latest!.sizeBytes).toBe(stored.get(dataExportKey(output.id))!.length)
    expect(await readyDataExportFile(sql, editor)).toEqual({
      key: dataExportKey(output.id),
      filename: expect.stringMatching(/^my-data-\d{4}-\d\d-\d\d\.zip$/),
    })
    const inbox = await sql`SELECT kind, link FROM notifications WHERE user_id = ${editor}`
    expect(inbox).toEqual([{ kind: NotificationKind.DataExportReady, link: `/profile/account` }])
    const queued = await sql<{ eventKind: string }[]>`
      SELECT event_kind FROM outbox_events WHERE aggregate_id = ${output.id} ORDER BY event_kind
    `
    expect(queued.map((row) => row.eventKind)).toEqual([
      DATA_EXPORT_BUILD_JOB,
      DATA_EXPORT_EXPIRE_JOB,
      DATA_EXPORT_MAIL_JOB,
    ])
  })
})

Deno.test("data export: the expiry job deletes the file, and no one downloads it after", async () => {
  await withSchema(async (sql) => {
    const { editor } = await team(sql)
    const { output } = await requestDataExport(sql, editor)
    const { files, stored } = memoryFiles()
    const event = { aggregateId: output.id } as Parameters<ReturnType<typeof dataExportBuildJob>>[0]
    await dataExportBuildJob({ sql, files })(event)

    await dataExportExpireJob({ sql, files })(event)

    expect(stored.has(dataExportKey(output.id))).toBe(false)
    expect((await latestDataExport(sql, editor))!.status).toBe(DataExportStatus.Expired)
    expect(await readyDataExportFile(sql, editor)).toBeNull()
  })
})

Deno.test("data export: a person downloads only their own file", async () => {
  await withSchema(async (sql) => {
    const { editor, viewer } = await team(sql)
    const { output } = await requestDataExport(sql, editor)
    const { files } = memoryFiles()
    await dataExportBuildJob({ sql, files })(
      { aggregateId: output.id } as Parameters<ReturnType<typeof dataExportBuildJob>>[0],
    )

    expect(await readyDataExportFile(sql, viewer)).toBeNull()
    expect(await latestDataExport(sql, viewer)).toBeNull()
    expect((await readyDataExportFile(sql, editor))!.key).toBe(dataExportKey(output.id))
  })
})
