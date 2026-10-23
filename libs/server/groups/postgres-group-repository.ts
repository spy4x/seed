import type postgres from "postgres"
import {
  assertCanChangeRole,
  assertCanLeave,
  assertCanRemoveMember,
  assertCanTransfer,
  canRename,
  canSeeMemberEmails,
  canSeeMemberLastSeen,
  CreatedGroup,
  CreateGroupInput,
  DeletedGroupSummary,
  FirstGroupInput,
  Group,
  GROUP_FILE_EVENTS,
  GROUP_MEMBER_PREVIEW_LIMIT,
  GROUP_RESTORE_DAYS,
  GroupAccess,
  GroupColor,
  GroupDetails,
  GroupError,
  GroupListPage,
  GroupListResult,
  GroupMembersResult,
  GroupMemberSummary,
  GroupRepository,
  GroupRole,
  GroupSummary,
  SelectedGroup,
} from "@domain/groups"
import { BillingStatus } from "@domain/billing"
import { handOverBilling } from "@server/billing/handover.ts"
import { apiTokenRows } from "@server/api-tokens/api-tokens.ts"
import {
  GroupNotActiveError,
  lockActorRole,
  recordAccessChange,
  recordGroupChange,
} from "./group-change-log.ts"
import { type AuditEventInput, writeAuditEvent } from "./audit.ts"
import { notifyOwnershipReceived, notifyRemoved, notifyRoleChanged } from "./group-notifications.ts"
import { revokeInvitationsOf } from "./invitation-revocation.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

interface GroupRow extends postgres.Row {
  id: string
  name: string
  description: string
  color: GroupColor | null
  emoji: string | null
  ownerUserId: number
  createdByUserId: number | null
  authorizationRevision: string
  nextChangeSequence: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

interface GroupAccessRow extends GroupRow {
  role: GroupRole
}

interface GroupSummaryRow extends postgres.Row {
  id: string
  name: string
  description: string
  color: GroupColor | null
  emoji: string | null
  role: GroupRole
  authorizationRevision: string
  changeSequence: string
  updatedAt: Date
}

/** A renamed group as the `UPDATE` returns it; the role comes from the locked membership. */
interface RenamedRow extends postgres.Row {
  id: string
  name: string
  description: string
  color: GroupColor | null
  emoji: string | null
  authorizationRevision: string
  changeSequence: string
  updatedAt: Date
}

interface GroupListRow extends GroupSummaryRow {
  memberCount: number
  members: { name: string }[]
}

interface MemberSummaryRow extends postgres.Row {
  userId: number
  name: string
  pictureId: string | null
  email?: string | null
  lastSeenAt?: Date | null
  role: GroupRole
  joinedAt: Date
  isYou: boolean
}

interface MemberRoleRow extends postgres.Row {
  userId: number
  role: GroupRole
}

interface ActiveUserRow extends postgres.Row {
  id: number
}

interface MemberRow extends postgres.Row {
  userId: number
}

interface DeletedGroupSummaryRow extends GroupSummaryRow {
  deletedAt: Date
}

interface SelectionRow extends postgres.Row {
  selectedGroupId: string | null
  version: number
}

const GROUP_CREATED_EVENT = "group.created"
const GROUP_RENAMED_EVENT = "group.renamed"
const GROUP_DETAILS_UPDATED_EVENT = "group.details_updated"
const GROUP_DELETED_EVENT = "group.deleted"
const GROUP_RESTORED_EVENT = "group.restored"
const MEMBER_ROLE_CHANGED_EVENT = "group.member_role_changed"
const MEMBER_REMOVED_EVENT = "group.member_removed"
const MEMBER_LEFT_EVENT = "group.member_left"
export const OWNERSHIP_TRANSFERRED_EVENT = "group.ownership_transferred"

/**
 * Most members one members read returns. Members join by invitation, and a plan caps them far
 * below this, so a group this large is not expected; the list then shows its oldest members and
 * stops, instead of reading without end, and the read's `memberCount` says how many there are.
 */
const MEMBER_LIST_LIMIT = 1000

/** The name of the group a person gets when a deletion would leave them with none. */
const REPLACEMENT_GROUP_NAME = "Personal"

/** Most deleted groups the restore list shows; a person does not delete this many in 30 days. */
const RESTORABLE_LIST_LIMIT = 100

export class PostgresGroupRepository implements GroupRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async listForUser(userId: number, page: GroupListPage): Promise<GroupListResult> {
    const limit = Math.max(1, Math.min(100, page.limit))
    // Each group carries its member count and its first members, for the list's avatar stack.
    const rows = await this.sql<GroupListRow[]>`
      SELECT
        groups.id,
        groups.name,
        groups.description,
        groups.color,
        groups.emoji,
        group_members.role,
        groups.authorization_revision::text AS authorization_revision,
        (groups.next_change_sequence - 1)::text AS change_sequence,
        groups.updated_at,
        (
          SELECT COUNT(*)::int
          FROM group_members AS member
          INNER JOIN users AS person ON person.id = member.user_id AND person.deleted_at IS NULL
          WHERE member.group_id = groups.id
        ) AS member_count,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object('name', first.name)
              ORDER BY first.created_at, first.user_id
            ),
            '[]'::json
          )
          FROM (
            SELECT
              member.user_id,
              member.created_at,
              btrim(concat_ws(' ', person.first_name, person.last_name)) AS name
            FROM group_members AS member
            INNER JOIN users AS person ON person.id = member.user_id AND person.deleted_at IS NULL
            WHERE member.group_id = groups.id
            ORDER BY member.created_at, member.user_id
            LIMIT ${GROUP_MEMBER_PREVIEW_LIMIT}
          ) AS first
        ) AS members
      FROM groups
      INNER JOIN group_members
        ON group_members.group_id = groups.id
       AND group_members.user_id = ${userId}
      INNER JOIN users
        ON users.id = group_members.user_id
       AND users.deleted_at IS NULL
      WHERE groups.deleted_at IS NULL
        ${
      page.after
        ? this.sql`
          AND (
            groups.updated_at < ${page.after.updatedAt}
            OR (groups.updated_at = ${page.after.updatedAt} AND groups.id > ${page.after.id})
          )
        `
        : this.sql``
    }
      ORDER BY groups.updated_at DESC, groups.id
      LIMIT ${limit + 1}
    `
    const groups = rows.slice(0, limit)
    const last = groups.at(-1)
    return {
      groups,
      nextPageKey: rows.length > limit && last ? { updatedAt: last.updatedAt, id: last.id } : null,
    }
  }

