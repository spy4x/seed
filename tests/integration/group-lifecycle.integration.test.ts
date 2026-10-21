/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { BillingStatus } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { NoteError } from "@domain/notes"
import {
  GroupNotActiveError,
  recordAccessChange,
  recordGroupChange,
} from "@server/groups/group-change-log.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { purgeDeletedGroups } from "@server/groups/purge-deleted-groups.ts"
import {
  type IdRow,
  insertUser,
  listenForLosses,
  revision,
  team,
  withSchema,
} from "./group-team.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"

/**
 * Rename, delete and restore of a group against a real Postgres built from schema.sql: who may do
 * what, the rule that a person keeps one group, what members see, the 30 days and the purge. Needs
 * "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when they
 * are missing.
 */

async function expireDeletion(sql: postgres.Sql, groupId: string, days: number): Promise<void> {
  await sql`
    UPDATE groups SET deleted_at = now() - make_interval(days => ${days}) WHERE id = ${groupId}
  `
}

Deno.test("rename: only an admin or the owner changes the name", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, stranger } = await team(sql)

    for (const [who, name] of [[viewer, "v"], [editor, "e"], [stranger, "s"]] as const) {
      expect(await repository.rename(groupId, name, who)).toBeNull()
    }
    expect((await repository.getSummaryForMember(groupId, owner))?.name).toBe("Team")

    const byAdmin = await repository.rename(groupId, "By admin", admin)
    expect(byAdmin?.name).toBe("By admin")
    const byOwner = await repository.rename(groupId, "By owner", owner)
    expect(byOwner?.name).toBe("By owner")
    expect(byOwner!.changeSequence > byAdmin!.changeSequence).toBe(true)
  })
})

Deno.test("details: only an admin or the owner sets them, and every member reads them", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, stranger } = await team(sql)
    const details = { description: "Our trips", color: "#1d4ed8" as const, emoji: "🏕️" }

    for (const who of [viewer, editor, stranger]) {
      expect(await repository.updateDetails(groupId, details, who)).toBeNull()
    }
    const untouched = await repository.getSummaryForMember(groupId, viewer)
    expect([untouched?.description, untouched?.color, untouched?.emoji]).toEqual(["", null, null])

    const byAdmin = await repository.updateDetails(groupId, details, admin, "req-details")
    expect(byAdmin).toMatchObject(details)
    const seen = await repository.getSummaryForMember(groupId, viewer)
    expect(seen).toMatchObject(details)
    const listed = (await repository.listForUser(viewer, { limit: 10 })).groups[0]
    expect(listed).toMatchObject(details)

    const cleared = await repository.updateDetails(
      groupId,
      { description: "", color: null, emoji: null },
      owner,
    )
    expect(cleared).toMatchObject({ description: "", color: null, emoji: null })
    expect(cleared!.changeSequence > byAdmin!.changeSequence).toBe(true)
  })
})

Deno.test("create: one write stores the name with the description, colour and emoji", async () => {
  await withSchema(async (sql) => {
    const { repository, owner } = await team(sql)
    const details = { description: "Our trips", color: "#15803d" as const, emoji: "🏕️" }

    const created = await repository.create({ id: uuidV7(), name: "Trips", ...details }, owner)
    expect(created.group).toMatchObject({ name: "Trips", ...details })
    const read = await repository.getSummaryForMember(created.group.id, owner)
    expect(read).toMatchObject({ name: "Trips", ...details })

    const plain = await repository.create({ id: uuidV7(), name: "Plain" }, owner)
    expect(plain.group).toMatchObject({ description: "", color: null, emoji: null })
  })
})

