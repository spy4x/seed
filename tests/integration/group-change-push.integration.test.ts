/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { OutboxProcessor, PostgresOutboxRepository } from "@spy4x/server/outbox"
import { NotifyStatus } from "@spy4x/realtime"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { GroupChangeNotifier, listenForGroupChanges } from "@server/groups/group-change-notify.ts"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { Realtime } from "../../apps/api/services/realtime.ts"
import { type GroupNewsTarget, listenForGroupNews } from "../../apps/api/services/group-news.ts"
import { buildAuthData } from "../../apps/api/_testing/fake-auth.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"

interface IdRow extends postgres.Row {
  id: number
}

const SETTLE_MS = 5_000

// NOTIFY is database-wide, not schema-wide. On Woodpecker the e2e-mpa step runs a worker against
// the same database while this suite runs, so a listener also hears other processes' changes.
// Every listener here keeps only the groups this test created.

/**
 * Passes the news of one group on to `realtime`, the way `listenForGroupNews` hands it to the
 * API's socket service, and records each sequence once it was handled. Another group's news is
 * dropped: it may come from another process on the same database, whose user ids can match.
 */
function onlyGroup(realtime: Realtime, groupId: string) {
  const announced: number[] = []
  const lost: number[] = []
  const target: GroupNewsTarget = {
    async notifyGroupChange(id, sequence) {
      if (id !== groupId) return NotifyStatus.NoRecipients
      const status = await realtime.notifyGroupChange(id, sequence)
      announced.push(sequence)
      return status
    },
    notifyAccessLoss(id, sequence, userIds) {
      if (id !== groupId) return 0
      const reached = realtime.notifyAccessLoss(id, sequence, userIds)
      lost.push(sequence)
      return reached
    },
  }
  return { target, announced, lost }
}

/** Runs `body` on a fresh schema built from schema.sql. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1, onnotice: () => {} })
  const schema = `push_test_${crypto.randomUUID().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await sql.unsafe(await Deno.readTextFile("libs/server/db/schema.sql"))
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

async function insertUser(sql: postgres.Sql): Promise<number> {
  const rows = await sql<IdRow[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `
  return rows[0].id
}

/** Resolves once `ready()` holds, checking every 20 ms; rejects after {@link SETTLE_MS}. */
async function until(ready: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + SETTLE_MS
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Resolves with the first value pushed, or rejects after {@link SETTLE_MS}. */
function next<T>(): { promise: Promise<T>; push: (value: T) => void } {
  let push!: (value: T) => void
  const promise = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no notification arrived")), SETTLE_MS)
    push = (value) => {
      clearTimeout(timer)
      resolve(value)
    }
  })
  return { promise, push }
}

Deno.test("a committed group change reaches its members' sockets as a hint", async (t) => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const processor = new OutboxProcessor(
      new PostgresOutboxRepository(sql),
      new GroupChangeNotifier(sql),
    )
    const owner = await insertUser(sql)
    const stranger = await insertUser(sql)

    await t.step("the worker's publish reaches the API's listener with the sequence", async () => {
      const groupId = crypto.randomUUID()
      const heard = next<{ groupId: string; sequence: number }>()
      const stop = await listenForGroupChanges(sql, (change) => {
        if (change.groupId === groupId) heard.push(change)
      })
      try {
        await repository.create({ id: groupId, name: "Pushed" }, owner)
        const result = await processor.drainOnce()

        expect(result.failed).toBe(0)
        expect(await heard.promise).toEqual({ groupId, sequence: 1 })
      } finally {
        await stop()
      }
    })

    await t.step("a change that rolled back is never announced", async () => {
      await processor.drainOnce()
      const rolledBackId = crypto.randomUUID()
      const announced: unknown[] = []
      const stop = await listenForGroupChanges(sql, (change) => {
        if (change.groupId === rolledBackId) announced.push(change)
      })
      try {
        await expect(sql.begin(async (transaction: postgres.TransactionSql) => {
          await new PostgresGroupRepository(transaction).createFirst(
            { id: rolledBackId, name: "Personal" },
            stranger,
          )
          throw new Error("the sign-up fails after the group was written")
        })).rejects.toThrow("sign-up fails")

        const result = await processor.drainOnce()
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(result.claimed).toBe(0)
        expect(announced).toEqual([])
      } finally {
        await stop()
      }
    })

    await t.step("the hint goes to the owner's socket and to nobody else's", async () => {
      // The stranger belongs to a group of their own, so "not a member of this group" is what
      // keeps the owner's hint from them, not "not a member of any group".
      await repository.create({ id: crypto.randomUUID(), name: "Not shared" }, stranger)
      await processor.drainOnce()
      const clock = new FakeClock()
      const realtime = new Realtime({
        clock,
        entitledSession: () => Promise.resolve(null),
        memberUserIds: (groupId) => new PostgresGroupRepository(sql).listMemberUserIds(groupId),
        operations: {},
        log: () => {},
      })
      const ownerSocket = new FakeSocket("wss://app.example.com/api/ws")
      const strangerSocket = new FakeSocket("wss://app.example.com/api/ws")
      for (const [socket, userId] of [[ownerSocket, owner], [strangerSocket, stranger]] as const) {
        socket.openFromPeer()
        realtime.attach(socket, buildAuthData({ user: { id: userId } }))
      }
      const groupId = crypto.randomUUID()
      const news = onlyGroup(realtime, groupId)
      const stop = await listenForGroupNews(sql, news.target, () => {})
      try {
        await repository.create({ id: groupId, name: "Members only" }, owner)
        await processor.drainOnce()
        await until(() => news.announced.includes(1), "the hint of the creation")
        await drainMicrotasks()

        expect(ownerSocket.frames()).toEqual([
          { kind: "change.hint", groupId, aggregate: "group", sequence: 1 },
        ])
        expect(strangerSocket.frames()).toEqual([])
      } finally {
        await stop()
        realtime.shutdown()
      }
    })
  })
})

