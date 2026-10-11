/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { GroupError, GroupRole } from "@domain/groups"
import { listenForGroupAccessLoss } from "@server/groups/group-change-notify.ts"
import { revision, team, withSchema } from "./group-team.ts"
import { expectVersion7Ids } from "./ids.ts"

/**
 * The members of a group against a real Postgres built from schema.sql: the list, role changes,
 * removal and leaving, who may do each, and what each leaves behind (audit rows, the raised
 * revision, the access-lost notification). Needs "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME"
 * (recipe in docs/handoff.md); it fails when they are missing.
 */

async function auditKinds(sql: postgres.Sql, groupId: string): Promise<string[]> {
  const rows = await sql<{ eventKind: string }[]>`
    SELECT event_kind FROM audit_events WHERE group_id = ${groupId} ORDER BY id
  `
  return rows.map((row) => row.eventKind)
}

async function memberRole(sql: postgres.Sql, groupId: string, userId: number) {
  return (await sql<{ role: number }[]>`
    SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}
  `)[0]?.role ?? null
}

async function groupNames(sql: postgres.Sql, userId: number): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT groups.name FROM groups
    INNER JOIN group_members ON group_members.group_id = groups.id
    WHERE group_members.user_id = ${userId} AND groups.deleted_at IS NULL
    ORDER BY groups.created_at
  `
  return rows.map((row) => row.name)
}

async function refusal(write: Promise<unknown>): Promise<string> {
  try {
    await write
  } catch (error) {
    if (error instanceof GroupError) return error.code
    throw error
  }
  throw new Error("The write was not refused")
}

/**
 * Listens for the group's access losses and stores, for each, whether the member it names was
 * still in the group on another connection the moment it arrived: `false` proves it came after
 * the commit.
 */
async function listenForMembershipLoss(sql: postgres.Sql, groupId: string) {
  const heard: { userIds: number[]; stillMember: boolean }[] = []
  const reads: Promise<void>[] = []
  const stop = await listenForGroupAccessLoss(sql, (loss) => {
    if (loss.groupId !== groupId) return
    reads.push((async () => {
      const role = await memberRole(sql, groupId, loss.userIds[0])
      heard.push({ userIds: loss.userIds, stillMember: role !== null })
    })())
  })
  async function wait(count: number) {
    const deadline = Date.now() + 5_000
    while (heard.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    await Promise.all(reads)
    return heard
  }
  return { wait, stop }
}

Deno.test("members: every member sees the list, with names, roles, which one is them and the count", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, onlyHere, stranger } = await team(
      sql,
    )
    await sql`UPDATE users SET first_name = 'Ann', last_name = 'Owner' WHERE id = ${owner}`
    await sql`
      INSERT INTO auth_keys (user_id, method, subject, email)
      VALUES (${viewer}, 'email', ${`viewer-${viewer}`}, 'viewer@example.com')
    `

    for (const who of [owner, admin, editor, viewer]) {
      const members = (await repository.listMembers(groupId, who))?.members
      expect(members?.map((member) => member.userId)).toEqual([
        owner,
        admin,
        editor,
        viewer,
        onlyHere,
      ])
      expect(members?.filter((member) => member.isYou).map((member) => member.userId)).toEqual([
        who,
      ])
    }
    const read = (await repository.listMembers(groupId, owner))!
    // The count is read apart from the list, so a list cut off at its cap still has it.
    expect(read.memberCount).toBe(5)
    const members = read.members
    expect(members[0]).toMatchObject({ name: "Ann Owner", role: GroupRole.OWNER, email: null })
    expect(members[3]).toMatchObject({
      name: "",
      role: GroupRole.VIEWER,
      email: "viewer@example.com",
    })
    expect(members[3].joinedAt).toBeInstanceOf(Date)
    expect(await repository.listMembers(groupId, stranger)).toBeNull()
  })
})

const SEES_ADDRESSES: Record<"owner" | "admin" | "editor" | "viewer", boolean> = {
  owner: true,
  admin: true,
  editor: false,
  viewer: false,
}

for (const [reader, sees] of Object.entries(SEES_ADDRESSES)) {
  Deno.test(
    `members: ${
      sees ? `the ${reader} gets every member's address` : `the ${reader} gets no address field`
    }`,
    async () => {
      await withSchema(async (sql) => {
        const people = await team(sql)
        const { repository, groupId, editor } = people
        await sql`
          INSERT INTO auth_keys (user_id, method, subject, email)
          VALUES (${editor}, 'email', ${`editor-${editor}`}, 'editor@example.com')
        `

        const { members } =
          (await repository.listMembers(groupId, people[reader as keyof typeof SEES_ADDRESSES]))!
        const addresses = members.map((member) => ("email" in member ? member.email : "absent"))
        expect(addresses).toEqual(
          sees ? [null, null, "editor@example.com", null, null] : Array(5).fill("absent"),
        )
      })
    },
  )
}

for (const [reader, sees] of Object.entries(SEES_ADDRESSES)) {
  Deno.test(
    `members: ${
      sees
        ? `the ${reader} gets when every member was last seen`
        : `the ${reader} gets no last-seen field`
    }`,
    async () => {
      await withSchema(async (sql) => {
        const people = await team(sql)
        const { repository, groupId, editor } = people
        await sql`UPDATE users SET last_seen_at = '2026-10-04T08:00:00Z' WHERE id = ${editor}`

        const { members } =
          (await repository.listMembers(groupId, people[reader as keyof typeof SEES_ADDRESSES]))!
        const seen = members.map((member) =>
          "lastSeenAt" in member ? member.lastSeenAt?.toISOString() ?? null : "absent"
        )
        expect(seen).toEqual(
          sees ? [null, null, "2026-10-04T08:00:00.000Z", null, null] : Array(5).fill("absent"),
        )
      })
    },
  )
}

Deno.test("members: the group list carries a count and the first five names", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, viewer } = await team(sql)
    await sql`UPDATE users SET first_name = 'Ann' WHERE id = ${owner}`
    await sql`UPDATE users SET deleted_at = now() WHERE id = ${viewer}`

    const listed = await repository.listForUser(owner, { limit: 10 })
    const teamGroup = listed.groups.find((group) => group.id === groupId)!
    expect(teamGroup.memberCount).toBe(4)
    expect(teamGroup.members?.map((member) => member.name)).toEqual(["Ann", "", "", ""])
    const home = listed.groups.find((group) => group.id !== groupId)!
    expect(home.memberCount).toBe(1)
    expect(home.members).toEqual([{ name: "Ann" }])
  })
})

Deno.test("role change: the owner and an admin change roles below their own, nobody else", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, onlyHere, stranger } = await team(
      sql,
    )

    for (const who of [viewer, editor]) {
      expect(await refusal(repository.changeMemberRole(groupId, onlyHere, GroupRole.VIEWER, who)))
        .toBe("ROLE_INSUFFICIENT")
    }
    expect(
      await refusal(repository.changeMemberRole(groupId, onlyHere, GroupRole.VIEWER, stranger)),
    )
      .toBe("GROUP_NOT_FOUND")
    expect(await refusal(repository.changeMemberRole(groupId, owner, GroupRole.VIEWER, admin)))
      .toBe("LAST_OWNER")
    expect(await refusal(repository.changeMemberRole(groupId, editor, GroupRole.OWNER, owner)))
      .toBe("LAST_OWNER")
    expect(await refusal(repository.changeMemberRole(groupId, editor, GroupRole.ADMIN, admin)))
      .toBe("ROLE_INSUFFICIENT")
    expect(await refusal(repository.changeMemberRole(groupId, stranger, GroupRole.VIEWER, owner)))
      .toBe("MEMBER_NOT_FOUND")
    expect(await memberRole(sql, groupId, onlyHere)).toBe(GroupRole.EDITOR)

    const byAdmin = await repository.changeMemberRole(groupId, onlyHere, GroupRole.VIEWER, admin)
    expect(byAdmin).toMatchObject({ userId: onlyHere, role: GroupRole.VIEWER, isYou: false })
    const byOwner = await repository.changeMemberRole(groupId, admin, GroupRole.EDITOR, owner)
    expect(byOwner?.role).toBe(GroupRole.EDITOR)
    expect(await memberRole(sql, groupId, admin)).toBe(GroupRole.EDITOR)
  })
})

Deno.test("role change: writes an audit row and raises the revision, a refusal neither", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, viewer, editor } = await team(sql)
    const before = await revision(sql, groupId)
    const auditBefore = await auditKinds(sql, groupId)

    await refusal(repository.changeMemberRole(groupId, editor, GroupRole.VIEWER, viewer))
    expect(await revision(sql, groupId)).toBe(before)
    expect(await auditKinds(sql, groupId)).toEqual(auditBefore)

    await repository.changeMemberRole(groupId, editor, GroupRole.VIEWER, owner, "request-1")
    expect(BigInt(await revision(sql, groupId))).toBe(BigInt(before) + 1n)
    expect(await auditKinds(sql, groupId)).toEqual([
      ...auditBefore,
      "group.member_role_changed",
    ])
    const row = (await sql<{ actorUserId: number; requestId: string }[]>`
      SELECT actor_user_id, request_id FROM audit_events
      WHERE group_id = ${groupId} ORDER BY id DESC LIMIT 1
    `)[0]
    expect(row).toEqual({ actorUserId: owner, requestId: "request-1" })

    // The same role again changes nothing and records nothing.
    await repository.changeMemberRole(groupId, editor, GroupRole.VIEWER, owner)
    expect(BigInt(await revision(sql, groupId))).toBe(BigInt(before) + 1n)
    expect((await auditKinds(sql, groupId)).length).toBe(auditBefore.length + 1)
  })
})

Deno.test("remove: the owner and an admin remove members below them, nobody else", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, stranger } = await team(sql)

    for (const who of [viewer, editor]) {
      expect(await refusal(repository.removeMember(groupId, viewer, who)))
        .toBe("ROLE_INSUFFICIENT")
    }
    expect(await refusal(repository.removeMember(groupId, viewer, stranger)))
      .toBe("GROUP_NOT_FOUND")
    expect(await refusal(repository.removeMember(groupId, owner, admin))).toBe("LAST_OWNER")
    expect(await refusal(repository.removeMember(groupId, admin, admin)))
      .toBe("ROLE_INSUFFICIENT")
    expect(await refusal(repository.removeMember(groupId, stranger, owner)))
      .toBe("MEMBER_NOT_FOUND")
    expect(await memberRole(sql, groupId, viewer)).toBe(GroupRole.VIEWER)

    expect(await repository.removeMember(groupId, viewer, admin)).toBe(true)
    expect(await memberRole(sql, groupId, viewer)).toBeNull()
    expect(await repository.removeMember(groupId, admin, owner)).toBe(true)
    expect(await repository.getForMember(groupId, admin)).toBeNull()
  })
})

Deno.test("remove: a member whose only group it was gets a new one", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, onlyHere, viewer } = await team(sql)

    await repository.removeMember(groupId, onlyHere, owner)
    expect(await groupNames(sql, onlyHere)).toEqual(["Personal"])
    expectVersion7Ids(
      await sql<{ id: string }[]>`
        SELECT group_id AS id FROM group_members WHERE user_id = ${onlyHere}
      `,
    )
    await repository.removeMember(groupId, viewer, owner)
    expect(await groupNames(sql, viewer)).toEqual(["Own"])
  })
})

Deno.test("remove: audit row, raised revision and a loss heard after the commit", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, viewer, editor } = await team(sql)
    const before = await revision(sql, groupId)
    const auditBefore = await auditKinds(sql, groupId)
    const losses = await listenForMembershipLoss(sql, groupId)
    try {
      await refusal(repository.removeMember(groupId, viewer, editor))
      expect(await revision(sql, groupId)).toBe(before)
      expect(await auditKinds(sql, groupId)).toEqual(auditBefore)

      await repository.removeMember(groupId, viewer, owner)
      expect(BigInt(await revision(sql, groupId))).toBe(BigInt(before) + 1n)
      expect(await auditKinds(sql, groupId)).toEqual([...auditBefore, "group.member_removed"])
      expect(await losses.wait(1)).toEqual([{ userIds: [viewer], stillMember: false }])
    } finally {
      await losses.stop()
    }
  })
})

Deno.test("leave: a member leaves, the owner and a person with no other group cannot", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor, viewer, onlyHere, stranger } = await team(sql)
    const before = await revision(sql, groupId)
    const auditBefore = await auditKinds(sql, groupId)
    const losses = await listenForMembershipLoss(sql, groupId)
    try {
      expect(await refusal(repository.leave(groupId, owner))).toBe("LAST_OWNER")
      expect(await refusal(repository.leave(groupId, onlyHere))).toBe("LAST_GROUP")
      expect(await refusal(repository.leave(groupId, stranger))).toBe("GROUP_NOT_FOUND")
      expect(await revision(sql, groupId)).toBe(before)
      expect(await auditKinds(sql, groupId)).toEqual(auditBefore)

      expect(await repository.leave(groupId, viewer)).toBe(true)
      expect(await repository.leave(groupId, editor)).toBe(true)
      expect(await memberRole(sql, groupId, viewer)).toBeNull()
      expect(await groupNames(sql, viewer)).toEqual(["Own"])
      expect(BigInt(await revision(sql, groupId))).toBe(BigInt(before) + 2n)
      expect(await auditKinds(sql, groupId)).toEqual([
        ...auditBefore,
        "group.member_left",
        "group.member_left",
      ])
      // Each loss is stored once its read returns, so two can be stored in either order.
      const heard = (await losses.wait(2)).toSorted((a, b) => a.userIds[0] - b.userIds[0])
      expect(heard).toEqual(
        [viewer, editor].toSorted((a, b) => a - b).map((userId) => ({
          userIds: [userId],
          stillMember: false,
        })),
      )
    } finally {
      await losses.stop()
    }
  })
})

Deno.test("members: a deleted group refuses every member change", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, viewer } = await team(sql)
    await repository.softDelete(groupId, owner)

    expect(await repository.listMembers(groupId, owner)).toBeNull()
    expect(await repository.changeMemberRole(groupId, viewer, GroupRole.EDITOR, owner)).toBeNull()
    expect(await repository.removeMember(groupId, viewer, admin)).toBe(false)
    expect(await repository.leave(groupId, viewer)).toBe(false)
  })
})