Deno.test("details: an edit writes an audit row and moves the group's change sequence", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)

    await repository.updateDetails(
      groupId,
      { description: "x", color: "#b91c1c", emoji: null },
      owner,
      "req-details",
    )

    const audit = await sql<{ kind: string; request: string }[]>`
      SELECT event_kind AS kind, request_id AS request
      FROM audit_events WHERE group_id = ${groupId} AND event_kind = 'group.details_updated'
    `
    expect(audit).toEqual([{ kind: "group.details_updated", request: "req-details" }])
    const outbox = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM outbox_events
      WHERE aggregate_id = ${groupId} AND event_kind = 'group.details_updated'
    `
    expect(outbox[0].n).toBe(1)
  })
})

Deno.test("details: the database refuses a description over 500 characters", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)

    await expect(
      repository.updateDetails(
        groupId,
        { description: "x".repeat(501), color: null, emoji: null },
        owner,
      ),
    ).rejects.toThrow(`groups_description_check`)
  })
})

Deno.test("delete: only the owner deletes, and a refused attempt changes nothing", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, stranger } = await team(sql)

    for (const who of [admin, editor, viewer, stranger]) {
      expect(await repository.softDelete(groupId, who)).toBeNull()
    }
    expect((await repository.getSummaryForMember(groupId, owner))?.name).toBe("Team")

    const deleted = await repository.softDelete(groupId, owner)
    expect(deleted?.id).toBe(groupId)
    expect(await repository.getForMember(groupId, owner)).toBeNull()
  })
})

Deno.test("delete: the server refuses to delete the last group of the person", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const owner = await insertUser(sql)
    const only = uuidV7()
    await repository.ensureFirst({ id: only, name: "Only" }, owner)

    await expect(repository.softDelete(only, owner)).rejects.toMatchObject({
      code: "LAST_GROUP",
    })
    expect((await repository.getSummaryForMember(only, owner))?.name).toBe("Only")
    const marked = await sql`SELECT 1 FROM groups WHERE id = ${only} AND deleted_at IS NOT NULL`
    expect(marked.length).toBe(0)
  })
})

Deno.test("delete: a member whose only group it was gets a new one, others keep theirs", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor, onlyHere } = await team(sql)

    await repository.softDelete(groupId, owner)

    const stranded = (await repository.listForUser(onlyHere, { limit: 10 })).groups
    expect(stranded.map((group) => group.name)).toEqual(["Personal"])
    expectVersion7Ids(stranded)
    const own = (await repository.listForUser(editor, { limit: 10 })).groups
    expect(own.map((group) => group.name)).toEqual(["Own"])
  })
})

Deno.test("delete: nobody keeps the deleted group selected", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor, onlyHere } = await team(sql)
    for (const user of [owner, editor, onlyHere]) {
      expect(await repository.select(user, groupId)).not.toBeNull()
    }

    await repository.softDelete(groupId, owner)

    for (const user of [owner, editor, onlyHere]) {
      const selected = await repository.getSelected(user)
      expect(selected.groupId).not.toBeNull()
      expect(selected.groupId).not.toBe(groupId)
    }
    expect(await repository.select(editor, groupId)).toBeNull()
  })
})

Deno.test("delete and restore each raise the group's authorization revision; a refusal does not", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin } = await team(sql)
    expect(await revision(sql, groupId)).toBe("1")

    expect(await repository.softDelete(groupId, admin)).toBeNull()
    expect(await revision(sql, groupId)).toBe("1")

    const deleted = await repository.softDelete(groupId, owner)
    expect(deleted?.authorizationRevision).toBe("2")
    expect(await revision(sql, groupId)).toBe("2")

    const restored = await repository.restore(groupId, owner)
    expect(restored?.authorizationRevision).toBe("3")
    expect(await revision(sql, groupId)).toBe("3")
  })
})

Deno.test("delete: every member leaves the hint list and is named, after the commit, as having lost the group", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, onlyHere } = await team(sql)
    const everyone = [owner, admin, editor, viewer, onlyHere].sort((a, b) => a - b)
    expect(await repository.listMemberUserIds(groupId)).toEqual(everyone)
    const listener = await listenForLosses(sql, groupId)
    try {
      const deleted = await repository.softDelete(groupId, owner)

      expect(await repository.listMemberUserIds(groupId)).toEqual([])
      const losses = await listener.heard(1)
      expect(losses.length).toBe(1)
      expect(losses[0].deletedWhenHeard).toBe(true)
      expect(losses[0].loss.sequence).toBe(Number(deleted!.changeSequence))
      expect([...losses[0].loss.userIds].sort((a, b) => a - b)).toEqual(everyone)

      // The restore gives the group back and takes nobody's access away.
      await repository.restore(groupId, owner)
      expect(await repository.listMemberUserIds(groupId)).toEqual(everyone)
      expect((await listener.heard(2)).length).toBe(1)
    } finally {
      await listener.stop()
    }
  })
})

Deno.test("delete: a group with more members than one notification holds names all of them", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    const crowd = (await sql<IdRow[]>`
      WITH auth_user AS (
        INSERT INTO auth_users SELECT FROM generate_series(1, 1200) RETURNING id
      )
      INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
    `).map((row) => row.id)
    // They also join the owner's other group, so the delete strands nobody (no new groups to make).
    const home = (await sql<{ groupId: string }[]>`
      SELECT group_id FROM group_members WHERE user_id = ${owner} AND group_id <> ${groupId}
    `)[0].groupId
    await sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      SELECT target, id, ${GroupRole.VIEWER}, ${owner}
      FROM unnest(${crowd}::int4[]) AS id, unnest(${[groupId, home]}::uuid[]) AS target
    `
    const members = await repository.listMemberUserIds(groupId)
    const listener = await listenForLosses(sql, groupId)
    try {
      await repository.softDelete(groupId, owner)

      const losses = await listener.heard(3)
      expect(losses.length).toBe(3)
      const named = losses.flatMap(({ loss }) => loss.userIds).sort((a, b) => a - b)
      expect(named).toEqual(members)
    } finally {
      await listener.stop()
    }
  })
})

