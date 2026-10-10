/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { OutboxProcessor, PostgresOutboxRepository } from "@spy4x/server/outbox"
import { NotifyStatus } from "@spy4x/realtime"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { GroupRole } from "@domain/groups"
import { GroupChangeNotifier } from "@server/groups/group-change-notify.ts"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { Realtime } from "../../apps/api/services/realtime.ts"
import { type GroupNewsTarget, listenForGroupNews } from "../../apps/api/services/group-news.ts"
import { buildAuthData } from "../../apps/api/_testing/fake-auth.ts"
import { insertUser, withSchema } from "./group-team.ts"

const SETTLE_MS = 5_000

/**
 * Passes the news of two groups on to `realtime` and records each sequence once handled. News of
 * any other group is dropped: NOTIFY is database-wide, so a listener may hear other processes.
 */
function onlyGroups(realtime: Realtime, groupIds: readonly string[]) {
  const announced: string[] = []
  const target: GroupNewsTarget = {
    async notifyGroupChange(id, sequence) {
      if (!groupIds.includes(id)) return NotifyStatus.NoRecipients
      const status = await realtime.notifyGroupChange(id, sequence)
      announced.push(`${id}:${sequence}`)
      return status
    },
    notifyAccessLoss: () => 0,
  }
  return { target, announced }
}

async function until(ready: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + SETTLE_MS
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

Deno.test("members of both groups hear that a note moved", async () => {
  await withSchema(async (sql: postgres.Sql) => {
    const groups = new PostgresGroupRepository(sql)
    const notes = new PostgresNoteRepository(sql)
    const processor = new OutboxProcessor(
      new PostgresOutboxRepository(sql),
      new GroupChangeNotifier(sql),
    )
    const editor = await insertUser(sql)
    const inSource = await insertUser(sql)
    const inTarget = await insertUser(sql)
    const stranger = await insertUser(sql)
    const source = crypto.randomUUID()
    const target = crypto.randomUUID()
    await groups.create({ id: source, name: "Source" }, editor)
    await groups.create({ id: target, name: "Target" }, editor)
    await groups.create({ id: crypto.randomUUID(), name: "Not shared" }, stranger)
    await sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id) VALUES
        (${source}, ${inSource}, ${GroupRole.VIEWER}, ${editor}),
        (${target}, ${inTarget}, ${GroupRole.VIEWER}, ${editor})
    `
    const noteId = crypto.randomUUID()
    await notes.create({ groupId: source, id: noteId, title: "Plan", body: "" }, editor, null)
    // What was written so far was announced before anyone listened.
    await processor.drainOnce()
    const clock = new FakeClock()
    const realtime = new Realtime({
      clock,
      entitledSession: () => Promise.resolve(null),
      memberUserIds: (groupId) => groups.listMemberUserIds(groupId),
      operations: {},
      log: () => {},
    })
    const sockets = new Map<number, FakeSocket>()
    for (const userId of [inSource, inTarget, stranger]) {
      const socket = new FakeSocket("wss://app.example.com/api/ws")
      socket.openFromPeer()
      realtime.attach(socket, buildAuthData({ user: { id: userId } }))
      sockets.set(userId, socket)
    }
    const news = onlyGroups(realtime, [source, target])
    const stop = await listenForGroupNews(sql, news.target, () => {})
    try {
      await notes.move({ fromGroupId: source, toGroupId: target, noteIds: [noteId] }, editor, null)
      const sequences = await sql<{ id: string; sequence: string }[]>`
        SELECT id, (next_change_sequence - 1)::text AS sequence FROM groups
        WHERE id IN (${source}, ${target})
      `
      await processor.drainOnce()
      await until(() => news.announced.length >= 2, "the hints of both groups")
      await drainMicrotasks()

      const sequenceOf = (id: string) => Number(sequences.find((row) => row.id === id)!.sequence)
      const hints = (userId: number) =>
        sockets.get(userId)!.frames().map((frame) => {
          const { groupId, sequence } = frame as { groupId: string; sequence: number }
          return `${groupId}:${sequence}`
        })
      expect(hints(inSource)).toEqual([`${source}:${sequenceOf(source)}`])
      expect(hints(inTarget)).toEqual([`${target}:${sequenceOf(target)}`])
      expect(sockets.get(stranger)!.frames()).toEqual([])
    } finally {
      await stop()
      realtime.shutdown()
    }
  })
})