  async getSummaryForMember(groupId: string, userId: number): Promise<GroupSummary | null> {
    const rows = await this.sql<GroupSummaryRow[]>`
      SELECT
        groups.id,
        groups.name,
        groups.description,
        groups.color,
        groups.emoji,
        group_members.role,
        groups.authorization_revision::text AS authorization_revision,
        (groups.next_change_sequence - 1)::text AS change_sequence,
        groups.updated_at
      FROM groups
      INNER JOIN group_members
        ON group_members.group_id = groups.id
       AND group_members.user_id = ${userId}
      INNER JOIN users
        ON users.id = group_members.user_id
       AND users.deleted_at IS NULL
      WHERE groups.id = ${groupId}
        AND groups.deleted_at IS NULL
    `
    return rows[0] ?? null
  }

  async getForMember(groupId: string, userId: number): Promise<GroupAccess | null> {
    const row = (
      await this.sql<GroupAccessRow[]>`
        SELECT
          groups.id,
          groups.name,
          groups.description,
          groups.color,
          groups.emoji,
          groups.owner_user_id,
          groups.created_by_user_id,
          groups.authorization_revision::text AS authorization_revision,
          groups.next_change_sequence::text AS next_change_sequence,
          groups.created_at,
          groups.updated_at,
          groups.deleted_at,
          group_members.role
        FROM groups
        INNER JOIN group_members
          ON group_members.group_id = groups.id
         AND group_members.user_id = ${userId}
        INNER JOIN users
          ON users.id = group_members.user_id
         AND users.deleted_at IS NULL
        WHERE groups.id = ${groupId}
          AND groups.deleted_at IS NULL
        LIMIT 1
      `
    )[0]
    return row ? { group: toGroup(row), role: row.role } : null
  }

  async listMemberUserIds(groupId: string): Promise<number[]> {
    const rows = await this.sql<MemberRow[]>`
      SELECT group_members.user_id
      FROM group_members
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
      WHERE group_members.group_id = ${groupId}
      ORDER BY group_members.user_id
    `
    return rows.map((row) => row.userId)
  }

  /**
   * The group the person works in: the one they chose, while they are still a member of it and it
   * is not deleted, else the oldest group they belong to. A read only: the fallback is not stored, so
   * a read can never overwrite a choice committed at the same moment, and it announces nothing.
   * It is the same answer every time until membership changes, so every device agrees on it.
   */
  async getSelected(userId: number): Promise<SelectedGroup> {
    const stored = (
      await this.sql<SelectionRow[]>`
        SELECT selected_group_id, version FROM user_settings WHERE user_id = ${userId}
      `
    )[0]
    if (stored?.selectedGroupId && await this.isMember(stored.selectedGroupId, userId)) {
      return { groupId: stored.selectedGroupId, version: stored.version }
    }
    const fallback = (
      await this.sql<{ id: string }[]>`
        SELECT groups.id
        FROM groups
        INNER JOIN group_members
          ON group_members.group_id = groups.id
         AND group_members.user_id = ${userId}
        INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
        WHERE groups.deleted_at IS NULL
        ORDER BY groups.created_at, groups.id
        LIMIT 1
      `
    )[0]
    return { groupId: fallback?.id ?? null, version: stored?.version ?? 0 }
  }

