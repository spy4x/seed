/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { BillingStatus } from "@domain/billing"
import { ADMIN_GROUP_NO_FILTER, GroupRole } from "@domain/groups"
import { UserRole } from "@domain/identity"
import { apiTokenRows } from "@server/api-tokens/api-tokens.ts"
import {
  AdminGroupActOutcome,
  adminGroupRows,
  OPERATOR_DETAIL,
} from "@server/groups/admin-groups.ts"
import { insertUser, team, withSchema } from "./group-team.ts"

/**
 * The operator area's groups module (#426) against a real Postgres built from schema.sql: the
 * list's search, sort and paging, a group's page that carries counts and never content, and the
 * three operator actions with their audit rows and refusals.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

/** Text that must never leave the API: every string written inside the group carries it. */
const SECRET = `TOP-SECRET`

async function operatorUser(sql: postgres.Sql, role: UserRole): Promise<number> {
  const id = await insertUser(sql)
  await sql`UPDATE users SET role = ${role} WHERE id = ${id}`
  return id
}

async function name(sql: postgres.Sql, userId: number, first: string, email: string) {
  await sql`UPDATE users SET first_name = ${first} WHERE id = ${userId}`
  await sql`
    INSERT INTO auth_keys (user_id, method, subject, email)
    VALUES (${userId}, 'email', ${email}, ${email})
  `
}

/** A token hash unique to the invitation `id`: 64 hex characters, as the column requires. */
function tokenHashOf(id: string): string {
  return `${id}${id}`.replaceAll(`-`, ``)
}

async function insertInvitation(
  sql: postgres.Sql,
  groupId: string,
  creatorId: number,
  facts: { role?: GroupRole; revoked?: boolean; expired?: boolean } = {},
): Promise<string> {
  const id = uuidV7()
  await sql`
    INSERT INTO group_invitations (
      id, group_id, token_hash, role, created_by_user_id, expires_at, revoked_at
    ) VALUES (
      ${id}, ${groupId}, ${tokenHashOf(id)}, ${facts.role ?? GroupRole.VIEWER}, ${creatorId},
      ${facts.expired ? sql`now() - interval '1 day'` : sql`now() + interval '7 days'`},
      ${facts.revoked ? sql`now()` : null}
    )
  `
  return id
}

async function auditRows(sql: postgres.Sql, groupId: string, kind: string) {
  return await sql<
    {
      actorUserId: number
      targetUserId: number | null
      entityId: string | null
      details: Record<string, unknown>
    }[]
  >`
    SELECT actor_user_id, target_user_id, entity_id, details FROM audit_events
    WHERE group_id = ${groupId} AND event_kind = ${kind}
    ORDER BY id
  `
}

