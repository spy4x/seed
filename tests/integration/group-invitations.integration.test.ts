/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { sha256Hex } from "@spy4x/platform/tokens"
import { PlanError } from "@domain/billing"
import { GroupError, GroupRole, InvitationError } from "@domain/groups"
import {
  type InvitationCreateRecord,
  invitationLookup,
  type InvitationPlan,
  newInvitationToken,
  PostgresInvitationRepository,
} from "@server/groups/postgres-invitation-repository.ts"
import { purgeDeadInvitations } from "@server/groups/purge-dead-invitations.ts"
import { insertUser, team, withSchema } from "./group-team.ts"

/**
 * Group invitations against a real Postgres built from schema.sql: what a create stores, who may
 * invite with which role, accepting, and every reason an invitation is refused. Needs "DB_HOST",
 * "DB_USER", "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when they are missing.
 */

/** A plan with no member cap that allows every role: billing off. */
const NO_LIMITS: InvitationPlan = { maxMembers: null, memberRoles: true }

/** A plan with room for `maxMembers` that allows every role. */
function capped(maxMembers: number): InvitationPlan {
  return { maxMembers, memberRoles: true }
}

async function refusal(write: Promise<unknown>): Promise<string> {
  try {
    await write
  } catch (error) {
    if (
      error instanceof InvitationError || error instanceof GroupError || error instanceof PlanError
    ) {
      return error.code
    }
    throw error
  }
  throw new Error("The write was not refused")
}

/** Creates an invitation the way the API does, and answers it with its token. */
async function invite(
  invitations: PostgresInvitationRepository,
  groupId: string,
  actorId: number,
  options: Partial<InvitationCreateRecord> & { plan?: InvitationPlan } = {},
) {
  const token = newInvitationToken()
  const { plan = NO_LIMITS, ...record } = options
  const created = await invitations.create(
    {
      groupId,
      role: GroupRole.EDITOR,
      expiresInDays: 7,
      maxUses: 1,
      email: null,
      tokenHash: await sha256Hex(token),
      ...record,
    },
    actorId,
    plan,
  )
  if (!created) throw new Error("The invitation was not created")
  return { ...created, token, lookup: await invitationLookup({ token }) }
}

async function memberRole(sql: postgres.Sql, groupId: string, userId: number) {
  return (await sql<{ role: number }[]>`
    SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}
  `)[0]?.role ?? null
}

async function auditKinds(sql: postgres.Sql, groupId: string): Promise<string[]> {
  const rows = await sql<{ eventKind: string }[]>`
    SELECT event_kind FROM audit_events
    WHERE group_id = ${groupId} AND event_kind LIKE 'group.invitation%'
    ORDER BY id
  `
  return rows.map((row) => row.eventKind)
}

async function proveAddress(sql: postgres.Sql, userId: number, email: string) {
  await sql`INSERT INTO auth_email_owners (email, user_id) VALUES (${email}, ${userId})`
}

Deno.test("invitations: the database stores the token's hash, never the token", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const { invitation, token } = await invite(invitations, groupId, owner)
    const [row] = await sql<Record<string, unknown>[]>`
      SELECT * FROM group_invitations WHERE id = ${invitation.id}
    `
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(row.tokenHash).toBe(await sha256Hex(token))
    for (const value of Object.values(row)) {
      expect(String(value)).not.toContain(token)
    }
  })
})