Deno.test("an access change that rolls back raises no revision and names nobody", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin } = await team(sql)
    const listener = await listenForLosses(sql, groupId)
    try {
      await expect(sql.begin(async (transaction: postgres.TransactionSql) => {
        await recordAccessChange(transaction, groupId, owner, "group.member_removed", [admin])
        throw new Error("the removal fails after its change was recorded")
      })).rejects.toThrow("removal fails")

      expect(await revision(sql, groupId)).toBe("1")
      expect(await listener.heard(1)).toEqual([])
    } finally {
      await listener.stop()
    }
  })
})

Deno.test("restore: only the owner restores, and only inside 30 days", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, stranger } = await team(sql)
    await repository.softDelete(groupId, owner)

    expect((await repository.listRestorable(owner)).map((group) => group.id)).toEqual([groupId])
    for (const who of [admin, editor, stranger]) {
      expect(await repository.listRestorable(who)).toEqual([])
      expect(await repository.restore(groupId, who)).toBeNull()
    }

    await expireDeletion(sql, groupId, 31)
    expect(await repository.restore(groupId, owner)).toBeNull()
    expect(await repository.listRestorable(owner)).toEqual([])

    await expireDeletion(sql, groupId, 29)
    const restored = await repository.restore(groupId, owner)
    expect(restored?.name).toBe("Team")
    expect((await repository.getSummaryForMember(groupId, editor))?.name).toBe("Team")
    expect(await repository.listRestorable(owner)).toEqual([])
  })
})

