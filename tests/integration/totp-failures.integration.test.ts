/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { createTotpFailures } from "../../apps/api/services/totp-failures.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

interface IdRow extends postgres.Row {
  id: number
}

/** Runs `body` on a fresh schema built from schema.sql, with a helper that opens more clients. */
async function withSchema(
  body: (open: () => postgres.Sql, sql: postgres.Sql) => Promise<void>,
): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1 })
  const schema = `totp_test_${uuidV7().replaceAll("-", "")}`
  const clients: postgres.Sql[] = []
  const open = () => {
    const client = postgres({
      ...connection,
      max: 25,
      transform: postgres.camel,
      connection: { options: `-c search_path=${schema}` },
      onnotice: () => {},
    })
    clients.push(client)
    return client
  }
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const first = open()
    await first.unsafe(await Deno.readTextFile("libs/server/db/schema.sql"))
    await body(open, first)
  } finally {
    for (const client of clients) await client.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** A user with a confirmed authenticator enrolment. */
async function insertEnrolledUser(sql: postgres.Sql): Promise<number> {
  const rows = await sql<IdRow[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id),
    profile AS (INSERT INTO users (id, mfa) SELECT id, 3 FROM auth_user RETURNING id)
    INSERT INTO user_totp (user_id, secret, confirmed_at) SELECT id, 'JBSWY3DPEHPK3PXP', now()
    FROM profile RETURNING user_id AS id
  `
  return rows[0].id
}

const T0 = 1_700_000_000_000
const HOUR = 60 * 60_000
// The policy written out, not imported from the library, so a changed default fails these tests.
const FREE_FAILURES = 5
const FIRST_LOCK_MS = 15 * 60_000
const QUIET_RESET_MS = 7 * 24 * HOUR

Deno.test("totp failure counter survives an API restart", async () => {
  await withSchema(async (open, sql) => {
    const userId = await insertEnrolledUser(sql)
    const before = createTotpFailures({ sql, clock: { now: () => T0 } })
    for (let attempt = 0; attempt <= FREE_FAILURES; attempt++) {
      expect(await before.begin(userId)).toBe(0)
    }
    expect(await before.begin(userId)).toBe(FIRST_LOCK_MS)

    // A restart: a new connection pool and a new counter, nothing shared but the database.
    const restarted = createTotpFailures({ sql: open(), clock: { now: () => T0 + 60_000 } })
    expect(await restarted.begin(userId)).toBe(FIRST_LOCK_MS - 60_000)

    const later = createTotpFailures({ sql: open(), clock: { now: () => T0 + FIRST_LOCK_MS } })
    expect(await later.begin(userId)).toBe(0)
  })
})

Deno.test("totp failure counter lets only six of twenty parallel guesses run", async () => {
  await withSchema(async (_open, sql) => {
    const userId = await insertEnrolledUser(sql)
    const counter = createTotpFailures({ sql, clock: { now: () => T0 } })
    const waits = await Promise.all(Array.from({ length: 20 }, () => counter.begin(userId)))
    expect(waits.filter((wait) => wait === 0)).toHaveLength(FREE_FAILURES + 1)
  })
})

Deno.test("totp failure counter gives back exactly the slot a correct code took", async () => {
  await withSchema(async (_open, sql) => {
    const userId = await insertEnrolledUser(sql)
    const counter = createTotpFailures({ sql, clock: { now: () => T0 } })
    for (let attempt = 0; attempt < FREE_FAILURES; attempt++) await counter.begin(userId)
    await counter.refund(userId)
    // Four failures are left on the count, so one more is free and the next one locks.
    expect(await counter.begin(userId)).toBe(0)
    expect(await counter.begin(userId)).toBe(0)
    expect(await counter.begin(userId)).toBe(FIRST_LOCK_MS)
  })
})

Deno.test("totp failure counter starts again from 0 after seven quiet days", async () => {
  await withSchema(async (open, sql) => {
    const early = await insertEnrolledUser(sql)
    const late = await insertEnrolledUser(sql)
    for (const userId of [early, late]) {
      for (let attempt = 0; attempt <= FREE_FAILURES; attempt++) {
        const counter = createTotpFailures({ sql, clock: { now: () => T0 } })
        await counter.begin(userId)
        await counter.fail(userId)
      }
    }
    // One millisecond short of seven days: the seventh failure counts and doubles the lock.
    const almost = createTotpFailures({
      sql: open(),
      clock: { now: () => T0 + QUIET_RESET_MS - 1 },
    })
    expect(await almost.begin(early)).toBe(0)
    expect(await almost.begin(early)).toBe(2 * FIRST_LOCK_MS)

    const after = createTotpFailures({ sql: open(), clock: { now: () => T0 + QUIET_RESET_MS } })
    for (let attempt = 0; attempt <= FREE_FAILURES; attempt++) {
      expect(await after.begin(late)).toBe(0)
    }
    expect(await after.begin(late)).toBe(FIRST_LOCK_MS)
  })
})

Deno.test("totp failure counter caps a guesser under 600 guesses in a year", async () => {
  const year = 365 * 24 * 60 * 60_000
  /** Guesses the counter lets through in a year when the guesser follows `nextTry`. */
  async function guessesInAYear(
    sql: postgres.Sql,
    userId: number,
    nextTry: (now: number, waitMs: number) => number,
  ): Promise<number> {
    let now = T0
    let guesses = 0
    const counter = createTotpFailures({ sql, clock: { now: () => now } })
    while (now < T0 + year) {
      const waitMs = await counter.begin(userId)
      if (waitMs === 0) {
        guesses += 1
        await counter.fail(userId)
      }
      now = nextTry(now, waitMs)
    }
    return guesses
  }
  await withSchema(async (_open, sql) => {
    // Tries again the moment the lock ends, and every hour while there is none.
    const eager = await insertEnrolledUser(sql)
    const eagerGuesses = await guessesInAYear(
      sql,
      eager,
      (now, waitMs) => now + Math.max(waitMs, HOUR),
    )
    expect(eagerGuesses).toBeLessThan(600)
    // Guesses hourly while allowed, and waits seven days when the lock is longer than an hour, so
    // the count starts again from 0 every time.
    const patient = await insertEnrolledUser(sql)
    const patientGuesses = await guessesInAYear(
      sql,
      patient,
      (now, waitMs) => now + (waitMs > HOUR ? QUIET_RESET_MS : HOUR),
    )
    expect(patientGuesses).toBeLessThan(600)
    // 3 valid codes out of 10^6 at any moment: 600 guesses is a chance of 0.18%.
  })
})

Deno.test("totp failure counter lets only six of twenty parallel guesses run after a quiet spell", async () => {
  await withSchema(async (_open, sql) => {
    const userId = await insertEnrolledUser(sql)
    const before = createTotpFailures({ sql, clock: { now: () => T0 } })
    for (let attempt = 0; attempt < FREE_FAILURES; attempt++) {
      await before.begin(userId)
      await before.fail(userId)
    }
    const counter = createTotpFailures({ sql, clock: { now: () => T0 + QUIET_RESET_MS } })
    const waits = await Promise.all(Array.from({ length: 20 }, () => counter.begin(userId)))
    expect(waits.filter((wait) => wait === 0)).toHaveLength(FREE_FAILURES + 1)
  })
})

Deno.test("totp failure counter is free again after seven days of only correct codes", async () => {
  await withSchema(async (_open, sql) => {
    const userId = await insertEnrolledUser(sql)
    let now = T0
    const counter = createTotpFailures({ sql, clock: { now: () => now } })
    for (let attempt = 0; attempt < FREE_FAILURES; attempt++) {
      await counter.begin(userId)
      await counter.fail(userId)
    }
    // The owner signs in with the right code every day for a week.
    for (let day = 1; day <= 7; day++) {
      now = T0 + day * 24 * 60 * 60_000
      expect(await counter.begin(userId)).toBe(0)
      await counter.refund(userId)
    }
    for (let attempt = 0; attempt <= FREE_FAILURES; attempt++) {
      expect(await counter.begin(userId)).toBe(0)
    }
    expect(await counter.begin(userId)).toBeGreaterThan(0)
  })
})

Deno.test("totp failure counter ends the lock a correct code's own check set", async () => {
  await withSchema(async (_open, sql) => {
    const userId = await insertEnrolledUser(sql)
    const counter = createTotpFailures({ sql, clock: { now: () => T0 } })
    for (let attempt = 0; attempt < FREE_FAILURES; attempt++) {
      await counter.begin(userId)
      await counter.fail(userId)
    }
    // The sixth check sets the lock; it was the right code, so the lock goes with the slot.
    expect(await counter.begin(userId)).toBe(0)
    await counter.refund(userId)
    expect(await counter.begin(userId)).toBe(0)
  })
})

Deno.test("totp failure counter leaves no lock behind after a correct code", async () => {
  await withSchema(async (_open, sql) => {
    const userId = await insertEnrolledUser(sql)
    let now = T0
    const counter = createTotpFailures({ sql, clock: { now: () => now } })
    for (let attempt = 0; attempt <= FREE_FAILURES; attempt++) await counter.begin(userId)
    now = T0 + FIRST_LOCK_MS
    // The seventh check books a lock before its code is known. The code is correct, so the
    // refund must lift that lock: the owner's next check, on another device, is not refused.
    expect(await counter.begin(userId)).toBe(0)
    await counter.refund(userId)
    now += 60_000
    expect(await counter.begin(userId)).toBe(0)
  })
})

Deno.test("totp failure counter has nothing to count for a user without an enrolment", async () => {
  await withSchema(async (_open, sql) => {
    const counter = createTotpFailures({ sql, clock: { now: () => T0 } })
    for (let attempt = 0; attempt < 10; attempt++) expect(await counter.begin(424242)).toBe(0)
  })
})