Deno.test("invitations: another user accepts a link with its role, and the group becomes selected", async () => {
  await withSchema(async (sql) => {
    const { groupId, admin, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const { lookup } = await invite(invitations, groupId, admin, { role: GroupRole.VIEWER })

    const result = await invitations.accept(lookup, stranger, NO_LIMITS, "request-1")

    expect(result.groupId).toBe(groupId)
    expect(result.role).toBe(GroupRole.VIEWER)
    expect(result.selected.groupId).toBe(groupId)
    expect(await memberRole(sql, groupId, stranger)).toBe(GroupRole.VIEWER)
    const [settings] = await sql<{ selectedGroupId: string }[]>`
      SELECT selected_group_id FROM user_settings WHERE user_id = ${stranger}
    `
    expect(settings.selectedGroupId).toBe(groupId)
    expect(await auditKinds(sql, groupId)).toEqual([
      "group.invitation_created",
      "group.invitation_accepted",
    ])
  })
})

Deno.test("invitations: an admin invites viewers and editors only; the owner invites admins", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin, editor } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)

    expect(await refusal(invite(invitations, groupId, admin, { role: GroupRole.ADMIN })))
      .toBe("ROLE_INSUFFICIENT")
    expect(await refusal(invite(invitations, groupId, editor, { role: GroupRole.VIEWER })))
      .toBe("ROLE_INSUFFICIENT")
    await invite(invitations, groupId, admin, { role: GroupRole.EDITOR })
    await invite(invitations, groupId, owner, { role: GroupRole.ADMIN })
    expect(await auditKinds(sql, groupId)).toEqual([
      "group.invitation_created",
      "group.invitation_created",
    ])
  })
})

Deno.test("invitations: an expired, revoked or used-up invitation is refused", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin, editor, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const late = await insertUser(sql)

    const expired = await invite(invitations, groupId, owner)
    await sql`
      UPDATE group_invitations SET expires_at = now() - interval '1 second'
      WHERE id = ${expired.invitation.id}
    `
    expect(await refusal(invitations.accept(expired.lookup, stranger, NO_LIMITS)))
      .toBe("INVITATION_EXPIRED")

    const revoked = await invite(invitations, groupId, owner)
    expect(await invitations.revoke(groupId, revoked.invitation.id, admin)).toBe(true)
    expect(await refusal(invitations.accept(revoked.lookup, stranger, NO_LIMITS)))
      .toBe("INVITATION_REVOKED")

    const once = await invite(invitations, groupId, owner, { maxUses: 1 })
    await invitations.accept(once.lookup, stranger, NO_LIMITS)
    expect(await refusal(invitations.accept(once.lookup, late, NO_LIMITS))).toBe(
      "INVITATION_USED_UP",
    )

    expect(await refusal(invitations.accept({ tokenHash: "0".repeat(64) }, late, NO_LIMITS)))
      .toBe("INVITATION_NOT_FOUND")
    expect(await memberRole(sql, groupId, late)).toBe(null)
    // An editor may not revoke.
    expect(await refusal(invitations.revoke(groupId, once.invitation.id, editor)))
      .toBe("ROLE_INSUFFICIENT")
  })
})

Deno.test("invitations: the pending list drops revoked, expired and used-up invitations", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin, viewer, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const pending = await invite(invitations, groupId, owner, { maxUses: 2 })
    const used = await invite(invitations, groupId, owner)
    const revoked = await invite(invitations, groupId, owner)
    const expired = await invite(invitations, groupId, owner)
    await invitations.accept(used.lookup, stranger, NO_LIMITS)
    await invitations.revoke(groupId, revoked.invitation.id, owner)
    await sql`
      UPDATE group_invitations SET expires_at = now() - interval '1 second'
      WHERE id = ${expired.invitation.id}
    `

    const list = await invitations.listPending(groupId, admin)

    expect(list?.map((invitation) => invitation.id)).toEqual([pending.invitation.id])
    expect(await refusal(invitations.listPending(groupId, viewer))).toBe("ROLE_INSUFFICIENT")
    expect(await invitations.listPending(groupId, await insertUser(sql))).toBe(null)
  })
})

