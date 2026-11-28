/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { WeeklyDigestSetting } from "@domain/notifications"
import {
  createWeeklyDigestTokens,
  readWeeklyDigest,
  saveWeeklyDigest,
} from "@server/notifications/weekly-digest.ts"
import {
  queueDueWeeklyDigests,
  WEEKLY_DIGEST_MAIL_JOB,
  weeklyDigestMailJob,
} from "@server/jobs/weekly-digest-mail.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import { createWeeklyDigestRoute } from "../../apps/api/routes/weekly-digest.ts"
import { API_URL, mountRoute, WEB_APP_URL } from "../../apps/api/_testing/mutation-requests.ts"
import { insertUser, withSchema } from "./group-team.ts"

/** A throwaway secret for this test only. */
const SUBSCRIBERS: SubscribersSetup = {
  secret: `digest-integration-test-secret-0123456789`,
  previousSecrets: [],
}
const BRAND = { webAppUrl: `https://app.example.com` }
/** Before every window: when the test's people joined their groups. */
const LONG_AGO = new Date(`2027-01-01T00:00:00Z`)
const MONDAY_9_BERLIN: WeeklyDigestSetting = {
  on: true,
  weekday: 1,
  hour: 9,
  timeZone: `Europe/Berlin`,
}

const at = (iso: string) => new Date(iso)

/** A sender that keeps what it is given, and fails while `failing` is set. */
function recordingSender() {
  const sender = {
    sent: [] as EmailMessage[],
    failing: false,
    send(message: EmailMessage) {
      if (sender.failing) return Promise.resolve({ ok: false as const, error: `refused` })
      sender.sent.push(message)
      return Promise.resolve({ ok: true as const, id: String(sender.sent.length) })
    },
  }
  return sender
}

/** The database helpers of one test schema. */
function fixtures(sql: postgres.Sql) {
  /** A person whose first proven address is `email`, or who has none. */
  const person = async (email: string | null): Promise<number> => {
    const id = await insertUser(sql)
    if (email) {
      await sql`INSERT INTO auth_email_owners (email, user_id) VALUES (${email}, ${id})`
      await sql`
        INSERT INTO auth_keys (user_id, method, subject, email, secret, proven_at)
        VALUES (${id}, 'password', ${email}, ${email}, 'hash', ${LONG_AGO})
      `
    }
    return id
  }
  /** A group owned by the first member; every member joined long ago. */
  const group = async (name: string, ...members: number[]): Promise<string> => {
    const id = uuidV7()
    await sql`INSERT INTO groups (id, name, owner_user_id) VALUES (${id}, ${name}, ${members[0]})`
    for (const [index, member] of members.entries()) await join(id, member, LONG_AGO, index)
    return id
  }
  const join = async (groupId: string, userId: number, when: Date, index = 1) => {
    await sql`
      INSERT INTO group_members (group_id, user_id, role, created_at)
      VALUES (${groupId}, ${userId}, ${index === 0 ? 4 : 2}, ${when})
    `
  }
  let sequence = 0
  /** A note `by` created at `created`; `edited` is a later edit by `editor` (`by` by default). */
  const note = async (
    groupId: string,
    by: number,
    created: Date,
    edited?: { at: Date; by?: number },
  ): Promise<string> => {
    const id = uuidV7()
    await sql`
      INSERT INTO notes (id, group_id, title, change_sequence, created_by_user_id,
        updated_by_user_id, created_at, updated_at)
      VALUES (${id}, ${groupId}, 'Note', ${++sequence}, ${by}, ${edited?.by ?? by}, ${created},
        ${edited?.at ?? created})
    `
    return id
  }
  const digestRow = async (userId: number) =>
    (await sql<{ id: string; nextAt: Date; windowFrom: Date; lastSentAt: Date | null }[]>`
      SELECT id, next_at, window_from, last_sent_at FROM weekly_digests WHERE user_id = ${userId}
    `)[0]
  const pendingMailJobs = async () =>
    await sql<{ id: string; aggregateId: string }[]>`
      SELECT id, aggregate_id FROM outbox_events
      WHERE event_kind = ${WEEKLY_DIGEST_MAIL_JOB} AND processed_at IS NULL
      ORDER BY id
    `
  return { person, group, join, note, digestRow, pendingMailJobs }
}

/** The mail job as the worker runs it, at a fixed time, with mail and the secret on. */
function mailJob(
  sql: postgres.Sql,
  now: Date,
  overrides: Partial<Parameters<typeof weeklyDigestMailJob>[0]> = {},
) {
  return weeklyDigestMailJob({
    sql,
    sender: null,
    brand: BRAND,
    log: () => {},
    subscribers: SUBSCRIBERS,
    now: () => now,
    ...overrides,
  })
}