  async select(userId: number, groupId: string): Promise<SelectedGroup | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      if (!await repository.isMember(groupId, userId)) return null
      return await repository.storeSelection(userId, groupId)
    })
  }

  private async isMember(groupId: string, userId: number): Promise<boolean> {
    const rows = await this.sql`
      SELECT 1
      FROM groups
      INNER JOIN group_members
        ON group_members.group_id = groups.id
       AND group_members.user_id = ${userId}
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE groups.id = ${groupId}
        AND groups.deleted_at IS NULL
    `
    return rows.length > 0
  }

  /** See {@link storeSelection}. */
  private async storeSelection(userId: number, groupId: string): Promise<SelectedGroup> {
    return await storeSelection(this.sql, userId, groupId)
  }

  async create(input: CreateGroupInput, actorId: number): Promise<CreatedGroup> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      return await repository.createInCurrentTransaction(input, actorId)
    })
  }

  /**
   * Creates the group an import fills (#230), owned by the importer, with `imported_at` set, and
   * records its change under `group.imported`. Inside the import's transaction only: the caller
   * writes the file's entities stamped with the answered sequence, then the audit event, so the
   * group and all it holds are kept or undone together. A taken id fails the statement.
   */
  async createImported(
    input: CreateGroupInput,
    actorId: number,
  ): Promise<{ group: GroupSummary; changeSequence: string }> {
    await this.assertActiveUser(actorId)
    const inserted = (await this.insertGroup(input, actorId, false))!
    await this.sql`UPDATE groups SET imported_at = now() WHERE id = ${inserted.id}`
    const sequence = await this.recordChange(inserted.id, actorId, GROUP_FILE_EVENTS.imported)
    return {
      group: toSummary(withStampedSequence(inserted, sequence), GroupRole.OWNER),
      changeSequence: sequence,
    }
  }

  async createFirst(input: FirstGroupInput, userId: number): Promise<void> {
    await this.insertFirst(input, userId)
  }

  async ensureFirst(input: FirstGroupInput, userId: number): Promise<void> {
    await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      // The lock on the user's row serialises two sign-ins of one person, so they cannot both see
      // "no group" and each make one.
      await repository.assertActiveUser(userId)
      if (await repository.hasActiveGroup(userId)) return
      await repository.insertFirst(input, userId)
    })
  }

  /** Whether the user belongs to an active group, other than `except` when it is given. */
  private async hasActiveGroup(userId: number, except?: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT 1
      FROM group_members
      INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
      WHERE group_members.user_id = ${userId}
        ${except === undefined ? this.sql`` : this.sql`AND group_members.group_id <> ${except}`}
      LIMIT 1
    `
    return rows.length > 0
  }

  private async insertFirst(input: FirstGroupInput, userId: number): Promise<void> {
    const group = await this.insertGroup(input, userId, false)
    await this.recordChange(group!.id, userId, GROUP_CREATED_EVENT)
  }

  /**
   * Inserts a group and its owner's membership. With `ignoreConflict`, an id already taken gives
   * `null` and writes nothing; without it, a taken id fails the statement, which rolls back the
   * caller's transaction (a sign-up with a taken group id leaves no half-made account).
   */
  private async insertGroup(
    input: { id: string; name: string } & Partial<GroupDetails>,
    ownerId: number,
    ignoreConflict: boolean,
  ): Promise<GroupRow | null> {
    const inserted = (
      await this.sql<GroupRow[]>`
        INSERT INTO groups (id, name, description, color, emoji, owner_user_id, created_by_user_id)
        VALUES (
          ${input.id},
          ${input.name},
          ${input.description ?? ""},
          ${input.color ?? null},
          ${input.emoji ?? null},
          ${ownerId},
          ${ownerId}
        )
        ${ignoreConflict ? this.sql`ON CONFLICT (id) DO NOTHING` : this.sql``}
        RETURNING
          id,
          name,
          description,
          color,
          emoji,
          owner_user_id,
          created_by_user_id,
          authorization_revision::text AS authorization_revision,
          next_change_sequence::text AS next_change_sequence,
          created_at,
          updated_at,
          deleted_at
      `
    )[0]
    if (!inserted) return null
    await this.sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      VALUES (${inserted.id}, ${ownerId}, ${GroupRole.OWNER}, ${ownerId})
    `
    return inserted
  }

  private async createInCurrentTransaction(
    input: CreateGroupInput,
    actorId: number,
  ): Promise<CreatedGroup> {
    await this.assertActiveUser(actorId)
    const inserted = await this.insertGroup(input, actorId, true)

    if (inserted) {
      await this.audit(inserted.id, actorId, GROUP_CREATED_EVENT, input.requestId)
      const sequence = await this.recordChange(inserted.id, actorId, GROUP_CREATED_EVENT)
      return {
        group: toSummary(withStampedSequence(inserted, sequence), GroupRole.OWNER),
        created: true,
      }
    }

    const existing = await this.getForMember(input.id, actorId)
    if (
      existing?.group.createdByUserId === actorId &&
      existing.group.name === input.name &&
      existing.role === GroupRole.OWNER
    ) {
      return {
        group: toSummary(existing.group, existing.role),
        created: false,
      }
    }
    throw new GroupError("ID_ALREADY_EXISTS", "Group id is already in use")
  }

  /**
   * The role checks inside the writes below repeat the handlers' rule (`canRename`, `canDelete` in
   * `@domain/groups`) as the least role the write needs, so a role changed between the handler's
   * read and the write cannot slip through.
   */
  async rename(
    groupId: string,
    name: string,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      // The role is read on the locked membership row: one the handler read before this
      // transaction may be gone by now.
      const role = await lockActorRole(transaction, groupId, actorId).catch((error) => {
        if (error instanceof GroupNotActiveError) return null
        throw error
      })
      if (role === null || !canRename(role)) return null
      const before = (
        await transaction<{ name: string }[]>`SELECT name FROM groups WHERE id = ${groupId}`
      )[0]
      const renamed = (
        await transaction<RenamedRow[]>`
          UPDATE groups
          SET name = ${name}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${groupId}
          RETURNING
            id,
            name,
            description,
            color,
            emoji,
            authorization_revision::text AS authorization_revision,
            next_change_sequence::text AS change_sequence,
            updated_at
        `
      )[0]
      if (!renamed) return null
      await repository.audit(groupId, actorId, GROUP_RENAMED_EVENT, requestId, {
        details: { from: before.name.slice(0, 100), to: renamed.name.slice(0, 100) },
      })
      const sequence = await repository.recordChange(groupId, actorId, GROUP_RENAMED_EVENT)
      return { ...renamed, role, changeSequence: sequence }
    })
  }

  async updateDetails(
    groupId: string,
    details: GroupDetails,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      // Whoever may rename may edit the details; the role is read on the locked membership row.
      const role = await lockActorRole(transaction, groupId, actorId).catch((error) => {
        if (error instanceof GroupNotActiveError) return null
        throw error
      })
      if (role === null || !canRename(role)) return null
      const updated = (
        await transaction<RenamedRow[]>`
          UPDATE groups
          SET
            description = ${details.description},
            color = ${details.color},
            emoji = ${details.emoji},
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${groupId}
          RETURNING
            id,
            name,
            description,
            color,
            emoji,
            authorization_revision::text AS authorization_revision,
            next_change_sequence::text AS change_sequence,
            updated_at
        `
      )[0]
      if (!updated) return null
      await repository.audit(groupId, actorId, GROUP_DETAILS_UPDATED_EVENT, requestId)
      const sequence = await repository.recordChange(groupId, actorId, GROUP_DETAILS_UPDATED_EVENT)
      return { ...updated, role, changeSequence: sequence }
    })
  }

  async softDelete(
    groupId: string,
    actorId: number,
    requestId?: string,
  ): Promise<DeletedGroupSummary | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      await repository.lockMembersAndActor(groupId, actorId)
      const group = await repository.lockOwnedGroup(groupId, actorId, false)
      if (!group) return null

      const others = (
        await transaction<{ count: number }[]>`
          SELECT COUNT(*)::int AS count
          FROM group_members
          INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
          WHERE group_members.user_id = ${actorId}
            AND group_members.group_id <> ${groupId}
        `
      )[0]
      if (others.count === 0) {
        throw new GroupError("LAST_GROUP", "A person must keep at least one group")
      }
      // A subscription the provider may still charge outlives a deleted group, so the owner cancels
      // it in the billing portal first.
      const live = await transaction`
        SELECT 1 FROM subscriptions
        WHERE group_id = ${groupId} AND status <> ${BillingStatus.Canceled}
      `
      if (live.length > 0) {
        throw new GroupError(
          "GROUP_SUBSCRIBED",
          "Cancel the group's subscription in the billing portal before deleting it",
        )
      }

      const deleted = (
        await transaction<{ deletedAt: Date; updatedAt: Date }[]>`
          UPDATE groups
          SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${groupId}
          RETURNING deleted_at, updated_at
        `
      )[0]

      // A member whose only group this was would be left with nowhere to work: they get a new one,
      // as they would at sign-up. The deleted group no longer counts, as the update above is done.
      const stranded = await transaction<MemberRow[]>`
        SELECT group_members.user_id
        FROM group_members
        INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
        WHERE group_members.group_id = ${groupId}
          AND NOT EXISTS (
            SELECT 1
            FROM group_members AS other
            INNER JOIN groups ON groups.id = other.group_id AND groups.deleted_at IS NULL
            WHERE other.user_id = group_members.user_id
          )
        ORDER BY group_members.user_id
      `
      for (const { userId } of stranded) {
        await repository.insertFirst(
          { id: uuidV7(), name: REPLACEMENT_GROUP_NAME },
          userId,
        )
      }

      // A deleted group's tokens are over for good: a restore brings the group back, not them.
      await apiTokenRows(transaction).revoke({ groupId }, "group-deleted")
      await repository.audit(groupId, actorId, GROUP_DELETED_EVENT, requestId)
      // Every member loses the group, the owner included: each of their pages must drop it.
      const members = await transaction<MemberRow[]>`
        SELECT group_members.user_id
        FROM group_members
        INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
        WHERE group_members.group_id = ${groupId}
      `
      const change = await recordAccessChange(
        transaction,
        groupId,
        actorId,
        GROUP_DELETED_EVENT,
        members.map((member) => member.userId),
        { allowDeleted: true },
      )
      return {
        id: groupId,
        name: group.name,
        description: group.description,
        color: group.color,
        emoji: group.emoji,
        role: GroupRole.OWNER,
        authorizationRevision: change.authorizationRevision,
        changeSequence: change.sequence,
        updatedAt: deleted.updatedAt,
        deletedAt: deleted.deletedAt,
      }
    })
  }

  async restore(
    groupId: string,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      await repository.assertActiveUser(actorId)
      const group = await repository.lockOwnedGroup(groupId, actorId, true)
      if (!group) return null
      const restored = (
        await transaction<{ updatedAt: Date }[]>`
          UPDATE groups
          SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${groupId}
          RETURNING updated_at
        `
      )[0]
      await repository.audit(groupId, actorId, GROUP_RESTORED_EVENT, requestId)
      // Nobody loses access: the members get the group back, and its hint reaches them.
      const change = await recordAccessChange(
        transaction,
        groupId,
        actorId,
        GROUP_RESTORED_EVENT,
        [],
      )
      return {
        id: groupId,
        name: group.name,
        description: group.description,
        color: group.color,
        emoji: group.emoji,
        role: GroupRole.OWNER,
        authorizationRevision: change.authorizationRevision,
        changeSequence: change.sequence,
        updatedAt: restored.updatedAt,
      }
    })
  }

  async listRestorable(userId: number): Promise<DeletedGroupSummary[]> {
    return await this.sql<DeletedGroupSummaryRow[]>`
      SELECT
        groups.id,
        groups.name,
        groups.description,
        groups.color,
        groups.emoji,
        group_members.role,
        groups.authorization_revision::text AS authorization_revision,
        (groups.next_change_sequence - 1)::text AS change_sequence,
        groups.updated_at,
        groups.deleted_at
      FROM groups
      INNER JOIN group_members
        ON group_members.group_id = groups.id
       AND group_members.user_id = ${userId}
       AND group_members.role = ${GroupRole.OWNER}
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE groups.deleted_at > now() - make_interval(days => ${GROUP_RESTORE_DAYS})
      ORDER BY groups.deleted_at DESC, groups.id
      LIMIT ${RESTORABLE_LIST_LIMIT}
    `
  }

  async getRestorableForMember(groupId: string, userId: number): Promise<GroupAccess | null> {
    const row = (
      await this.sql<GroupAccessRow[]>`
        SELECT
          groups.id,
          groups.name,
          groups.description,
          groups.color,
          groups.emoji,
          groups.owner_user_id,
          groups.created_by_user_id,
          groups.authorization_revision::text AS authorization_revision,
          groups.next_change_sequence::text AS next_change_sequence,
          groups.created_at,
          groups.updated_at,
          groups.deleted_at,
          group_members.role
        FROM groups
        INNER JOIN group_members
          ON group_members.group_id = groups.id
         AND group_members.user_id = ${userId}
        INNER JOIN users
          ON users.id = group_members.user_id
         AND users.deleted_at IS NULL
        WHERE groups.id = ${groupId}
          AND groups.deleted_at > now() - make_interval(days => ${GROUP_RESTORE_DAYS})
        LIMIT 1
      `
    )[0]
    return row ? { group: toGroup(row), role: row.role } : null
  }

  async listMembers(groupId: string, actorId: number): Promise<GroupMembersResult | null> {
    const actor = await this.getSummaryForMember(groupId, actorId)
    if (!actor) return null
    const [members, [count]] = await Promise.all([
      this.readMembers(groupId, actorId, {
        emails: canSeeMemberEmails(actor.role),
        lastSeen: canSeeMemberLastSeen(actor.role),
      }),
      this.sql<{ memberCount: number }[]>`
        SELECT count(*)::int AS member_count
        FROM group_members
        INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
        WHERE group_members.group_id = ${groupId}
      `,
    ])
    return { members, memberCount: count.memberCount }
  }

  /**
   * The members of a group as `actorId` sees them, oldest first; with `only`, just that member.
   * With `emails`, each carries the address on their sign-in key, `null` for an account with none;
   * without it, no member carries an `email` field at all. `lastSeen` does the same for
   * `lastSeenAt`.
   */
  private async readMembers(
    groupId: string,
    actorId: number,
    { emails, lastSeen, only }: { emails: boolean; lastSeen: boolean; only?: number },
  ): Promise<GroupMemberSummary[]> {
    return await this.sql<MemberSummaryRow[]>`
      SELECT
        group_members.user_id,
        btrim(concat_ws(' ', users.first_name, users.last_name)) AS name,
        users.picture_id,
        ${
      emails
        ? this.sql`(
          SELECT auth_keys.email
          FROM auth_keys
          WHERE auth_keys.user_id = group_members.user_id AND auth_keys.email IS NOT NULL
          ORDER BY auth_keys.id
          LIMIT 1
        ) AS email,`
        : this.sql``
    }
        ${lastSeen ? this.sql`users.last_seen_at,` : this.sql``}
        group_members.role,
        group_members.created_at AS joined_at,
        group_members.user_id = ${actorId} AS is_you
      FROM group_members
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE group_members.group_id = ${groupId}
        ${only === undefined ? this.sql`` : this.sql`AND group_members.user_id = ${only}`}
      ORDER BY group_members.created_at, group_members.user_id
      LIMIT ${MEMBER_LIST_LIMIT}
    `
  }

  /**
   * The rule is checked twice: by the handler before it calls this, and here on rows this
   * transaction has locked, so a role changed in between cannot slip through. Locking the group
   * row first makes every member change of one group wait for the one before it.
   */
  async changeMemberRole(
    groupId: string,
    userId: number,
    role: GroupRole,
    actorId: number,
    requestId?: string,
  ): Promise<GroupMemberSummary | null> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      if (!await repository.lockActiveGroup(groupId)) return null
      const roles = await repository.lockMemberRoles(groupId, [actorId, userId])
      assertCanChangeRole(roles.get(actorId) ?? null, roles.get(userId) ?? null, role)
      if (roles.get(userId) !== role) {
        await transaction`
          UPDATE group_members
          SET role = ${role}, updated_at = CURRENT_TIMESTAMP
          WHERE group_id = ${groupId} AND user_id = ${userId}
        `
        await repository.audit(groupId, actorId, MEMBER_ROLE_CHANGED_EVENT, requestId, {
          targetUserId: userId,
          details: { from: roles.get(userId)!, to: role },
        })
        await notifyRoleChanged(transaction, groupId, userId, roles.get(userId)!, role)
        // A demoted member's links must not let anyone in above what they may now invite with.
        await revokeInvitationsOf(transaction, groupId, userId, role, actorId, requestId)
        // A demoted member can still read the group, so nobody loses access: the raised revision
        // and the group's hint are what take a write away from their open pages.
        await recordAccessChange(transaction, groupId, actorId, MEMBER_ROLE_CHANGED_EVENT, [])
      }
      // Only the owner and an admin get this far, and both may see addresses.
      return (await repository.readMembers(groupId, actorId, {
        emails: true,
        lastSeen: true,
        only: userId,
      }))[0]
    })
  }

  async removeMember(
    groupId: string,
    userId: number,
    actorId: number,
    requestId?: string,
  ): Promise<boolean> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      // Users before the group, as a delete locks them, so the two wait for each other in one
      // order: a delete and a removal at once cannot both leave the person without a group.
      await repository.lockUsers([actorId, userId], actorId)
      if (!await repository.lockActiveGroup(groupId)) return false
      const roles = await repository.lockMemberRoles(groupId, [actorId, userId])
      assertCanRemoveMember(roles.get(actorId) ?? null, roles.get(userId) ?? null)
      await repository.dropMember(groupId, userId)
      await repository.audit(groupId, actorId, MEMBER_REMOVED_EVENT, requestId, {
        targetUserId: userId,
      })
      await notifyRemoved(transaction, groupId, userId)
      // Their own links would let them back in.
      await revokeInvitationsOf(transaction, groupId, userId, null, actorId, requestId)
      await recordAccessChange(transaction, groupId, actorId, MEMBER_REMOVED_EVENT, [userId])
      return true
    })
  }

  /**
   * Checks {@link assertCanTransfer} on locked rows, so of two transfers at once the second finds
   * its actor an admin and is refused. The old owner is demoted before the new one is promoted:
   * the unique index on the owner role refuses any order that would hold two owners at once.
   */
  async transferOwnership(
    groupId: string,
    userId: number,
    actorId: number,
    requestId?: string,
  ): Promise<boolean> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      // Users before the group, in the order a removal takes them.
      await repository.lockUsers([actorId, userId], actorId)
      if (!await repository.lockActiveGroup(groupId)) return false
      const roles = await repository.lockMemberRoles(groupId, [actorId, userId])
      assertCanTransfer(roles.get(actorId) ?? null, roles.get(userId) ?? null)
      // A renewing subscription refuses the transfer; the old owner's customer is handed over.
      await handOverBilling(transaction, groupId)
      await transaction`
        UPDATE group_members
        SET role = ${GroupRole.ADMIN}, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ${groupId} AND user_id = ${actorId}
      `
      await transaction`
        UPDATE group_members
        SET role = ${GroupRole.OWNER}, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ${groupId} AND user_id = ${userId}
      `
      await transaction`
        UPDATE groups SET owner_user_id = ${userId} WHERE id = ${groupId}
      `
      await repository.audit(groupId, actorId, OWNERSHIP_TRANSFERRED_EVENT, requestId, {
        targetUserId: userId,
      })
      await notifyOwnershipReceived(transaction, groupId, userId)
      // The old owner is now an admin: their admin links go, their viewer and editor links stay.
      // The new owner may invite with every role, so their links all stay.
      await revokeInvitationsOf(transaction, groupId, actorId, GroupRole.ADMIN, actorId, requestId)
      // Both keep reading the group; the raised revision updates their open pages' controls.
      await recordAccessChange(transaction, groupId, actorId, OWNERSHIP_TRANSFERRED_EVENT, [])
      return true
    })
  }

  async leave(groupId: string, actorId: number, requestId?: string): Promise<boolean> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresGroupRepository(transaction)
      await repository.lockUsers([actorId], actorId)
      if (!await repository.lockActiveGroup(groupId)) return false
      const roles = await repository.lockMemberRoles(groupId, [actorId])
      assertCanLeave(roles.get(actorId) ?? null)
      if (!await repository.hasActiveGroup(actorId, groupId)) {
        throw new GroupError(
          "LAST_GROUP",
          "You cannot leave your only group. Create another first.",
        )
      }
      await repository.dropMember(groupId, actorId)
      await repository.audit(groupId, actorId, MEMBER_LEFT_EVENT, requestId)
      await revokeInvitationsOf(transaction, groupId, actorId, null, actorId, requestId)
      await recordAccessChange(transaction, groupId, actorId, MEMBER_LEFT_EVENT, [actorId])
      return true
    })
  }

  /**
   * Deletes one membership, the one way a person leaves a group or is removed from it. What the
   * member wrote stays in the group with their name on it. Their API tokens for the group are
   * revoked, so none works again if the person is added back (#293). A member left with no active
   * group gets a new one, as a delete gives them.
   */
  private async dropMember(groupId: string, userId: number): Promise<void> {
    await this.sql`DELETE FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}`
    await apiTokenRows(this.sql).revoke({ userId, groupId }, "membership-ended")
    if (!await this.hasActiveGroup(userId)) {
      await this.insertFirst({ id: uuidV7(), name: REPLACEMENT_GROUP_NAME }, userId)
    }
  }

  /** Locks the group's row while it is active; `false` when it is missing or deleted. */
  private async lockActiveGroup(groupId: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT 1 FROM groups WHERE id = ${groupId} AND deleted_at IS NULL FOR NO KEY UPDATE
    `
    return rows.length > 0
  }

  /** Locks the memberships of `userIds` in the group, in id order; the role of each active one. */
  private async lockMemberRoles(
    groupId: string,
    userIds: number[],
  ): Promise<Map<number, GroupRole>> {
    const rows = await this.sql<MemberRoleRow[]>`
      SELECT group_members.user_id, group_members.role
      FROM group_members
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE group_members.group_id = ${groupId}
        AND group_members.user_id IN ${this.sql(userIds)}
      ORDER BY group_members.user_id
      FOR UPDATE OF group_members
    `
    return new Map(rows.map((row) => [row.userId, row.role]))
  }

  /** Locks the rows of `userIds` in id order; throws `USER_NOT_ACTIVE` when `actorId` is not active. */
  private async lockUsers(userIds: number[], actorId: number): Promise<void> {
    const locked = await this.sql<ActiveUserRow[]>`
      SELECT users.id
      FROM users
      WHERE users.deleted_at IS NULL AND users.id IN ${this.sql(userIds)}
      ORDER BY users.id
      FOR NO KEY UPDATE
    `
    if (!locked.some((user) => user.id === actorId)) {
      throw new GroupError("USER_NOT_ACTIVE", "User is not active")
    }
  }

  /**
   * Locks the rows of the actor and of every member of the group, in id order, so two deletions
   * that touch the same people wait for each other instead of each leaving them a group the other
   * deletes. Id order keeps two such waits from deadlocking.
   */
  private async lockMembersAndActor(groupId: string, actorId: number): Promise<void> {
    const locked = await this.sql<ActiveUserRow[]>`
      SELECT users.id
      FROM users
      WHERE users.deleted_at IS NULL
        AND (
          users.id = ${actorId}
          OR users.id IN (SELECT user_id FROM group_members WHERE group_id = ${groupId})
        )
      ORDER BY users.id
      FOR NO KEY UPDATE
    `
    if (!locked.some((user) => user.id === actorId)) {
      throw new GroupError("USER_NOT_ACTIVE", "User is not active")
    }
  }

  /**
   * Locks the group row when `actorId` owns it: an active group, or with `restorable` a group
   * deleted inside the restore window. `null` when it is neither, or the actor is not its owner.
   */
  private async lockOwnedGroup(
    groupId: string,
    actorId: number,
    restorable: boolean,
  ): Promise<Pick<GroupSummaryRow, "name" | "description" | "color" | "emoji"> | null> {
    const row = (
      await this.sql<Pick<GroupSummaryRow, "name" | "description" | "color" | "emoji">[]>`
        SELECT groups.name, groups.description, groups.color, groups.emoji
        FROM groups
        INNER JOIN group_members
          ON group_members.group_id = groups.id
         AND group_members.user_id = ${actorId}
         AND group_members.role = ${GroupRole.OWNER}
        WHERE groups.id = ${groupId}
          AND ${
        restorable
          ? this.sql`groups.deleted_at > now() - make_interval(days => ${GROUP_RESTORE_DAYS})`
          : this.sql`groups.deleted_at IS NULL`
      }
        FOR NO KEY UPDATE OF groups
      `
    )[0]
    return row ?? null
  }

  /** Writes one audit row in the current transaction. It outlives the group (see the purge). */
  private async audit(
    groupId: string,
    actorId: number,
    eventKind: string,
    requestId: string | undefined,
    facts: Pick<AuditEventInput, "targetUserId" | "details"> = {},
  ): Promise<void> {
    await writeAuditEvent(this.sql, { eventKind, actorId, groupId, requestId, ...facts })
  }

  /** Records a change on a group in the current transaction; see {@link recordGroupChange}. */
  private async recordChange(
    groupId: string,
    actorId: number,
    eventKind: string,
    options: { allowDeleted?: boolean } = {},
  ): Promise<string> {
    return await recordGroupChange(this.transaction, groupId, actorId, eventKind, options)
  }

  /**
   * The transaction this repository runs in. A change is recorded in the transaction of its write,
   * so a repository built on the pool refuses to record one.
   */
  private get transaction(): postgres.TransactionSql {
    if (!isTransaction(this.sql)) {
      throw new Error("A group change must be recorded inside a transaction")
    }
    return this.sql
  }

  private async assertActiveUser(userId: number): Promise<void> {
    const active = (
      await this.sql<ActiveUserRow[]>`
        SELECT users.id
        FROM users
        WHERE users.id = ${userId}
          AND users.deleted_at IS NULL
        FOR UPDATE
      `
    )[0]
    if (!active) {
      throw new GroupError("USER_NOT_ACTIVE", "User is not active")
    }
  }
}

function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    emoji: row.emoji,
    ownerUserId: row.ownerUserId,
    createdByUserId: row.createdByUserId,
    authorizationRevision: row.authorizationRevision,
    nextChangeSequence: row.nextChangeSequence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

/** The row as it reads after `recordChange` took `sequence`: the next one is one past it. */
function withStampedSequence(row: GroupRow, sequence: string): GroupRow {
  return { ...row, nextChangeSequence: (BigInt(sequence) + 1n).toString() }
}

function toSummary(
  group: Pick<
    Group,
    | "id"
    | "name"
    | "description"
    | "color"
    | "emoji"
    | "authorizationRevision"
    | "nextChangeSequence"
    | "updatedAt"
  >,
  role: GroupRole,
): GroupSummary {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    color: group.color,
    emoji: group.emoji,
    role,
    authorizationRevision: group.authorizationRevision,
    changeSequence: (BigInt(group.nextChangeSequence) - 1n).toString(),
    updatedAt: group.updatedAt,
  }
}

/** Whether `sql` is a transaction's handle; only those have `savepoint`. */
function isTransaction(sql: postgres.Sql): sql is postgres.TransactionSql {
  return "savepoint" in sql
}

/**
 * Stores the selection and, when it changed, moves the version. Selecting the group already
 * selected changes nothing. It announces nothing: the handler emits `GroupSelectedEvent`. Runs in
 * the caller's transaction: an accepted invitation selects its group this way too.
 */
export async function storeSelection(
  sql: postgres.Sql,
  userId: number,
  groupId: string,
): Promise<SelectedGroup> {
  const changed = (
    await sql<SelectionRow[]>`
      INSERT INTO user_settings (user_id, selected_group_id)
      VALUES (${userId}, ${groupId})
      ON CONFLICT (user_id) DO UPDATE
      SET selected_group_id = EXCLUDED.selected_group_id,
          version = user_settings.version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_settings.selected_group_id IS DISTINCT FROM EXCLUDED.selected_group_id
      RETURNING selected_group_id, version
    `
  )[0]
  if (changed) {
    return { groupId, version: changed.version }
  }
  const current = (
    await sql<SelectionRow[]>`
      SELECT selected_group_id, version FROM user_settings WHERE user_id = ${userId}
    `
  )[0]
  return { groupId, version: current.version }
}