Deno.test("purge: removes groups deleted over 30 days ago with everything in them", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor } = await team(sql)
    const kept = (await repository.create({ id: uuidV7(), name: "Recent" }, owner)).group
    await sql`
      INSERT INTO notes (id, group_id, title, body, change_sequence, created_by_user_id, updated_by_user_id)
      VALUES (${uuidV7()}, ${groupId}, 't', 'b', 1, ${owner}, ${owner})
    `
    await sql`
      INSERT INTO audit_events (event_kind, actor_user_id, group_id)
      VALUES ('group.created', ${owner}, ${groupId})
    `
    await repository.select(editor, groupId)
    await repository.softDelete(groupId, owner)
    await repository.softDelete(kept.id, owner)
    await expireDeletion(sql, groupId, 31)
    await expireDeletion(sql, kept.id, 29)

    expect(await purgeDeletedGroups(sql)).toEqual({ removed: 1, kept: 0 })

    for (const table of ["groups", "group_members", "notes"]) {
      const rows = await sql`SELECT 1 FROM ${sql(table)} WHERE ${
        sql(table === "groups" ? "id" : "group_id")
      } = ${groupId}`
      expect(rows.length).toBe(0)
    }
    // The audit rows stay as a record, without the group they were about.
    const audit = await sql<{ kind: string; groupId: string | null }[]>`
      SELECT event_kind AS kind, group_id FROM audit_events
      WHERE actor_user_id = ${owner} AND event_kind = 'group.created' AND group_id IS NULL
    `
    expect(audit.length).toBeGreaterThan(0)
    const survivors = await sql`SELECT 1 FROM audit_events WHERE group_id = ${groupId}`
    expect(survivors.length).toBe(0)
    const stillThere = await sql`SELECT 1 FROM groups WHERE id = ${kept.id}`
    expect(stillThere.length).toBe(1)
    expect(await purgeDeletedGroups(sql)).toEqual({ removed: 0, kept: 0 })
  })
})

Deno.test("purge: keeps a deleted group that a webhook subscribed after the delete", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    const cancelled = (await repository.create({ id: uuidV7(), name: "Old" }, owner))
      .group
    await repository.softDelete(groupId, owner)
    await repository.softDelete(cancelled.id, owner)
    // The webhooks arrive after the deletes: one live subscription, one already cancelled.
    for (
      const [id, status] of [
        [groupId, BillingStatus.Active],
        [cancelled.id, BillingStatus.Canceled],
      ] as const
    ) {
      await sql`
        INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
          provider_event_at, provider_event_rank)
        VALUES (${id}, ${"sub_" + id}, 'pro', ${status}, now(), 1)
      `
    }
    await expireDeletion(sql, groupId, 31)
    await expireDeletion(sql, cancelled.id, 31)

    expect(await purgeDeletedGroups(sql)).toEqual({ removed: 1, kept: 1 })

    const left = await sql`SELECT 1 FROM subscriptions WHERE group_id = ${groupId}`
    expect(left.length).toBe(1)
    const gone = await sql`SELECT 1 FROM groups WHERE id = ${cancelled.id}`
    expect(gone.length).toBe(0)
  })
})

Deno.test("purge: keeps a group whose subscription a webhook commits while the purge waits", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    await repository.softDelete(groupId, owner)
    await expireDeletion(sql, groupId, 31)

    let commit = () => {}
    const committed = new Promise<void>((resolve) => (commit = resolve))
    let locked = () => {}
    const holding = new Promise<void>((resolve) => (locked = resolve))
    // The webhook's transaction holds the group row with its new subscription, uncommitted.
    const webhook = sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
          provider_event_at, provider_event_rank)
        VALUES (${groupId}, 'sub_late', 'pro', ${BillingStatus.Active}, now(), 1)
      `
      await transaction`UPDATE groups SET updated_at = now() WHERE id = ${groupId}`
      locked()
      await committed
    })
    await holding
    const purge = purgeDeletedGroups(sql)
    let purgeWaited = false
    for (let attempt = 0; attempt < 50 && !purgeWaited; attempt++) {
      const [{ waiting }] = await sql<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      `
      purgeWaited = waiting >= 1
      if (!purgeWaited) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    commit()
    // Without the wait this test would not exercise the race at all.
    expect(purgeWaited).toBe(true)
    await webhook

    expect(await purge).toEqual({ removed: 0, kept: 1 })
    const left = await sql`SELECT 1 FROM subscriptions WHERE group_id = ${groupId}`
    expect(left.length).toBe(1)
  })
})