Deno.test(`the group list searches names and owners, sorts, pages and counts`, async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, editor } = await team(sql)
    await name(sql, owner, `Ada`, `countess@example.com`)
    await sql`
      INSERT INTO notes (id, group_id, title, body, change_sequence) VALUES
        (${uuidV7()}, ${groupId}, 'one', '', 1),
        (${uuidV7()}, ${groupId}, 'two', '', 2)
    `
    await sql`
      INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
        provider_event_at, provider_event_rank)
      VALUES (${groupId}, 'sub_1', 'pro', ${BillingStatus.Active}, now(), 1)
    `
    const rows = adminGroupRows(sql)

    const all = await rows.list(ADMIN_GROUP_NO_FILTER, 25)
    // The owner's Home and Team, and one group of each of the other four members.
    expect(all.total).toBe(6)

    // Each word matches the group name, the owner's name or one of the owner's addresses.
    const byName = await rows.list({ ...ADMIN_GROUP_NO_FILTER, query: `ADA team` }, 25)
    expect(byName.groups.map((group) => group.id)).toEqual([groupId])
    const byOwner = await rows.list(
      { ...ADMIN_GROUP_NO_FILTER, query: `COUNTESS@example team` },
      25,
    )
    expect(byOwner.groups.map((group) => group.id)).toEqual([groupId])
    const [found] = byOwner.groups
    expect(found.owner).toEqual({ id: owner, name: `Ada`, email: `countess@example.com` })
    expect(found.memberCount).toBe(5)
    expect(found.noteCount).toBe(2)
    expect(found.planId).toBe(`pro`)
    expect(found.lastActivityAt).not.toBe(null)

    // A pattern character matches itself, not anything.
    expect((await rows.list({ ...ADMIN_GROUP_NO_FILTER, query: `%` }, 25)).total).toBe(0)
    // A group's id finds that group.
    expect((await rows.list({ ...ADMIN_GROUP_NO_FILTER, query: groupId }, 25)).total).toBe(1)

    const bySize = await rows.list(
      { ...ADMIN_GROUP_NO_FILTER, sort: [{ key: `memberCount`, direction: `desc` }] },
      2,
    )
    expect(bySize.groups[0].id).toBe(groupId)
    expect(bySize.groups.length).toBe(2)
    const page3 = await rows.list(
      { ...ADMIN_GROUP_NO_FILTER, sort: [{ key: `memberCount`, direction: `desc` }], page: 3 },
      2,
    )
    const seen = new Set([...bySize.groups, ...page3.groups].map((group) => group.id))
    expect(seen.size).toBe(4)

    await sql`
      UPDATE groups SET deleted_at = now()
      WHERE owner_user_id = ${editor} AND id <> ${groupId}
    `
    expect((await rows.list({ ...ADMIN_GROUP_NO_FILTER, status: `deleted` }, 25)).total).toBe(1)
    expect((await rows.list({ ...ADMIN_GROUP_NO_FILTER, status: `active` }, 25)).total).toBe(5)
  })
})

Deno.test(`a group's page carries counts, members, invitations and activity but no content`, async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin } = await team(sql)
    await sql`UPDATE groups SET description = ${`${SECRET} description`} WHERE id = ${groupId}`
    const noteId = uuidV7()
    await sql`
      INSERT INTO notes (id, group_id, title, body, change_sequence) VALUES
        (${noteId}, ${groupId}, ${`${SECRET} title`}, ${`${SECRET} body`}, 1)
    `
    await sql`
      INSERT INTO notes (id, group_id, title, body, change_sequence, deleted_at) VALUES
        (${uuidV7()}, ${groupId}, 'gone', '', 2, now())
    `
    await sql`
      INSERT INTO tags (id, group_id, name, change_sequence) VALUES
        (${uuidV7()}, ${groupId}, ${`${SECRET} tag`}, 3)
    `
    await sql`
      INSERT INTO audit_events (event_kind, actor_user_id, group_id, entity_type, entity_id, details)
      VALUES
        ('note.created', ${admin}, ${groupId}, 'note', ${noteId}, ${
      sql.json({ title: `${SECRET} title` })
    }),
        ('note.moved_out', ${admin}, ${groupId}, NULL, NULL, ${
      sql.json({ count: 3, groupName: `${SECRET} group` })
    })
    `
    const pending = await insertInvitation(sql, groupId, owner, { role: GroupRole.EDITOR })
    await insertInvitation(sql, groupId, owner, { revoked: true })
    await insertInvitation(sql, groupId, owner, { expired: true })

    const detail = await adminGroupRows(sql).find(groupId)
    if (!detail) throw new Error(`The group's page is missing`)

    expect(JSON.stringify(detail)).not.toContain(SECRET)
    expect(JSON.stringify(detail)).not.toContain(tokenHashOf(pending))
    expect(JSON.stringify(detail)).not.toContain(noteId)
    expect(detail.counts).toEqual({
      notes: 1,
      deletedNotes: 1,
      tags: 1,
      pendingInvitations: 1,
      files: 0,
      fileBytes: 0,
    })
    expect(detail.members.map((member) => member.role)).toEqual([
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.EDITOR,
      GroupRole.EDITOR,
      GroupRole.VIEWER,
    ])
    expect(detail.invitations.map((invitation) => invitation.state).sort()).toEqual([
      `expired`,
      `pending`,
      `revoked`,
    ])
    expect(detail.invitations.find((invitation) => invitation.id === pending)?.role).toBe(
      GroupRole.EDITOR,
    )
    const moved = detail.activity.find((event) => event.kind === `note.moved_out`)
    expect(moved?.details).toEqual({ count: 3 })
    expect(moved?.actor.userId).toBe(admin)
    expect(await adminGroupRows(sql).find(uuidV7())).toBe(null)
  })
})

