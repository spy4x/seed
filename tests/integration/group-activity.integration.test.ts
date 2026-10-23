/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { sha256Hex } from "@spy4x/platform/tokens"
import { ACTIVITY_KINDS, describeActivity, GroupRole } from "@domain/groups"
import { UserRole } from "@domain/identity"
import { AdminGroupActOutcome, adminGroupRows } from "@server/groups/admin-groups.ts"
import { PostgresGroupActivityRepository } from "@server/groups/postgres-activity-repository.ts"
import {
  invitationLookup,
  newInvitationToken,
  PostgresInvitationRepository,
} from "@server/groups/postgres-invitation-repository.ts"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { createOutboxProcessor, startRepeatingJobs } from "@server/jobs/wiring.ts"
import { purgeOldAuditEvents } from "@server/groups/purge-audit-events.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { insertUser, team, withSchema } from "./group-team.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"

/**
 * A group's activity log against a real Postgres built from schema.sql: every command of the group
 * writes the event the log shows, the log pages without skipping, a link exists only while the note
 * is in the group, and the worker's retention deletes old events. Needs "DB_HOST", "DB_USER",
 * "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when they are missing.
 */

const NO_LIMITS = { maxMembers: null, memberRoles: true }

async function nameUser(sql: postgres.Sql, userId: number, name: string) {
  await sql`UPDATE users SET first_name = ${name} WHERE id = ${userId}`
}

async function invite(
  invitations: PostgresInvitationRepository,
  groupId: string,
  actorId: number,
  email: string | null = null,
) {
  const token = newInvitationToken()
  const created = await invitations.create(
    {
      groupId,
      role: GroupRole.EDITOR,
      expiresInDays: 7,
      maxUses: 1,
      email,
      tokenHash: await sha256Hex(token),
    },
    actorId,
    NO_LIMITS,
  )
  expectVersion7Ids([created!.invitation])
  return { invitation: created!.invitation, lookup: await invitationLookup({ token }) }
}

async function homeOf(
  repository: {
    listForUser(
      id: number,
      page: { limit: number },
    ): Promise<{ groups: { id: string; name: string }[] }>
  },
  userId: number,
): Promise<string> {
  return (await repository.listForUser(userId, { limit: 20 })).groups.find((group) =>
    group.name === "Home"
  )!.id
}