Deno.test("invitations: a full group refuses a create and an accept, and pending ones take no seat", async () => {
  await withSchema(async (sql) => {
    // The team has five members: the owner, an admin, an editor, a viewer and "onlyHere".
    const { groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const late = await insertUser(sql)

    expect(await refusal(invite(invitations, groupId, owner, { plan: capped(5) })))
      .toBe("PLAN_LIMIT_REACHED")
    const first = await invite(invitations, groupId, owner, { plan: capped(6) })
    const second = await invite(invitations, groupId, owner, { plan: capped(6) })

    await invitations.accept(first.lookup, stranger, capped(6))
    expect(await refusal(invitations.accept(second.lookup, late, capped(6)))).toBe(
      "PLAN_LIMIT_REACHED",
    )
    expect(await memberRole(sql, groupId, late)).toBe(null)
    expect(await invitations.accept(second.lookup, late, NO_LIMITS)).toMatchObject({ groupId })
  })
})

Deno.test("invitations: one tied to an address is for the account that proved it alone", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const invited = await insertUser(sql)
    await proveAddress(sql, invited, "invited@example.com")
    const { invitation, lookup } = await invite(invitations, groupId, owner, {
      email: "invited@example.com",
    })

    expect(await refusal(invitations.accept(lookup, stranger, NO_LIMITS)))
      .toBe("INVITATION_WRONG_ACCOUNT")
    expect((await invitations.preview(lookup, stranger)).forYou).toBe(false)
    expect(await invitations.listForUser(stranger)).toEqual([])
    const mine = await invitations.listForUser(invited)
    expect(mine.map((preview) => [preview.id, preview.forYou])).toEqual([[invitation.id, true]])

    await invitations.accept({ invitationId: invitation.id }, invited, NO_LIMITS)
    expect(await memberRole(sql, groupId, invited)).toBe(GroupRole.EDITOR)
  })
})

Deno.test("invitations: knowing a link invitation's id lets nobody in", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const { invitation } = await invite(invitations, groupId, owner)

    expect(await refusal(invitations.accept({ invitationId: invitation.id }, stranger, NO_LIMITS)))
      .toBe("INVITATION_NOT_FOUND")
    expect(await memberRole(sql, groupId, stranger)).toBe(null)
  })
})

Deno.test("invitations: declining one tied to an address stops it; a member cannot join twice", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, editor } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const invited = await insertUser(sql)
    await proveAddress(sql, invited, "invited@example.com")
    const addressed = await invite(invitations, groupId, owner, { email: "invited@example.com" })

    await invitations.decline(addressed.lookup, invited)
    expect(await refusal(invitations.accept(addressed.lookup, invited, NO_LIMITS)))
      .toBe("INVITATION_REVOKED")
    expect(await invitations.listForUser(invited)).toEqual([])

    const link = await invite(invitations, groupId, owner)
    expect(await refusal(invitations.accept(link.lookup, editor, NO_LIMITS))).toBe("ALREADY_MEMBER")
    expect(await auditKinds(sql, groupId)).toEqual([
      "group.invitation_created",
      "group.invitation_declined",
      "group.invitation_created",
    ])
  })
})

Deno.test("invitations: a removed admin cannot rejoin through a link they made", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const own = await invite(invitations, groupId, admin, { maxUses: 5 })
    const owners = await invite(invitations, groupId, owner, { maxUses: 5 })

    await repository.removeMember(groupId, admin, owner, "request-remove")

    expect(await refusal(invitations.accept(own.lookup, admin, NO_LIMITS)))
      .toBe("INVITATION_REVOKED")
    expect(await memberRole(sql, groupId, admin)).toBe(null)
    // Only the removed member's links stop: the owner's still works.
    expect((await invitations.listPending(groupId, owner))!.map((row) => row.id))
      .toEqual([owners.invitation.id])
    expect(await auditKinds(sql, groupId)).toEqual([
      "group.invitation_created",
      "group.invitation_created",
      "group.invitation_revoked",
    ])
  })
})

Deno.test("invitations: a demoted admin's links stop at once, and they cannot come back as an editor", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const editorLink = await invite(invitations, groupId, admin, { maxUses: 5 })

    await repository.changeMemberRole(groupId, admin, GroupRole.VIEWER, owner)

    expect(await refusal(invitations.accept(editorLink.lookup, stranger, NO_LIMITS)))
      .toBe("INVITATION_REVOKED")
    await repository.leave(groupId, admin)
    expect(await refusal(invitations.accept(editorLink.lookup, admin, NO_LIMITS)))
      .toBe("INVITATION_REVOKED")
    expect(await memberRole(sql, groupId, admin)).toBe(null)
  })
})