Deno.test("delete and restore are announced to the members through the outbox", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    const announced = async (kind: string) =>
      (await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM outbox_events
        WHERE group_id = ${groupId} AND event_kind = ${kind}
      `)[0].count
    const sequence = async () =>
      (await sql<{ next: string }[]>`
        SELECT next_change_sequence::text AS next FROM groups WHERE id = ${groupId}
      `)[0].next

    const before = BigInt(await sequence())
    await repository.softDelete(groupId, owner)
    expect(await announced("group.deleted")).toBe(1)
    expect(BigInt(await sequence()) > before).toBe(true)

    const afterDelete = BigInt(await sequence())
    await repository.restore(groupId, owner)
    expect(await announced("group.restored")).toBe(1)
    expect(BigInt(await sequence()) > afterDelete).toBe(true)
  })
})

Deno.test("delete: two deletes at once never leave a person without a group", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const ann = await insertUser(sql)
    const bob = await insertUser(sql)
    // Each owns one group and is a member of the other's, and has no other group: either delete
    // alone is allowed, both together would leave both people with nothing.
    const annsGroup = (await repository.create({ id: uuidV7(), name: "Ann" }, ann)).group
    const bobsGroup = (await repository.create({ id: uuidV7(), name: "Bob" }, bob)).group
    await sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id) VALUES
        (${annsGroup.id}, ${bob}, ${GroupRole.EDITOR}, ${ann}),
        (${bobsGroup.id}, ${ann}, ${GroupRole.EDITOR}, ${bob})
    `

    // Both deletes start while a third transaction holds both people's rows, and run on together
    // when it lets go: without locks on every member they would not see each other's work.
    const hold = await sql.reserve()
    await hold`BEGIN`
    await hold`SELECT id FROM users WHERE id IN (${ann}, ${bob}) ORDER BY id FOR UPDATE`
    const results = Promise.allSettled([
      repository.softDelete(annsGroup.id, ann),
      repository.softDelete(bobsGroup.id, bob),
    ])
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ waiting }] = await sql<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database()
      `
      if (waiting >= 2) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await hold`COMMIT`
    hold.release()
    const settled = await results

    for (const person of [ann, bob]) {
      const { groups } = await repository.listForUser(person, { limit: 10 })
      expect(groups.length).toBeGreaterThan(0)
    }
    const refused = settled.filter((result) => result.status === "rejected")
    expect(refused.length).toBe(1)
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({ code: "LAST_GROUP" })
  })
})

Deno.test("delete: a group that is already deleted does not count as another group", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const owner = await insertUser(sql)
    const live = (await repository.create({ id: uuidV7(), name: "Live" }, owner)).group
    const gone = (await repository.create({ id: uuidV7(), name: "Gone" }, owner)).group
    await sql`UPDATE groups SET deleted_at = now() WHERE id = ${gone.id}`

    await expect(repository.softDelete(live.id, owner)).rejects.toMatchObject({
      code: "LAST_GROUP",
    })
    expect((await repository.getSummaryForMember(live.id, owner))?.name).toBe("Live")
  })
})

Deno.test("rename, delete and restore each write an audit row with the request id", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)

    await repository.rename(groupId, "Trip", owner, "req-rename")
    await repository.softDelete(groupId, owner, "req-delete")
    await repository.restore(groupId, owner, "req-restore")

    const rows = await sql<{ kind: string; actor: number; request: string }[]>`
      SELECT event_kind AS kind, actor_user_id AS actor, request_id AS request
      FROM audit_events WHERE group_id = ${groupId} AND event_kind <> 'group.created'
      ORDER BY id
    `
    expect(rows).toEqual([
      { kind: "group.renamed", actor: owner, request: "req-rename" },
      { kind: "group.deleted", actor: owner, request: "req-delete" },
      { kind: "group.restored", actor: owner, request: "req-restore" },
    ])
  })
})

Deno.test("create, rename, delete and restore keep a 128-character request id whole", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const owner = await insertUser(sql)
    const id = "r".repeat(128)
    const created = (await repository.create({ id: uuidV7(), name: "A", requestId: id }, owner))
      .group
    // The person keeps a second group, so deleting the first is allowed.
    await repository.create({ id: uuidV7(), name: "B" }, owner)

    await repository.rename(created.id, "Trip", owner, id)
    await repository.softDelete(created.id, owner, id)
    await repository.restore(created.id, owner, id)

    const rows = await sql<{ kind: string; request: string }[]>`
      SELECT event_kind AS kind, request_id AS request
      FROM audit_events WHERE group_id = ${created.id} ORDER BY id
    `
    expect(rows).toEqual([
      { kind: "group.created", request: id },
      { kind: "group.renamed", request: id },
      { kind: "group.deleted", request: id },
      { kind: "group.restored", request: id },
    ])
  })
})

Deno.test("a refused rename, delete or restore writes no audit row", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, viewer } = await team(sql)

    await repository.rename(groupId, "Nope", viewer, "req-1")
    await repository.softDelete(groupId, viewer, "req-2")
    await repository.restore(groupId, viewer, "req-3")

    const rows = await sql`
      SELECT 1 FROM audit_events WHERE group_id = ${groupId} AND event_kind <> 'group.created'
    `
    expect(rows.length).toBe(0)
  })
})

Deno.test("rename: a deleted group cannot be renamed, even by its owner", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    await repository.softDelete(groupId, owner)

    expect(await repository.rename(groupId, "Too late", owner)).toBeNull()

    const name = await sql<{ name: string }[]>`SELECT name FROM groups WHERE id = ${groupId}`
    expect(name[0].name).toBe("Team")
  })
})

Deno.test("notes: a write after the group was deleted is refused and leaves no trace", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    const notes = new PostgresNoteRepository(sql)
    const existing = uuidV7()
    await notes.create({ groupId, id: existing, title: "Before", body: "" }, owner, null)
    // The handlers check the role, then write. A delete that lands between the two:
    await repository.softDelete(groupId, owner)
    const outboxBefore = (await sql`SELECT 1 FROM outbox_events`).length

    const refused = [
      () => notes.create({ groupId, id: uuidV7(), title: "New", body: "" }, owner, null),
      () =>
        notes.update(
          { groupId, id: existing, title: "After", body: "", expectedVersion: 1 },
          owner,
        ),
      () => notes.delete({ groupId, id: existing, expectedVersion: 1 }, owner),
    ]

    for (const write of refused) {
      const error = await write().then(() => null, (cause) => cause)
      expect(error).toBeInstanceOf(NoteError)
      expect(error).toMatchObject({ code: "GROUP_NOT_FOUND" })
    }
    const rows = await sql<{ title: string; version: number; deletedAt: Date | null }[]>`
      SELECT title, version, deleted_at FROM notes WHERE group_id = ${groupId}
    `
    expect(rows).toEqual([{ title: "Before", version: 1, deletedAt: null }])
    expect((await sql`SELECT 1 FROM outbox_events`).length).toBe(outboxBefore)
  })
})

Deno.test("delete: an unfinished note insert neither blocks the delete nor deadlocks with it", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)

    // A note insert in flight: its foreign keys hold a key-share lock on the group and the person.
    // A delete that locked those rows harder (FOR UPDATE) would wait for it, and the note's own
    // write to the group would then wait for the delete: a deadlock.
    const writing = await sql.reserve()
    await writing`BEGIN`
    await writing`
      INSERT INTO notes (id, group_id, title, body, change_sequence, created_by_user_id, updated_by_user_id)
      VALUES (${uuidV7()}, ${groupId}, 'Racing', '', 1, ${owner}, ${owner})
    `

    const finished = await Promise.race([
      repository.softDelete(groupId, owner).then(() => "deleted"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 5000)),
    ])
    expect(finished).toBe("deleted")

    // The note's write to the group now finds it deleted, and rolls the note back.
    // A reserved connection inside BEGIN is a transaction, though postgres.js types it otherwise.
    const inTransaction = writing as unknown as postgres.TransactionSql
    await expect(recordGroupChange(inTransaction, groupId, owner, "note.created")).rejects
      .toBeInstanceOf(GroupNotActiveError)
    await writing`ROLLBACK`
    writing.release()
    expect((await sql`SELECT 1 FROM notes WHERE group_id = ${groupId}`).length).toBe(0)
  })
})