Deno.test(`an operator revokes a pending invitation, and the group's log names them`, async () => {
  await withSchema(async (sql) => {
    const { groupId, owner } = await team(sql)
    const operator = { id: await operatorUser(sql, UserRole.OPERATOR), role: UserRole.OPERATOR }
    const invitation = await insertInvitation(sql, groupId, owner, { role: GroupRole.EDITOR })
    const rows = adminGroupRows(sql)

    expect(await rows.revokeInvitation(operator, groupId, invitation)).toBe(
      AdminGroupActOutcome.Done,
    )
    const [revoked] = await sql<{ revokedAt: Date | null }[]>`
      SELECT revoked_at FROM group_invitations WHERE id = ${invitation}
    `
    expect(revoked.revokedAt).not.toBe(null)
    expect(await auditRows(sql, groupId, `group.invitation_revoked`)).toEqual([{
      actorUserId: operator.id,
      targetUserId: null,
      entityId: invitation,
      details: { role: GroupRole.EDITOR, [OPERATOR_DETAIL]: 1 },
    }])
    const event = (await rows.find(groupId))!.activity[0]
    expect(event.byOperator).toBe(true)
    expect(event.details).toEqual({ role: GroupRole.EDITOR })

    // A second revoke changes nothing and writes no second row.
    expect(await rows.revokeInvitation(operator, groupId, invitation)).toBe(
      AdminGroupActOutcome.Unchanged,
    )
    expect((await auditRows(sql, groupId, `group.invitation_revoked`)).length).toBe(1)
    // Another group's invitation is not found through this one.
    const { groupId: other, owner: otherOwner } = await team(sql)
    const elsewhere = await insertInvitation(sql, other, otherOwner)
    expect(await rows.revokeInvitation(operator, groupId, elsewhere)).toBe(
      AdminGroupActOutcome.NotFound,
    )
  })
})

Deno.test(`an operator removes a member, who loses tokens and invitations, with an audit row`, async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, admin, editor, onlyHere } = await team(sql)
    const operator = { id: await operatorUser(sql, UserRole.OPERATOR), role: UserRole.OPERATOR }
    const hash = `b`.repeat(64)
    await sql`INSERT INTO api_tokens (id, user_id, group_id, name, token_hash, access)
      VALUES (${uuidV7()}, ${admin}, ${groupId}, 'script', ${hash}, 1)`
    const link = await insertInvitation(sql, groupId, admin)
    const rows = adminGroupRows(sql)

    expect(await rows.removeMember(operator, groupId, admin)).toBe(AdminGroupActOutcome.Done)
    const [member] = await sql`
      SELECT 1 FROM group_members WHERE group_id = ${groupId} AND user_id = ${admin}
    `
    expect(member).toBe(undefined)
    expect(await apiTokenRows(sql).find(hash)).toMatchObject({ refused: `revoked` })
    const [invitation] = await sql<{ revokedAt: Date | null }[]>`
      SELECT revoked_at FROM group_invitations WHERE id = ${link}
    `
    expect(invitation.revokedAt).not.toBe(null)
    // The revocation the removal causes is marked as the operator's too.
    expect(await auditRows(sql, groupId, `group.invitation_revoked`)).toEqual([{
      actorUserId: operator.id,
      targetUserId: null,
      entityId: link,
      details: { [OPERATOR_DETAIL]: 1 },
    }])
    expect(await auditRows(sql, groupId, `group.member_removed`)).toEqual([{
      actorUserId: operator.id,
      targetUserId: admin,
      entityId: null,
      details: { role: GroupRole.ADMIN, [OPERATOR_DETAIL]: 1 },
    }])
    const [outbox] = await sql`
      SELECT 1 FROM outbox_events WHERE group_id = ${groupId} AND event_kind = 'group.member_removed'
    `
    expect(outbox).not.toBe(undefined)

    expect(await rows.removeMember(operator, groupId, owner)).toBe(AdminGroupActOutcome.IsOwner)
    expect(await rows.removeMember(operator, groupId, onlyHere)).toBe(
      AdminGroupActOutcome.LastGroup,
    )
    expect(await rows.removeMember(operator, groupId, admin)).toBe(AdminGroupActOutcome.NotFound)
    await sql`UPDATE users SET role = ${UserRole.OPERATOR} WHERE id = ${editor}`
    expect(await rows.removeMember(operator, groupId, editor)).toBe(
      AdminGroupActOutcome.Outranked,
    )
    expect(await rows.removeMember(operator, groupId, operator.id)).toBe(
      AdminGroupActOutcome.Self,
    )
    // Only the one removal wrote a row.
    expect((await auditRows(sql, groupId, `group.member_removed`)).length).toBe(1)
  })
})