Deno.test("invitations: a member who leaves stops the links they made", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, admin, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const { lookup } = await invite(invitations, groupId, admin, { maxUses: 5 })

    await repository.leave(groupId, admin)

    expect(await refusal(invitations.accept(lookup, stranger, NO_LIMITS)))
      .toBe("INVITATION_REVOKED")
  })
})

Deno.test("invitations: a removed member cannot rejoin through the invitation link they joined with", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const late = await insertUser(sql)
    const { lookup } = await invite(invitations, groupId, owner, { maxUses: 5 })

    await invitations.accept(lookup, stranger, NO_LIMITS)
    await repository.removeMember(groupId, stranger, owner)

    expect(await refusal(invitations.accept(lookup, stranger, NO_LIMITS)))
      .toBe("INVITATION_ALREADY_USED")
    expect(await memberRole(sql, groupId, stranger)).toBe(null)
    // Anyone else still joins through it.
    expect(await invitations.accept(lookup, late, NO_LIMITS)).toMatchObject({ groupId })
  })
})

Deno.test("invitations: a plan without member roles lets an invitation add viewers only", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const late = await insertUser(sql)
    const free: InvitationPlan = { maxMembers: null, memberRoles: false }

    expect(
      await refusal(invite(invitations, groupId, owner, { role: GroupRole.EDITOR, plan: free })),
    )
      .toBe("PLAN_FEATURE_MISSING")
    expect(
      await refusal(invite(invitations, groupId, owner, { role: GroupRole.ADMIN, plan: free })),
    )
      .toBe("PLAN_FEATURE_MISSING")
    const viewerLink = await invite(invitations, groupId, owner, {
      role: GroupRole.VIEWER,
      plan: free,
    })
    // Made on a paid plan, accepted after the group went back to free.
    const editorLink = await invite(invitations, groupId, owner, { role: GroupRole.EDITOR })

    expect(await refusal(invitations.accept(editorLink.lookup, stranger, free)))
      .toBe("PLAN_FEATURE_MISSING")
    expect(await memberRole(sql, groupId, stranger)).toBe(null)
    await invitations.accept(viewerLink.lookup, late, free)
    expect(await memberRole(sql, groupId, late)).toBe(GroupRole.VIEWER)
  })
})