Deno.test("a member who loses a group keeps the socket and gets no hint for it after the loss", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const processor = new OutboxProcessor(
      new PostgresOutboxRepository(sql),
      new GroupChangeNotifier(sql),
    )
    const owner = await insertUser(sql)
    const member = await insertUser(sql)
    // Both keep a group of their own, so the delete leaves neither without one.
    await repository.create({ id: crypto.randomUUID(), name: "Owner's own" }, owner)
    await repository.create({ id: crypto.randomUUID(), name: "Member's own" }, member)
    const groupId = crypto.randomUUID()
    await repository.create({ id: groupId, name: "Shared" }, owner)
    await sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      VALUES (${groupId}, ${member}, 2, ${owner})
    `
    await processor.drainOnce()

    const realtime = new Realtime({
      clock: new FakeClock(),
      entitledSession: () => Promise.resolve(null),
      memberUserIds: (id) => new PostgresGroupRepository(sql).listMemberUserIds(id),
      operations: {},
      log: () => {},
    })
    const memberSocket = new FakeSocket("wss://app.example.com/api/ws")
    memberSocket.openFromPeer()
    realtime.attach(memberSocket, buildAuthData({ user: { id: member } }))
    // The API's listeners, as apps/api/index.ts starts them, kept to this test's group.
    const { target, announced, lost } = onlyGroup(realtime, groupId)
    const stop = await listenForGroupNews(sql, target, () => {})
    const hint = (sequence: number) => ({
      kind: "change.hint",
      groupId,
      aggregate: "group",
      sequence,
    })
    try {
      // The rename's outbox row is still waiting when the delete commits, as it would be when the
      // worker is a moment behind: its hint is resolved after the member lost the group.
      await repository.rename(groupId, "Renamed", owner)
      const deleted = await repository.softDelete(groupId, owner)
      const deletedAt = Number(deleted!.changeSequence)
      await until(() => lost.includes(deletedAt), "the access loss of the delete")
      await processor.drainOnce()
      await until(
        () => announced.includes(deletedAt - 1) && announced.includes(deletedAt),
        "the outbox hints of the rename and the delete",
      )
      // Any later announcement for the group, too.
      await realtime.notifyGroupChange(groupId, deletedAt + 1)
      await drainMicrotasks()

      expect(memberSocket.frames()).toEqual([hint(deletedAt)])
      expect(realtime.count(member)).toBe(1)

      // Access comes back with the restore, and so do the hints.
      const restored = await repository.restore(groupId, owner)
      const restoredAt = Number(restored!.changeSequence)
      await processor.drainOnce()
      await until(() => announced.includes(restoredAt), "the outbox hint of the restore")
      await drainMicrotasks()

      expect(memberSocket.frames()).toEqual([hint(deletedAt), hint(restoredAt)])
    } finally {
      await stop()
      realtime.shutdown()
    }
  })
})