Deno.test(`a supervisor transfers a group only to its own member; an operator, a renewing subscription and a blocked member cannot`, async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, editor, stranger } = await team(sql)
    const operator = { id: await operatorUser(sql, UserRole.OPERATOR), role: UserRole.OPERATOR }
    const supervisor = {
      id: await operatorUser(sql, UserRole.SUPERVISOR),
      role: UserRole.SUPERVISOR,
    }
    const rows = adminGroupRows(sql)

    expect(await rows.transferOwnership(operator, groupId, editor)).toBe(
      AdminGroupActOutcome.RoleTooLow,
    )
    await sql`
      INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
        provider_event_at, provider_event_rank)
      VALUES (${groupId}, 'sub_1', 'pro', ${BillingStatus.Active}, now(), 1)
    `
    expect(await rows.transferOwnership(supervisor, groupId, editor)).toBe(
      AdminGroupActOutcome.SubscriptionRenews,
    )
    await sql`UPDATE subscriptions SET cancel_at_period_end = TRUE WHERE group_id = ${groupId}`

    // A blocked member cannot sign in to run the group: the transfer waits for the unblock.
    await sql`UPDATE users SET blocked_at = now() WHERE id = ${editor}`
    expect(await rows.transferOwnership(supervisor, groupId, editor)).toBe(
      AdminGroupActOutcome.RecipientBlocked,
    )
    const [kept] = await sql<{ ownerUserId: number }[]>`
      SELECT owner_user_id FROM groups WHERE id = ${groupId}
    `
    expect(kept.ownerUserId).toBe(owner)
    await sql`UPDATE users SET blocked_at = NULL WHERE id = ${editor}`

    // The owner's admin link: an admin of the group may no longer hand out admin access.
    const adminLink = await insertInvitation(sql, groupId, owner, { role: GroupRole.ADMIN })
    expect(await rows.transferOwnership(supervisor, groupId, editor)).toBe(
      AdminGroupActOutcome.Done,
    )
    expect(await auditRows(sql, groupId, `group.invitation_revoked`)).toEqual([{
      actorUserId: supervisor.id,
      targetUserId: null,
      entityId: adminLink,
      details: { [OPERATOR_DETAIL]: 1 },
    }])
    const roles = await sql<{ userId: number; role: GroupRole }[]>`
      SELECT user_id, role FROM group_members
      WHERE group_id = ${groupId} AND user_id IN ${sql([owner, editor])}
    `
    expect(Object.fromEntries(roles.map((row) => [row.userId, row.role]))).toEqual({
      [owner]: GroupRole.ADMIN,
      [editor]: GroupRole.OWNER,
    })
    const [group] = await sql<{ ownerUserId: number }[]>`
      SELECT owner_user_id FROM groups WHERE id = ${groupId}
    `
    expect(group.ownerUserId).toBe(editor)
    expect(await auditRows(sql, groupId, `group.ownership_transferred`)).toEqual([{
      actorUserId: supervisor.id,
      targetUserId: editor,
      entityId: null,
      details: { previousOwnerId: owner, [OPERATOR_DETAIL]: 1 },
    }])

    // Already the owner: nothing to do.
    expect(await rows.transferOwnership(supervisor, groupId, editor)).toBe(
      AdminGroupActOutcome.Unchanged,
    )
    // A person outside the group cannot receive it, even one who is a member of another group.
    expect(await rows.transferOwnership(supervisor, groupId, stranger)).toBe(
      AdminGroupActOutcome.NotFound,
    )
    expect(await rows.transferOwnership(supervisor, groupId, await insertUser(sql))).toBe(
      AdminGroupActOutcome.NotFound,
    )
    const [still] = await sql<{ ownerUserId: number }[]>`
      SELECT owner_user_id FROM groups WHERE id = ${groupId}
    `
    expect(still.ownerUserId).toBe(editor)
    // An owner whose role is the supervisor's keeps their group.
    await sql`UPDATE users SET role = ${UserRole.SUPERVISOR} WHERE id = ${editor}`
    expect(await rows.transferOwnership(supervisor, groupId, owner)).toBe(
      AdminGroupActOutcome.Outranked,
    )
  })
})