Deno.test("invitations: two accepts at once for the last free seat let exactly one in", async () => {
  await withSchema(async (sql) => {
    // Five members and room for six. Each joiner uses their own link, so only the group's lock
    // can make the second accept wait and count the first one's member.
    const { groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const late = await insertUser(sql)
    const first = await invite(invitations, groupId, owner)
    const second = await invite(invitations, groupId, owner)
    // Each membership insert waits, so the two accepts overlap however fast the machine is.
    await sql.unsafe(`
      CREATE FUNCTION slow_member_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$;
      CREATE TRIGGER slow_member_insert BEFORE INSERT ON group_members
        FOR EACH ROW EXECUTE FUNCTION slow_member_insert();
    `)

    const results = await Promise.allSettled([
      invitations.accept(first.lookup, stranger, capped(6)),
      invitations.accept(second.lookup, late, capped(6)),
    ])

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"])
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult
    expect(failed.reason).toBeInstanceOf(PlanError)
    expect(failed.reason.code).toBe("PLAN_LIMIT_REACHED")
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM group_members WHERE group_id = ${groupId}
    `
    expect(count).toBe(6)
  })
})

Deno.test("invitations: the sweep deletes ones dead over 30 days and keeps the rest and the audit", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, stranger } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const ids = async () =>
      (await sql<{ id: string }[]>`SELECT id FROM group_invitations`)
        .map((row) => row.id).sort()
    const age = async (id: string, column: string, days: number) => {
      await sql`
        UPDATE group_invitations SET ${sql(column)} = now() - make_interval(days => ${days})
        WHERE id = ${id}
      `
    }

    const live = await invite(invitations, groupId, owner)
    const expiredOld = await invite(invitations, groupId, owner)
    const expiredRecent = await invite(invitations, groupId, owner)
    const revokedOld = await invite(invitations, groupId, owner)
    const revokedRecent = await invite(invitations, groupId, owner)
    const declinedOld = await invite(invitations, groupId, owner)
    const usedOld = await invite(invitations, groupId, owner)
    const usedRecent = await invite(invitations, groupId, owner)
    await age(expiredOld.invitation.id, "expires_at", 31)
    await age(expiredRecent.invitation.id, "expires_at", 29)
    await invitations.revoke(groupId, revokedOld.invitation.id, owner)
    await age(revokedOld.invitation.id, "revoked_at", 31)
    await invitations.revoke(groupId, revokedRecent.invitation.id, owner)
    await age(revokedRecent.invitation.id, "revoked_at", 29)
    await age(declinedOld.invitation.id, "declined_at", 31)
    await invitations.accept(usedOld.lookup, stranger, NO_LIMITS)
    await sql`
      UPDATE group_invitation_acceptances SET accepted_at = now() - interval '31 days'
      WHERE invitation_id = ${usedOld.invitation.id}
    `
    await invitations.accept(usedRecent.lookup, await insertUser(sql), NO_LIMITS)
    const auditBefore = (await auditKinds(sql, groupId)).length

    expect(await purgeDeadInvitations(sql)).toBe(4)

    expect(await ids()).toEqual([
      live.invitation.id,
      expiredRecent.invitation.id,
      revokedRecent.invitation.id,
      usedRecent.invitation.id,
    ].sort())
    expect((await auditKinds(sql, groupId)).length).toBe(auditBefore)
    expect(await purgeDeadInvitations(sql)).toBe(0)
  })
})

Deno.test("invitations: the sweep keeps a partly used link and dates a used-up one by its last use", async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    const invitations = new PostgresInvitationRepository(sql)
    const setAge = async (id: string, column: string, days: number) => {
      await sql`
        UPDATE group_invitations SET ${sql(column)} = now() - make_interval(days => ${days})
        WHERE id = ${id}
      `
    }
    const ageAcceptances = async (id: string, days: number[]) => {
      const rows = await sql<{ userId: number }[]>`
        SELECT user_id FROM group_invitation_acceptances WHERE invitation_id = ${id}
        ORDER BY user_id
      `
      for (const [index, row] of rows.entries()) {
        await sql`
          UPDATE group_invitation_acceptances SET accepted_at = now() - make_interval(days => ${
          days[index]
        })
          WHERE invitation_id = ${id} AND user_id = ${row.userId}
        `
      }
    }

    // Three of ten uses, all long ago, created long ago, not expired: still open, so kept.
    const partly = await invite(invitations, groupId, owner, { maxUses: 10, expiresInDays: 90 })
    for (let uses = 0; uses < 3; uses++) {
      await invitations.accept(partly.lookup, await insertUser(sql), NO_LIMITS)
    }
    await setAge(partly.invitation.id, "created_at", 60)
    await ageAcceptances(partly.invitation.id, [50, 45, 40])

    // Used up by two people, the first 40 days ago and the last 5 days ago: dead for 5 days.
    const lastUseRecent = await invite(invitations, groupId, owner, { maxUses: 2 })
    for (let uses = 0; uses < 2; uses++) {
      await invitations.accept(lastUseRecent.lookup, await insertUser(sql), NO_LIMITS)
    }
    await ageAcceptances(lastUseRecent.invitation.id, [40, 5])

    // Used up, then every acceptor deleted their account: dated by creation instead.
    const orphaned = async (createdDaysAgo: number) => {
      const used = await invite(invitations, groupId, owner)
      await invitations.accept(used.lookup, await insertUser(sql), NO_LIMITS)
      await sql`DELETE FROM group_invitation_acceptances WHERE invitation_id = ${used.invitation.id}`
      await setAge(used.invitation.id, "created_at", createdDaysAgo)
      return used.invitation.id
    }
    await orphaned(31)
    const orphanedRecent = await orphaned(29)

    expect(await purgeDeadInvitations(sql)).toBe(1)

    expect((await sql<{ id: string }[]>`SELECT id FROM group_invitations`).map((r) => r.id).sort())
      .toEqual([partly.invitation.id, lastUseRecent.invitation.id, orphanedRecent].sort())
  })
})