Deno.test("activity: every command of a group writes the event its log shows", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, onlyHere, stranger } = await team(
      sql,
    )
    const activity = new PostgresGroupActivityRepository(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const notes = new PostgresNoteRepository(sql)
    for (
      const [id, name] of [[owner, "Olga"], [admin, "Adam"], [editor, "Ed"], [onlyHere, "Ola"], [
        stranger,
        "Sam",
      ]] as const
    ) await nameUser(sql, id, name)
    const homeId = await homeOf(repository, owner)
    // The events the team's setup wrote are not the commands under test.
    const setupLastId = BigInt((await activity.list(groupId, { limit: 1 })).events[0].id)

    await repository.rename(groupId, "Crew", owner, "req-1")
    await repository.updateDetails(
      groupId,
      { description: "Ours", color: "#1d4ed8", emoji: null },
      admin,
    )
    await repository.changeMemberRole(groupId, editor, GroupRole.ADMIN, owner)
    await repository.removeMember(groupId, onlyHere, admin)
    await repository.leave(groupId, viewer)
    const first = await invite(invitations, groupId, admin)
    await invitations.accept(first.lookup, stranger, NO_LIMITS)
    const second = await invite(invitations, groupId, admin)
    await invitations.revoke(groupId, second.invitation.id, admin)
    const bound = await invite(invitations, groupId, admin, "sam@example.com")
    await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('sam@example.com', ${stranger})`
    await invitations.decline(bound.lookup, stranger)
    const noteA = uuidV7()
    const noteB = uuidV7()
    const noteC = uuidV7()
    for (const id of [noteA, noteB, noteC]) {
      await notes.create(
        { groupId, id, title: `Note ${id.slice(-4)}`, body: "private text" },
        owner,
        null,
      )
    }
    await notes.move(
      { fromGroupId: groupId, toGroupId: homeId, noteIds: [noteA, noteB] },
      owner,
      null,
    )
    await notes.delete({ groupId, id: noteC, expectedVersion: 1 }, owner)
    await repository.transferOwnership(groupId, admin, owner)
    await repository.softDelete(groupId, admin)
    await repository.restore(groupId, admin)

    const log = await activity.list(groupId, { limit: 100 })
    const newest = log.events.filter((event) => BigInt(event.id) > setupLastId)
    expect(log.nextPageKey).toBeNull()
    expect(newest.map((event) => event.kind).reverse()).toEqual([
      "group.renamed",
      "group.details_updated",
      "group.member_role_changed",
      "group.member_removed",
      "group.member_left",
      "group.invitation_created",
      "group.invitation_accepted",
      "group.invitation_created",
      "group.invitation_revoked",
      "group.invitation_created",
      "group.invitation_declined",
      "note.created",
      "note.created",
      "note.created",
      "note.moved_out",
      "note.deleted",
      "group.ownership_transferred",
      "group.deleted",
      "group.restored",
    ])
    expect(newest.map((event) => describeActivity(event)).reverse()).toEqual([
      "Olga renamed the group from “Team” to “Crew”",
      "Adam changed the group's description, colour or emoji",
      "Olga changed Ed from an editor to an admin",
      "Adam removed Ola from the group",
      "Someone left the group",
      "Adam invited someone to join as an editor",
      "Sam joined the group",
      "Adam invited someone to join as an editor",
      "Adam withdrew an invitation",
      "Adam invited someone to join as an editor",
      "Sam declined an invitation",
      expect.stringMatching(/^Olga added the note “Note \w{4}”$/),
      expect.stringMatching(/^Olga added the note “Note \w{4}”$/),
      expect.stringMatching(/^Olga added the note “Note \w{4}”$/),
      "Olga moved 2 notes to Home",
      expect.stringMatching(/^Olga deleted the note “Note \w{4}”$/),
      "Olga made Adam the owner of the group",
      "Adam deleted the group",
      "Adam restored the group",
    ])

    // Every kind any command wrote, in any group, is one the log knows how to say.
    const written = await sql<{ eventKind: string }[]>`SELECT DISTINCT event_kind FROM audit_events`
    for (const { eventKind } of written) expect(ACTIVITY_KINDS).toContain(eventKind)
    expect(written.map((row) => row.eventKind)).toContain("note.moved_in")
  })
})

Deno.test("activity: a move says how many notes arrived in the group they came to", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    const homeId = await homeOf(repository, owner)
    const notes = new PostgresNoteRepository(sql)
    await nameUser(sql, owner, "Olga")
    const ids = [uuidV7(), uuidV7(), uuidV7()]
    for (const id of ids) {
      await notes.create({ groupId, id, title: "Plan", body: "" }, owner, null)
    }
    await notes.move({ fromGroupId: groupId, toGroupId: homeId, noteIds: ids }, owner, null)

    const [arrived] = (await new PostgresGroupActivityRepository(sql).list(homeId, { limit: 1 }))
      .events
    expect(arrived.kind).toBe("note.moved_in")
    expect(describeActivity(arrived)).toBe("Olga moved 3 notes here from another group")
    // The group the notes came to is not told which group they left.
    expect(arrived.details).toEqual({ count: 3 })
  })
})

Deno.test("activity: pages go back in time without skipping or repeating an event", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    const activity = new PostgresGroupActivityRepository(sql)
    for (let index = 0; index < 4; index++) await repository.rename(groupId, `Name ${index}`, owner)

    const everything = (await activity.list(groupId, { limit: 100 })).events
    expect(everything.length).toBe(5)
    const seen: string[] = []
    let after: { id: string } | undefined
    let pages = 0
    do {
      const page = await activity.list(groupId, { limit: 2, after })
      expect(page.events.length).toBeLessThanOrEqual(2)
      seen.push(...page.events.map((event) => event.id))
      after = page.nextPageKey ?? undefined
      pages++
    } while (after)
    expect(pages).toBe(3)
    expect(seen).toEqual(everything.map((event) => event.id))
    expect(new Set(seen).size).toBe(5)
  })
})

Deno.test("activity: a note links only while it is still in the group", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    const homeId = await homeOf(repository, owner)
    const activity = new PostgresGroupActivityRepository(sql)
    const notes = new PostgresNoteRepository(sql)
    const kept = uuidV7()
    const deleted = uuidV7()
    const moved = uuidV7()
    for (const id of [kept, deleted, moved]) {
      await notes.create({ groupId, id, title: "Plan", body: "private text" }, owner, null)
    }
    await notes.delete({ groupId, id: deleted, expectedVersion: 1 }, owner)
    await notes.move({ fromGroupId: groupId, toGroupId: homeId, noteIds: [moved] }, owner, null)

    const created = (await activity.list(groupId, { limit: 100 })).events.filter((event) =>
      event.kind === "note.created"
    )
    const exists = Object.fromEntries(
      created.map((event) => [event.entity!.id, event.entity!.exists]),
    )
    expect(exists).toEqual({ [kept]: true, [deleted]: false, [moved]: false })
    // The log keeps a title, never the body.
    for (const event of created) expect(event.details).toEqual({ title: "Plan" })
  })
})

Deno.test("retention: the nightly purge deletes events older than a year and keeps the rest", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    await repository.rename(groupId, "Crew", owner)
    await sql`
      UPDATE audit_events SET created_at = now() - interval '366 days'
      WHERE event_kind = 'group.created' AND group_id = ${groupId}
    `
    await sql`
      UPDATE audit_events SET created_at = now() - interval '364 days'
      WHERE event_kind = 'group.renamed'
    `
    const before = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_events`)[0].n

    expect(await purgeOldAuditEvents(sql)).toBe(1)
    const kinds = (await sql<{ eventKind: string }[]>`
      SELECT event_kind FROM audit_events WHERE group_id = ${groupId}
    `).map((row) => row.eventKind)
    expect(kinds).toEqual(["group.renamed"])
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_events`)[0].n)
      .toBe(before - 1)

    // A product that keeps its log longer, or shorter, says so.
    expect(await purgeOldAuditEvents(sql, 400)).toBe(0)
    expect(await purgeOldAuditEvents(sql, 30)).toBe(1)
  })
})

Deno.test("activity: an event outlives the account of its actor and of the member it names", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor } = await team(sql)
    await nameUser(sql, editor, "Ed")
    await nameUser(sql, owner, "Olga")
    await repository.changeMemberRole(groupId, editor, GroupRole.ADMIN, owner)
    await repository.rename(groupId, "Crew", editor)
    const activity = new PostgresGroupActivityRepository(sql)
    const before = (await activity.list(groupId, { limit: 2 })).events
    expect(before.map((event) => event.actor.name)).toEqual(["Ed", "Olga"])
    expect(before[1].target?.name).toBe("Ed")

    await sql`DELETE FROM group_members WHERE user_id = ${editor}`
    await sql`DELETE FROM groups WHERE owner_user_id = ${editor}`
    // The outbox keeps its own restricting reference to the actor; this test is about the log.
    await sql`DELETE FROM outbox_events WHERE actor_user_id = ${editor}`
    await sql`DELETE FROM users WHERE id = ${editor}`
    const [rename, role] = (await activity.list(groupId, { limit: 2 })).events
    expect(rename.actor.userId).toBeNull()
    expect(describeActivity(rename)).toBe("Deleted user renamed the group from “Team” to “Crew”")
    expect(role.target).toBeNull()
    expect(describeActivity(role)).toBe("Olga changed a member from an editor to an admin")
  })
})

Deno.test("activity: a person with no name reads as their e-mail, as actor and as target", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor } = await team(sql)
    await sql`UPDATE users SET first_name = NULL, last_name = NULL WHERE id IN (${owner}, ${editor})`
    for (const [id, email] of [[owner, "olga@example.com"], [editor, "ed@example.com"]] as const) {
      await sql`
        INSERT INTO auth_keys (user_id, method, subject, email)
        VALUES (${id}, 'email', ${email}, ${email})
      `
    }
    await repository.changeMemberRole(groupId, editor, GroupRole.ADMIN, owner)
    const activity = new PostgresGroupActivityRepository(sql)
    const [event] = (await activity.list(groupId, { limit: 1 })).events
    expect(describeActivity(event)).toBe(
      "olga@example.com changed ed@example.com from an editor to an admin",
    )
  })
})

Deno.test("activity: an operator's action reads Support team, never their name, e-mail or id", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor, viewer } = await team(sql)
    const operatorId = await insertUser(sql)
    await sql`UPDATE users SET role = ${UserRole.OPERATOR} WHERE id = ${operatorId}`
    await sql`
      UPDATE users SET first_name = NULL, last_name = NULL
      WHERE id IN (${owner}, ${editor}, ${operatorId})
    `
    for (
      const [id, email] of [
        [owner, "olga@example.com"],
        [editor, "ed@example.com"],
        [operatorId, "ops@example.com"],
      ] as const
    ) {
      await sql`
        INSERT INTO auth_keys (user_id, method, subject, email)
        VALUES (${id}, 'email', ${email}, ${email})
      `
    }
    await repository.changeMemberRole(groupId, viewer, GroupRole.EDITOR, owner)
    const operator = { id: operatorId, role: UserRole.OPERATOR }
    expect(await adminGroupRows(sql).removeMember(operator, groupId, editor)).toBe(
      AdminGroupActOutcome.Done,
    )
    const activity = new PostgresGroupActivityRepository(sql)

    const [removed, changed] = (await activity.list(groupId, { limit: 2 })).events
    expect(removed.actor).toEqual({ userId: null, name: "Support team" })
    expect(describeActivity(removed)).toBe("Support team removed ed@example.com from the group")
    // A member's own action still names them, by e-mail when they gave no name.
    expect(changed.actor).toEqual({ userId: owner, name: "olga@example.com" })
    expect(describeActivity(changed)).toBe(
      "olga@example.com changed a member from a viewer to an editor",
    )
    const nameless = JSON.stringify(await activity.list(groupId, { limit: 100 }))
    expect(nameless).not.toContain("ops@example.com")
    expect(nameless).not.toContain(`"userId":${operatorId},`)

    // A name the operator sets later does not reach the log either.
    await sql`UPDATE users SET first_name = 'Opal', last_name = 'Quist' WHERE id = ${operatorId}`
    const named = JSON.stringify(await activity.list(groupId, { limit: 100 }))
    expect(named).not.toContain("Opal")
    expect(named).not.toContain("Quist")
  })
})

Deno.test("activity: no stored fact holds an e-mail address", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    await repository.rename(groupId, "Crew", owner)
    const bound = await invite(invitations, groupId, admin, "sam@example.com")
    await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('sam@example.com', ${stranger})`
    await invitations.decline(bound.lookup, stranger)
    await invite(invitations, groupId, admin, "other@example.com")
    const stored = await sql<{ details: string }[]>`
      SELECT details::text AS details FROM audit_events WHERE event_kind LIKE 'group.invitation_%'
    `
    expect(stored.length).toBeGreaterThanOrEqual(3)
    for (const row of stored) expect(row.details).not.toContain("@")
    expect(
      (await sql`SELECT 1 FROM audit_events WHERE details::text LIKE '%@%'`).length,
    ).toBe(0)
  })
})

Deno.test("retention: the worker's nightly cleanup job deletes events past a year", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    await repository.rename(groupId, "Crew", owner)
    await sql`
      UPDATE audit_events SET created_at = now() - interval '400 days'
      WHERE group_id = ${groupId} AND event_kind = 'group.created'
    `
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

    const kinds = (await sql<{ eventKind: string }[]>`
      SELECT event_kind FROM audit_events WHERE group_id = ${groupId} ORDER BY id
    `).map((row) => row.eventKind)
    expect(kinds).toEqual(["group.renamed"])
  })
})