Deno.test(`an operator sees a group's files without their names and removes one, from the trash too`, async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, editor } = await team(sql)
    const operator = { id: await operatorUser(sql, UserRole.OPERATOR), role: UserRole.OPERATOR }
    const live = uuidV7()
    const trashed = uuidV7()
    await sql`
      INSERT INTO notes (id, group_id, title, body, change_sequence, deleted_at) VALUES
        (${live}, ${groupId}, ${`${SECRET} title`}, '', 1, NULL),
        (${trashed}, ${groupId}, ${`${SECRET} old`}, '', 2, now())
    `
    const [first, second] = [uuidV7(), uuidV7()]
    await sql`
      INSERT INTO note_attachments (
        id, note_id, object_key, name, content_type, size_bytes, created_by_user_id, created_at
      ) VALUES
        (${first}, ${live}, ${`attachments/${first}`}, ${`${SECRET}.pdf`}, 'application/pdf', 700,
          ${editor}, now() - interval '1 hour'),
        (${second}, ${trashed}, ${`attachments/${second}`}, ${`${SECRET}.png`}, 'image/png', 300,
          ${owner}, now())
    `
    const rows = adminGroupRows(sql)

    const files = await rows.files(groupId)
    expect(JSON.stringify(files)).not.toContain(SECRET)
    expect(files?.files.map((file) => [file.id, file.noteDeleted, file.uploader?.id])).toEqual([
      [second, true, owner],
      [first, false, editor],
    ])
    expect([files?.total, files?.bytes]).toEqual([2, 1000])
    expect((await rows.find(groupId))?.counts).toMatchObject({ files: 2, fileBytes: 1000 })

    expect(await rows.removeFile(operator, groupId, second)).toBe(AdminGroupActOutcome.Done)
    expect(await rows.removeFile(operator, groupId, second)).toBe(AdminGroupActOutcome.NotFound)
    expect(await rows.removeFile(operator, uuidV7(), first)).toBe(AdminGroupActOutcome.NotFound)
    const [audit] = await sql<{ actorUserId: number; details: Record<string, unknown> }[]>`
      SELECT actor_user_id, details FROM audit_events
      WHERE group_id = ${groupId} AND event_kind = 'note.attachment.removed'
    `
    expect(audit.actorUserId).toBe(operator.id)
    expect(audit.details[OPERATOR_DETAIL]).toBe(1)
    const queued =
      await sql`SELECT 1 FROM file_deletions WHERE object_key = ${`attachments/${second}`}`
    expect(queued).toHaveLength(1)

    await sql`UPDATE groups SET deleted_at = now() WHERE id = ${groupId}`
    expect(await rows.removeFile(operator, groupId, first)).toBe(AdminGroupActOutcome.GroupDeleted)
    expect((await rows.files(groupId))?.total).toBe(1)
    expect(await rows.files(uuidV7())).toBe(null)
  })
})