/** Runs the job for one digest row id, as the outbox does for its event. */
const runFor = (job: ReturnType<typeof weeklyDigestMailJob>, aggregateId: string) =>
  job({ aggregateId } as Parameters<typeof job>[0])

Deno.test(`weekly digest`, async (t) => {
  await withSchema(async (sql) => {
    const f = fixtures(sql)
    const sender = recordingSender()
    const asSender = sender as unknown as EmailSender

    /**
     * One scheduler run at `now`, then every mail job it queued, at the same time: the sent mails.
     */
    const tick = async (now: Date, overrides: Parameters<typeof mailJob>[2] = {}) => {
      const before = sender.sent.length
      const queued = await queueDueWeeklyDigests(sql, now)
      const job = mailJob(sql, now, { sender: asSender, ...overrides })
      for (const { id, aggregateId } of await f.pendingMailJobs()) {
        await runFor(job, aggregateId)
        await sql`UPDATE outbox_events SET processed_at = now() WHERE id = ${id}`
      }
      return { queued, mails: sender.sent.slice(before) }
    }
    /** Hourly scheduler runs at minute 5 from `from` to `to`; every mail they sent. */
    const hourly = async (from: string, to: string) => {
      const mails: EmailMessage[] = []
      for (let time = at(from).getTime(); time <= at(to).getTime(); time += 3_600_000) {
        mails.push(...(await tick(new Date(time))).mails)
      }
      return mails
    }

    const bob = await f.person(`bob@example.com`)

    await t.step(`a person with no digest row never gets a digest`, async () => {
      const nobody = await f.person(`nobody@example.com`)
      const team = await f.group(`Nobody's team`, nobody, bob)
      await f.note(team, bob, at(`2027-03-18T10:00:00Z`))
      expect(await readWeeklyDigest(sql, nobody)).toEqual({ on: false })
      expect(await hourly(`2027-03-15T00:05:00Z`, `2027-03-29T23:05:00Z`)).toEqual([])
      expect(await f.pendingMailJobs()).toEqual([])
    })

    const ann = await f.person(`ann@example.com`)
    const annTeam = await f.group(`Ann's team`, ann, bob)

    await t.step(`turning on Monday 09:00 Berlin sends exactly one digest that week`, async () => {
      const state = await saveWeeklyDigest(sql, ann, MONDAY_9_BERLIN, at(`2027-03-17T10:00:00Z`))
      expect(state).toEqual({ ...MONDAY_9_BERLIN, nextAt: `2027-03-22T08:00:00.000Z` })
      await f.note(annTeam, bob, at(`2027-03-18T10:00:00Z`))

      expect((await tick(at(`2027-03-22T07:05:00Z`))).queued).toBe(0)
      const { queued, mails } = await tick(at(`2027-03-22T08:05:00Z`))

      expect(queued).toBe(1)
      expect(mails.map((mail) => mail.to)).toEqual([`ann@example.com`])
      expect(mails[0].text).toContain(`1 new note`)
      expect(mails[0].html).toContain(`href="https://app.example.com/groups/${annTeam}"`)
      expect((await f.digestRow(ann)).lastSentAt).toEqual(at(`2027-03-22T08:05:00Z`))
    })

    await t.step(`a second scheduler run in the same hour sends nothing more`, async () => {
      expect((await tick(at(`2027-03-22T08:05:00Z`))).queued).toBe(0)
      expect((await tick(at(`2027-03-22T08:55:00Z`))).queued).toBe(0)
      // The next Monday 09:00 Berlin is in summer time.
      expect((await f.digestRow(ann)).nextAt).toEqual(at(`2027-03-29T07:00:00Z`))
    })

    await t.step(`a mail job delivered twice sends once`, async () => {
      const row = await f.digestRow(ann)
      await f.note(annTeam, bob, at(`2027-03-22T08:00:00Z`))
      await runFor(mailJob(sql, at(`2027-03-22T08:05:00Z`), { sender: asSender }), row.id)
      expect(sender.sent.length).toBe(1)
    })

    await t.step(
      `a week with no changes by others sends nothing and starts the next window after it`,
      async () => {
        const { queued, mails } = await tick(at(`2027-03-29T07:05:00Z`))
        expect([queued, mails.length]).toEqual([1, 0])
        expect((await f.digestRow(ann)).windowFrom).toEqual(at(`2027-03-29T07:05:00Z`))

        await f.note(annTeam, bob, at(`2027-04-01T10:00:00Z`))
        const next = await tick(at(`2027-04-05T07:05:00Z`))
        expect(next.mails.length).toBe(1)
        expect(next.mails[0].text).toContain(`1 new note.`)
      },
    )

    await t.step(`only the person's own notes, edits and joining send no digest`, async () => {
      const carol = await f.person(`carol@example.com`)
      const solo = await f.group(`Carol's notes`, carol)
      const shared = await f.group(`Shared`, bob)
      const old = await f.note(shared, bob, LONG_AGO)
      await saveWeeklyDigest(sql, carol, MONDAY_9_BERLIN, at(`2027-04-05T10:00:00Z`))

      await f.note(solo, carol, at(`2027-04-06T10:00:00Z`), { at: at(`2027-04-07T10:00:00Z`) })
      await sql`
        UPDATE notes SET updated_by_user_id = ${carol}, updated_at = ${at(`2027-04-07T11:00:00Z`)}
        WHERE id = ${old}
      `
      await f.join(shared, carol, at(`2027-04-08T10:00:00Z`))

      const { queued, mails } = await tick(at(`2027-04-12T07:05:00Z`))
      expect(queued).toBeGreaterThanOrEqual(1)
      expect(mails.filter((mail) => mail.to === `carol@example.com`)).toEqual([])
    })

    await t.step(
      `counts edits of older notes and people who joined, in the person's groups only`,
      async () => {
        const dave = await f.person(`dave@example.com`)
        const stays = await f.group(`Stays`, dave, bob)
        const left = await f.group(`Left`, dave, bob)
        const gone = await f.group(`Deleted`, dave, bob)
        const old = await f.note(stays, dave, LONG_AGO)
        await saveWeeklyDigest(sql, dave, MONDAY_9_BERLIN, at(`2027-04-12T10:00:00Z`))

        await sql`
        UPDATE notes SET updated_by_user_id = ${bob}, updated_at = ${at(`2027-04-13T10:00:00Z`)}
        WHERE id = ${old}
      `
        await f.join(stays, await f.person(null), at(`2027-04-14T10:00:00Z`))
        await f.note(left, bob, at(`2027-04-14T10:00:00Z`))
        await sql`DELETE FROM group_members WHERE group_id = ${left} AND user_id = ${dave}`
        await f.note(gone, bob, at(`2027-04-14T10:00:00Z`))
        await sql`UPDATE groups SET deleted_at = ${at(`2027-04-15T10:00:00Z`)} WHERE id = ${gone}`
        const deletedNote = await f.note(stays, bob, at(`2027-04-15T10:00:00Z`))
        await sql`UPDATE notes SET deleted_at = ${
          at(`2027-04-16T10:00:00Z`)
        } WHERE id = ${deletedNote}`

        const { mails } = await tick(at(`2027-04-19T07:05:00Z`))
        const mail = mails.find((sent) => sent.to === `dave@example.com`)!
        expect(mail.text).toContain(`1 note edited and 1 person joined.`)
        expect(mail.text).not.toContain(`Left`)
        expect(mail.text).not.toContain(`Deleted`)
        expect(mail.text).not.toContain(`new note`)
      },
    )

    await t.step(`an hour that daylight saving time skips still sends one digest`, async () => {
      const erin = await f.person(`erin@example.com`)
      const team = await f.group(`Erin's team`, erin, bob)
      const state = await saveWeeklyDigest(
        sql,
        erin,
        { on: true, weekday: 7, hour: 2, timeZone: `Europe/Berlin` },
        at(`2027-03-24T12:00:00Z`),
      )
      // 02:00 does not exist in Berlin on 2027-03-28: it is read as 03:00 summer time.
      expect(state).toMatchObject({ nextAt: `2027-03-28T01:00:00.000Z` })
      await f.note(team, bob, at(`2027-03-25T10:00:00Z`))

      const mails = await hourly(`2027-03-27T20:05:00Z`, `2027-03-28T06:05:00Z`)

      expect(mails.filter((mail) => mail.to === `erin@example.com`).length).toBe(1)
      expect((await f.digestRow(erin)).nextAt).toEqual(at(`2027-04-04T00:00:00Z`))
    })

    await t.step(`an hour that daylight saving time repeats sends one digest`, async () => {
      const fred = await f.person(`fred@example.com`)
      const team = await f.group(`Fred's team`, fred, bob)
      const state = await saveWeeklyDigest(
        sql,
        fred,
        { on: true, weekday: 7, hour: 2, timeZone: `Europe/Berlin` },
        at(`2027-10-27T12:00:00Z`),
      )
      // 02:00 happens twice in Berlin on 2027-10-31: the second, winter-time one is used.
      expect(state).toMatchObject({ nextAt: `2027-10-31T01:00:00.000Z` })
      await f.note(team, bob, at(`2027-10-28T10:00:00Z`))

      const mails = await hourly(`2027-10-30T20:05:00Z`, `2027-10-31T06:05:00Z`)

      expect(mails.filter((mail) => mail.to === `fred@example.com`).length).toBe(1)
    })

    await t.step(`a worker down for three weeks sends one digest, not three`, async () => {
      const gina = await f.person(`gina@example.com`)
      const team = await f.group(`Gina's team`, gina, bob)
      await saveWeeklyDigest(sql, gina, MONDAY_9_BERLIN, at(`2027-05-05T10:00:00Z`))
      for (const day of [`2027-05-12`, `2027-05-19`, `2027-05-26`]) {
        await f.note(team, bob, at(`${day}T10:00:00Z`))
      }

      const { mails } = await tick(at(`2027-05-31T10:00:00Z`))
      const again = await tick(at(`2027-05-31T10:30:00Z`))

      const toGina = mails.filter((mail) => mail.to === `gina@example.com`)
      expect(toGina.length).toBe(1)
      expect(toGina[0].text).toContain(`3 new notes`)
      expect(again.mails).toEqual([])
      expect((await f.digestRow(gina)).nextAt).toEqual(at(`2027-06-07T07:00:00Z`))
    })

    /** A person with a digest on and one change by bob waiting, whose job is queued. */
    const queuedDigest = async (email: string | null, start: string) => {
      const who = await f.person(email)
      const team = await f.group(`Queued`, who, bob)
      await saveWeeklyDigest(sql, who, MONDAY_9_BERLIN, at(start))
      await f.note(team, bob, new Date(at(start).getTime() + 86_400_000))
      return { who, team, row: await f.digestRow(who) }
    }
    /** Runs the mail job of `row` a week after `start`. */
    const send = async (id: string, start: string, overrides: Parameters<typeof mailJob>[2] = {}) =>
      await runFor(
        mailJob(sql, new Date(at(start).getTime() + 7 * 86_400_000), {
          sender: asSender,
          ...overrides,
        }),
        id,
      )

    await t.step(`mail off sends nothing and still advances the window`, async () => {
      const { who, row } = await queuedDigest(`hal@example.com`, `2028-01-03T10:00:00Z`)
      const before = sender.sent.length
      await send(row.id, `2028-01-03T10:00:00Z`, { sender: null })
      expect(sender.sent.length).toBe(before)
      expect((await f.digestRow(who)).windowFrom).toEqual(at(`2028-01-10T10:00:00Z`))
    })

    await t.step(
      `no proven address sends nothing, says so without an address, and advances`,
      async () => {
        const { who, row } = await queuedDigest(null, `2028-01-03T10:00:00Z`)
        const logged: string[] = []
        const before = sender.sent.length
        await send(row.id, `2028-01-03T10:00:00Z`, { log: (line) => void logged.push(line) })
        expect(sender.sent.length).toBe(before)
        expect(logged).toEqual([
          `warn: a weekly digest was not sent: its owner has no proven address`,
        ])
        expect((await f.digestRow(who)).windowFrom).toEqual(at(`2028-01-10T10:00:00Z`))
      },
    )

    await t.step(`no secret to sign the unsubscribe link sends nothing`, async () => {
      const { row } = await queuedDigest(`ivy@example.com`, `2028-01-03T10:00:00Z`)
      const before = sender.sent.length
      await send(row.id, `2028-01-03T10:00:00Z`, { subscribers: null })
      expect(sender.sent.length).toBe(before)
    })

    await t.step(`a failed send throws and keeps the window for the retry`, async () => {
      const { who, row } = await queuedDigest(`jo@example.com`, `2028-01-03T10:00:00Z`)
      sender.failing = true
      await expect(send(row.id, `2028-01-03T10:00:00Z`)).rejects.toThrow(`weekly digest not sent`)
      sender.failing = false
      expect((await f.digestRow(who)).windowFrom).toEqual(row.windowFrom)
      await send(row.id, `2028-01-03T10:00:00Z`)
      expect(sender.sent.at(-1)!.to).toBe(`jo@example.com`)
    })

    await t.step(
      `a digest turned off, or turned off and on again, after its job was queued sends nothing`,
      async () => {
        const off = await queuedDigest(`kim@example.com`, `2028-01-03T10:00:00Z`)
        const again = await queuedDigest(`lee@example.com`, `2028-01-03T10:00:00Z`)
        await saveWeeklyDigest(sql, off.who, { on: false })
        await saveWeeklyDigest(sql, again.who, { on: false })
        await saveWeeklyDigest(sql, again.who, MONDAY_9_BERLIN, at(`2028-01-04T10:00:00Z`))
        const before = sender.sent.length

        await send(off.row.id, `2028-01-03T10:00:00Z`)
        await send(again.row.id, `2028-01-03T10:00:00Z`)

        expect(sender.sent.length).toBe(before)
        expect(await f.digestRow(off.who)).toBeUndefined()
        expect((await f.digestRow(again.who)).id).not.toBe(again.row.id)
      },
    )

    await t.step(`a deleted or blocked account gets no digest`, async () => {
      const deleted = await queuedDigest(`max@example.com`, `2028-01-03T10:00:00Z`)
      const blocked = await queuedDigest(`ned@example.com`, `2028-01-03T10:00:00Z`)
      await sql`UPDATE users SET deleted_at = now() WHERE id = ${deleted.who}`
      await sql`UPDATE users SET blocked_at = now() WHERE id = ${blocked.who}`
      const before = sender.sent.length
      await send(deleted.row.id, `2028-01-03T10:00:00Z`)
      await send(blocked.row.id, `2028-01-03T10:00:00Z`)
      expect(sender.sent.length).toBe(before)
    })

    await t.step(`the digest is written in the person's saved language`, async () => {
      const { who, row } = await queuedDigest(`oleg@example.com`, `2028-01-03T10:00:00Z`)
      await sql`
        INSERT INTO user_preferences (user_id, value, version)
        VALUES (${who}, ${sql.json({ language: `ru` })}, 1)
      `
      await send(row.id, `2028-01-03T10:00:00Z`)
      expect(sender.sent.at(-1)!.subject).toBe(`Ваша неделя в группах`)
    })

    await t.step(`more than 20 groups lists 20 and counts the rest`, async () => {
      const pat = await f.person(`pat@example.com`)
      await saveWeeklyDigest(sql, pat, MONDAY_9_BERLIN, at(`2028-01-03T10:00:00Z`))
      for (let i = 0; i < 22; i++) {
        const team = await f.group(`Team ${String(i).padStart(2, `0`)}`, pat, bob)
        await f.note(team, bob, at(`2028-01-04T10:00:00Z`))
      }
      await send((await f.digestRow(pat)).id, `2028-01-03T10:00:00Z`)
      const mail = sender.sent.at(-1)!
      expect(mail.html!.match(/\/groups\/[0-9a-f-]{36}"/g)?.length).toBe(20)
      expect(mail.text).toContain(`And 2 more groups changed.`)
    })

    await t.step(
      `saving the setting again moves the time and keeps the window and the id`,
      async () => {
        const before = await f.digestRow(ann)
        const state = await saveWeeklyDigest(
          sql,
          ann,
          { on: true, weekday: 3, hour: 18, timeZone: `Asia/Tokyo` },
          at(`2028-02-01T00:00:00Z`),
        )
        const after = await f.digestRow(ann)
        expect(state).toMatchObject({ weekday: 3, hour: 18, nextAt: `2028-02-02T09:00:00.000Z` })
        expect([after.id, after.windowFrom]).toEqual([before.id, before.windowFrom])
      },
    )

    await t.step(
      `a signed-out one-click unsubscribe removes the row, and a second one answers the same`,
      async () => {
        const app = mountRoute(
          `/weekly-digest`,
          createWeeklyDigestRoute({
            tokens: createWeeklyDigestTokens(SUBSCRIBERS),
            webAppUrl: WEB_APP_URL,
            tokenByIp: async (_c, next) => await next(),
            turnOff: async (userId) => void await saveWeeklyDigest(sql, userId, { on: false }),
          }),
          null,
        )
        const token = await createWeeklyDigestTokens(SUBSCRIBERS).sign(ann)
        const post = (value: string) =>
          app.request(
            `${API_URL}/weekly-digest/unsubscribe?${new URLSearchParams({ token: value })}`,
            {
              method: `POST`,
              headers: { "content-type": `application/x-www-form-urlencoded` },
              body: `List-Unsubscribe=One-Click`,
            },
          )

        const forged = await post(`${token.slice(0, -2)}AA`)
        expect(forged.status).toBe(404)
        expect(await f.digestRow(ann)).toBeDefined()

        const first = await post(token)
        const second = await post(token)
        expect([first.status, second.status]).toEqual([200, 200])
        expect(await second.json()).toEqual(await first.json())
        expect(await f.digestRow(ann)).toBeUndefined()
      },
    )
  })
})
