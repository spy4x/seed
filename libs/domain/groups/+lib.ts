/// <reference lib="es2022.intl" />
import type { Command, Query } from "@spy4x/platform/cqrs"
import { isRecord } from "@spy4x/platform/universal/is-record"
import {
  hasUnsafeTextCharacters,
  hasUnstorableTextCharacters,
} from "@spy4x/platform/universal/text"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { isHexColor } from "@spy4x/platform/universal/color"
import type { Actor } from "@domain/identity"

export * from "./activity.ts"
export * from "./invitations.ts"
export * from "./move-all.ts"
export * from "./admin-groups.ts"
export * from "./export-import.ts"
export * from "./overview.ts"

/**
 * The aggregate a group's changes are recorded and announced under: the `aggregate_type` of its
 * outbox rows (whose `aggregate_version` is the change's sequence) and the `aggregate` of its
 * `change.hint`.
 */
export const GROUP_AGGREGATE = "group"

/**
 * How long a deleted group can be restored. After this many days the worker removes the group and
 * its data for good, and the group is gone for its owner too.
 */
export const GROUP_RESTORE_DAYS = 30

/** Longest group description, in characters. */
export const GROUP_DESCRIPTION_MAX = 500

/** The longest emoji a group may carry, in characters: a family or a flag is under ten. */
export const GROUP_EMOJI_MAX = 16

/**
 * A group's colour: any `#rrggbb`, kept in lower case. The mark draws the emoji on it, and the
 * screens pick black or white for anything written on it (`readableTextColor`).
 */
export type GroupColor = string

export enum GroupRole {
  VIEWER = 1,
  EDITOR = 2,
  ADMIN = 3,
  OWNER = 4,
}

export type GroupErrorCode =
  | "GROUP_NOT_FOUND"
  | "GROUP_SUBSCRIBED"
  | "ID_ALREADY_EXISTS"
  | "INVALID_CURSOR"
  | "INVALID_REQUEST"
  | "LAST_GROUP"
  | "LAST_OWNER"
  | "MEMBER_NOT_FOUND"
  | "NAME_MISMATCH"
  | "NOTHING_TO_MOVE"
  | "PASSWORD_INVALID"
  | "ROLE_INSUFFICIENT"
  | "SAME_GROUP"
  | "SUBSCRIPTION_RENEWS"
  | "USER_NOT_ACTIVE"

export class GroupError extends Error {
  constructor(
    public readonly code: GroupErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "GroupError"
  }
}

export interface Group {
  id: string
  name: string
  /** Up to {@link GROUP_DESCRIPTION_MAX} characters; empty when unset. */
  description: string
  /** `null` when the group has no colour. */
  color: GroupColor | null
  /** One emoji, or `null` when the group has none. */
  emoji: string | null
  ownerUserId: number
  /** `null` once the creator deleted their account. */
  createdByUserId: number | null
  authorizationRevision: string
  nextChangeSequence: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

export interface GroupMembership {
  groupId: string
  userId: number
  role: GroupRole
  /** `null` once whoever added them deleted their account. */
  addedByUserId: number | null
  createdAt: Date
  updatedAt: Date
}

export interface GroupSummary {
  id: string
  name: string
  /** See {@link Group.description}. */
  description: string
  /** See {@link Group.color}. */
  color: GroupColor | null
  /** See {@link Group.emoji}. */
  emoji: string | null
  role: GroupRole
  /**
   * How many members the group has, which the groups list shows on each row, and the first few of
   * them in the order they joined. Only the list read fills these two.
   */
  memberCount?: number
  members?: GroupMemberPreview[]
  authorizationRevision: string
  /**
   * The sequence of the last change committed to the group, as a decimal string (BIGINT). A client
   * that holds a group at this sequence has seen every change up to now; it is the number a pull
   * moves the client's cursor to.
   */
  changeSequence: string
  updatedAt: Date
}

/** Most members a group in the list carries in `members`; the rest are only counted. */
export const GROUP_MEMBER_PREVIEW_LIMIT = 5

/** A member as the groups list shows them in an avatar stack. */
export interface GroupMemberPreview {
  /** Their first and last name; empty when they set none. */
  name: string
}

/** One member of a group, as the group's members list shows them. */
export interface GroupMemberSummary {
  userId: number
  /** Their first and last name; empty when they set none. */
  name: string
  /** Their profile picture (#228, `pictureUrl`); `null` or absent for none. */
  pictureId?: string | null
  /**
   * The address they sign in with, or `null` for an account that has none. Present only for a
   * reader who may see addresses ({@link canSeeMemberEmails}).
   */
  email?: string | null
  role: GroupRole
  /** When they became a member. */
  joinedAt: Date
  /**
   * When they were last active, or `null` if not since this was recorded. Present only for a
   * reader who may see it ({@link canSeeMemberLastSeen}): an admin or the owner.
   */
  lastSeenAt?: Date | null
  /** This member is the person who asked. */
  isYou: boolean
}

/** A deleted group its owner can still restore; `deletedAt` is when it was deleted. */
export interface DeletedGroupSummary extends GroupSummary {
  deletedAt: Date
}

export interface GroupAccess {
  group: Group
  role: GroupRole
}

/** A new group from a request: its id and name, and the details the editor filled in. */
export interface CreateGroupRequest extends GroupDetails {
  id: string
  name: string
}

/** A group to create. Details left out start empty: no description, colour or emoji. */
export interface CreateGroupInput extends Partial<GroupDetails> {
  id: string
  name: string
  requestId?: string
}

/** The first group a person gets, when they sign up or when they somehow have none. */
export interface FirstGroupInput {
  id: string
  name: string
}

export interface CreatedGroup {
  group: GroupSummary
  created: boolean
}

export interface GroupListPageKey {
  updatedAt: Date
  id: string
}

export interface GroupListPage {
  limit: number
  after?: GroupListPageKey
}

export interface GroupListResult {
  groups: GroupSummary[]
  nextPageKey: GroupListPageKey | null
}

export interface GroupCreatePayload extends Partial<GroupDetails> {
  actor: Actor
  id: string
  name: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

export type GroupCreateResult = CreatedGroup

export class GroupCreateCommand implements Command<GroupCreatePayload, GroupCreateResult> {
  __resultType?: GroupCreateResult
  constructor(public data: GroupCreatePayload) {}
}

export interface GroupRenamePayload {
  actor: Actor
  groupId: string
  name: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Renames a group. An admin or the owner may; a viewer or editor is refused with
 * `ROLE_INSUFFICIENT`, and a non-member is told `GROUP_NOT_FOUND`.
 */
export class GroupRenameCommand implements Command<GroupRenamePayload, { group: GroupSummary }> {
  __resultType?: { group: GroupSummary }
  constructor(public data: GroupRenamePayload) {}
}

/** The three optional details of a group, as an edit sets them all at once. */
export interface GroupDetails {
  description: string
  color: GroupColor | null
  emoji: string | null
}

export interface GroupUpdateDetailsPayload extends GroupDetails {
  actor: Actor
  groupId: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Sets a group's description, colour and emoji. Whoever may rename the group may ({@link
 * canRename}); a viewer or editor is refused with `ROLE_INSUFFICIENT`, and a non-member is told
 * `GROUP_NOT_FOUND`. It announces the change like a rename, so every member's page reads again.
 */
export class GroupUpdateDetailsCommand
  implements Command<GroupUpdateDetailsPayload, { group: GroupSummary }> {
  __resultType?: { group: GroupSummary }
  constructor(public data: GroupUpdateDetailsPayload) {}
}

export interface GroupDeletePayload {
  actor: Actor
  groupId: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Soft-deletes a group: it is hidden from every member and its owner can restore it for
 * {@link GROUP_RESTORE_DAYS} days. Only the owner may. The actor's last group is refused with
 * `LAST_GROUP`.
 */
export class GroupDeleteCommand
  implements Command<GroupDeletePayload, { group: DeletedGroupSummary }> {
  __resultType?: { group: DeletedGroupSummary }
  constructor(public data: GroupDeletePayload) {}
}

export interface GroupRestorePayload {
  actor: Actor
  groupId: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Brings back a group deleted less than {@link GROUP_RESTORE_DAYS} days ago, with all its data.
 * Only the owner may; an older or never-deleted group answers `GROUP_NOT_FOUND`.
 */
export class GroupRestoreCommand implements Command<GroupRestorePayload, { group: GroupSummary }> {
  __resultType?: { group: GroupSummary }
  constructor(public data: GroupRestorePayload) {}
}

export interface GroupDeletedListPayload {
  actor: Actor
}

/** The groups the actor owns that can still be restored, most recently deleted first. */
export class GroupDeletedListQuery
  implements Query<GroupDeletedListPayload, { groups: DeletedGroupSummary[] }> {
  __resultType?: { groups: DeletedGroupSummary[] }
  constructor(public data: GroupDeletedListPayload) {}
}

export interface GroupMembersPayload {
  actor: Actor
  groupId: string
}

/**
 * The members of a group, in the order they joined. Any member may read them; a non-member is told
 * `GROUP_NOT_FOUND`.
 */
export class GroupMembersQuery implements Query<GroupMembersPayload, GroupMembersResult> {
  __resultType?: GroupMembersResult
  constructor(public data: GroupMembersPayload) {}
}

/**
 * The members a read returns and how many the group has. A read stops at a cap the store sets, so
 * `memberCount` can be larger than `members.length`: the page then says the list is cut off.
 */
export interface GroupMembersResult {
  members: GroupMemberSummary[]
  memberCount: number
}

export interface GroupMemberRolePayload {
  actor: Actor
  groupId: string
  userId: number
  role: GroupRole
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Gives a member another role, by {@link assertCanChangeRole}: the owner may make anyone else a
 * viewer, editor or admin; an admin may move viewers and editors between those two.
 */
export class GroupMemberRoleCommand
  implements Command<GroupMemberRolePayload, { member: GroupMemberSummary }> {
  __resultType?: { member: GroupMemberSummary }
  constructor(public data: GroupMemberRolePayload) {}
}

export interface GroupMemberRemovePayload {
  actor: Actor
  groupId: string
  userId: number
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Removes a member, by {@link assertCanRemoveMember}. What they wrote stays in the group under
 * their name. A member left with no group gets a new one, as a delete gives them.
 */
export class GroupMemberRemoveCommand
  implements Command<GroupMemberRemovePayload, { removed: true }> {
  __resultType?: { removed: true }
  constructor(public data: GroupMemberRemovePayload) {}
}

export interface GroupLeavePayload {
  actor: Actor
  groupId: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * The actor leaves a group. Any member but the owner may (`LAST_OWNER`: ownership must move
 * first); nobody may leave their last group (`LAST_GROUP`).
 */
export class GroupLeaveCommand implements Command<GroupLeavePayload, { left: true }> {
  __resultType?: { left: true }
  constructor(public data: GroupLeavePayload) {}
}

export interface GroupTransferPayload {
  actor: Actor
  groupId: string
  /** The member who becomes the owner. */
  userId: number
  /** The group's name as the owner typed it, to confirm which group they hand over. */
  name: string
  /** The owner's current password, checked as a password change checks it. */
  password: string
  requestId?: string
}

/**
 * Hands the group to another member, by {@link assertCanTransfer}: the member becomes the owner
 * and the owner becomes an admin, in one transaction, so the group never has zero or two owners.
 * The owner confirms with the group's name and their password. It carries no retry key: a retry
 * after it landed is refused, since the person is no longer the owner, and no stored answer should
 * stand in for a password check.
 */
export class GroupTransferCommand implements Command<GroupTransferPayload, { transferred: true }> {
  __resultType?: { transferred: true }
  constructor(public data: GroupTransferPayload) {}
}

export interface GroupListPayload {
  actor: Actor
  page: GroupListPage
}

export class GroupListQuery implements Query<GroupListPayload, GroupListResult> {
  __resultType?: GroupListResult
  constructor(public data: GroupListPayload) {}
}

export interface GroupGetPayload {
  actor: Actor
  groupId: string
}

export type GroupGetResult = { group: GroupSummary }

/** One group of the actor, as the list shows it. Throws `GROUP_NOT_FOUND` for a non-member. */
export class GroupGetQuery implements Query<GroupGetPayload, GroupGetResult> {
  __resultType?: GroupGetResult
  constructor(public data: GroupGetPayload) {}
}

/**
 * Which group the person works in now: the one `/notes` shows. One per user, kept on the server so
 * every device agrees. `groupId` is `null` only for a person who belongs to no group.
 */
export interface SelectedGroup {
  groupId: string | null
  /**
   * Grows by one every time the selection changes; `0` while the person never chose and the
   * answer is the fallback.
   */
  version: number
}

export interface GroupSelectPayload {
  actor: Actor
  groupId: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Selects one of the actor's groups. A group the actor is not a member of answers
 * `GROUP_NOT_FOUND`, as a missing group does.
 */
export class GroupSelectCommand implements Command<GroupSelectPayload, SelectedGroup> {
  __resultType?: SelectedGroup
  constructor(public data: GroupSelectPayload) {}
}

export interface GroupSelectedPayload {
  actor: Actor
}

/**
 * The actor's selected group. When the stored one is gone (the group was deleted, or the person
 * left it) or never chosen, the answer is another of their groups, the oldest one: the server
 * decides, so every device gets the same answer. A deleted group is never the answer.
 */
export class GroupSelectedQuery implements Query<GroupSelectedPayload, SelectedGroup> {
  __resultType?: SelectedGroup
  constructor(public data: GroupSelectedPayload) {}
}

export interface GroupRepository {
  /** See {@link GroupSelectedQuery}. */
  getSelected(userId: number): Promise<SelectedGroup>
  /**
   * Stores the user's selection, in one transaction. `null` when the user is not a member of the
   * group (or it is missing): nothing is stored. The repository announces nothing: the handler
   * emits `GroupSelectedEvent`, which tells the user's other devices.
   */
  select(userId: number, groupId: string): Promise<SelectedGroup | null>
  listForUser(userId: number, page: GroupListPage): Promise<GroupListResult>
  /** The group as the list shows it, or `null` when it is missing or the user is not a member. */
  getSummaryForMember(groupId: string, userId: number): Promise<GroupSummary | null>
  /**
   * The ids of the active users who can see a group now: its members while it is not deleted. A
   * group change is pushed to them, read again for every hint, so someone who lost access stops
   * getting the group's hints. The change that took their access away tells them itself (the
   * server's `recordAccessChange`).
   */
  listMemberUserIds(groupId: string): Promise<number[]>
  /** The actor's access to an active group, or `null` for a missing, deleted or foreign group. */
  getForMember(groupId: string, userId: number): Promise<GroupAccess | null>
  /**
   * The actor's access to a group deleted less than {@link GROUP_RESTORE_DAYS} days ago, or `null`
   * for any other group: active, purged, older or not theirs.
   */
  getRestorableForMember(groupId: string, userId: number): Promise<GroupAccess | null>
  create(input: CreateGroupInput, actorId: number): Promise<CreatedGroup>
  /**
   * Creates the person's first group in the caller's transaction, as sign-up does. The group is an
   * ordinary one: the person owns it, and it follows every rule other groups follow.
   */
  createFirst(input: FirstGroupInput, userId: number): Promise<void>
  /**
   * Gives a person with no active group one, in its own transaction; does nothing for a person who
   * has a group. Sign-in calls it, so an account always has somewhere to work.
   */
  ensureFirst(input: FirstGroupInput, userId: number): Promise<void>
  /** Renames the group and announces the change. `null` when it is missing or deleted. */
  rename(
    groupId: string,
    name: string,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null>
  /**
   * Sets the group's description, colour and emoji and announces the change. `null` when the actor
   * may not edit them or the group is missing or deleted.
   */
  updateDetails(
    groupId: string,
    details: GroupDetails,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null>
  /**
   * Soft-deletes the group, in one transaction: refuses with `LAST_GROUP` when it is the actor's
   * only active group; gives every other member who would be left with no group a new one; and
   * announces the change. `null` when the group is missing or already deleted.
   */
  softDelete(
    groupId: string,
    actorId: number,
    requestId?: string,
  ): Promise<DeletedGroupSummary | null>
  /** Brings a group back inside its restore window. `null` when it is not restorable. */
  restore(groupId: string, actorId: number, requestId?: string): Promise<GroupSummary | null>
  /** The groups the user owns that can still be restored, most recently deleted first. */
  listRestorable(userId: number): Promise<DeletedGroupSummary[]>
  /**
   * The members of an active group, in the order they joined, as `actorId` sees them (`isYou`).
   * `null` when the group is missing or deleted, or `actorId` is not a member.
   */
  listMembers(groupId: string, actorId: number): Promise<GroupMembersResult | null>
  /**
   * Gives a member a new role and announces the change, in one transaction that checks
   * {@link assertCanChangeRole} again on locked rows. `null` when the group is missing or deleted.
   */
  changeMemberRole(
    groupId: string,
    userId: number,
    role: GroupRole,
    actorId: number,
    requestId?: string,
  ): Promise<GroupMemberSummary | null>
  /**
   * Removes a member and announces it, in one transaction that checks
   * {@link assertCanRemoveMember} again on locked rows; gives them a new group when this was their
   * last. `false` when the group is missing or deleted.
   */
  removeMember(
    groupId: string,
    userId: number,
    actorId: number,
    requestId?: string,
  ): Promise<boolean>
  /**
   * The actor leaves the group, in one transaction that checks {@link assertCanLeave} and the
   * last-group rule. `false` when the group is missing or deleted.
   */
  leave(groupId: string, actorId: number, requestId?: string): Promise<boolean>
  /**
   * Makes `userId` the owner and `actorId` an admin and announces it, in one transaction that checks
   * {@link assertCanTransfer} again on locked rows. `false` when the group is missing or deleted.
   */
  transferOwnership(
    groupId: string,
    userId: number,
    actorId: number,
    requestId?: string,
  ): Promise<boolean>
}

const GROUP_ID_KEYS = ["groupId"]
const CREATE_KEYS = ["id", "name"]
const CREATE_OPTIONAL_KEYS = ["color", "description", "emoji"]
const RENAME_BODY_KEYS = ["name"]
const RENAME_KEYS = ["groupId", "name"]
const DETAILS_BODY_KEYS = ["color", "description", "emoji"]
const DETAILS_KEYS = ["color", "description", "emoji", "groupId"]

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).sort().join(",") === keys.join(",")
}

/**
 * A group name from a request: trimmed, 1 to 100 characters, none of them a control character
 * (NUL, a tab, a line break), which Postgres may refuse, or an invisible or text-direction one.
 */
export function parseGroupName(value: unknown): string {
  if (typeof value !== "string") {
    throw new GroupError("INVALID_REQUEST", "Group name must be a string")
  }
  const name = value.trim()
  const nameLength = Array.from(name).length
  if (nameLength < 1 || nameLength > 100) {
    throw new GroupError("INVALID_REQUEST", "Group name must contain 1 to 100 characters")
  }
  if (hasUnsafeTextCharacters(name)) {
    throw new GroupError(
      "INVALID_REQUEST",
      "Group name must not contain control or invisible characters",
    )
  }
  return name
}

/**
 * A create over REST or the socket: `id` and `name`, and any of `description`, `color` and `emoji`,
 * so one request carries everything the editor filled in. A detail left out starts empty, which
 * keeps a client that sends only `{ id, name }` working. Any other key is refused.
 */
export function parseCreateGroupRequest(value: unknown): CreateGroupRequest {
  if (
    !isRecord(value) || !CREATE_KEYS.every((key) => key in value) ||
    !Object.keys(value).every((key) =>
      CREATE_KEYS.includes(key) || CREATE_OPTIONAL_KEYS.includes(key)
    )
  ) {
    throw new GroupError(
      "INVALID_REQUEST",
      "Expected id and name, and at most description, color and emoji",
    )
  }
  return {
    id: parseGroupId(value.id),
    name: parseGroupName(value.name),
    description: parseGroupDescription("description" in value ? value.description : ""),
    color: parseGroupColor("color" in value ? value.color : null),
    emoji: parseGroupEmoji("emoji" in value ? value.emoji : null),
  }
}

/** The body of a rename over REST, where the path names the group: exactly `{ name }`. */
export function parseRenameGroupBody(value: unknown): { name: string } {
  if (!hasExactKeys(value, RENAME_BODY_KEYS)) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly name")
  }
  return { name: parseGroupName(value.name) }
}

/** The payload of a rename over the socket: exactly `{ groupId, name }`. */
export function parseRenameGroupRequest(value: unknown): { groupId: string; name: string } {
  if (!hasExactKeys(value, RENAME_KEYS)) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly groupId and name")
  }
  return { groupId: parseGroupId(value.groupId), name: parseGroupName(value.name) }
}

/**
 * A group description: at most {@link GROUP_DESCRIPTION_MAX} characters once trimmed, may be empty.
 * It may hold line breaks, but no character Postgres cannot store (NUL, half of a surrogate pair).
 */
export function parseGroupDescription(value: unknown): string {
  if (typeof value !== "string") {
    throw new GroupError("INVALID_REQUEST", "Group description must be a string")
  }
  const description = value.trim()
  if (Array.from(description).length > GROUP_DESCRIPTION_MAX) {
    throw new GroupError(
      "INVALID_REQUEST",
      `Group description must contain at most ${GROUP_DESCRIPTION_MAX} characters`,
    )
  }
  if (hasUnstorableTextCharacters(description)) {
    throw new GroupError(
      "INVALID_REQUEST",
      "Group description must not contain a NUL or a broken character",
    )
  }
  return description
}

/** A group colour: a `#rrggbb` in either case, returned in lower case, or `null` for none. */
export function parseGroupColor(value: unknown): GroupColor | null {
  if (value === null) return null
  if (isHexColor(value)) return value.toLowerCase()
  throw new GroupError(
    "INVALID_REQUEST",
    "Group colour must be null or a hex colour like #1a2b3c",
  )
}

const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/**
 * A group emoji: exactly one grapheme (a flag, a family or a skin-toned hand counts as one) that
 * is an emoji, or `null` or an empty string for none. Letters, digits and several emoji are
 * refused.
 */
export function parseGroupEmoji(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string") {
    throw new GroupError("INVALID_REQUEST", "Group emoji must be a string or null")
  }
  const emoji = value.trim()
  if (emoji === "") return null
  const graphemes = Array.from(GRAPHEMES.segment(emoji))
  // One grapheme can still be unbounded (an emoji plus endless combining marks); the column holds
  // 32 characters, so refuse here what the database would refuse with a 500.
  if (
    graphemes.length !== 1 || !EMOJI_PATTERN.test(emoji) ||
    Array.from(emoji).length > GROUP_EMOJI_MAX
  ) {
    throw new GroupError("INVALID_REQUEST", "Group emoji must be a single emoji")
  }
  return emoji
}

function parseGroupDetails(value: Record<string, unknown>): GroupDetails {
  return {
    description: parseGroupDescription(value.description),
    color: parseGroupColor(value.color),
    emoji: parseGroupEmoji(value.emoji),
  }
}

/** The body of a details update over REST, where the path names the group: the three fields. */
export function parseGroupDetailsBody(value: unknown): GroupDetails {
  if (!hasExactKeys(value, DETAILS_BODY_KEYS)) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly description, color and emoji")
  }
  return parseGroupDetails(value)
}

/** The payload of a details update over the socket: `{ groupId }` and the three fields. */
export function parseGroupDetailsRequest(value: unknown): GroupDetails & { groupId: string } {
  if (!hasExactKeys(value, DETAILS_KEYS)) {
    throw new GroupError(
      "INVALID_REQUEST",
      "Expected exactly groupId, description, color and emoji",
    )
  }
  return { groupId: parseGroupId(value.groupId), ...parseGroupDetails(value) }
}

/**
 * The body of a request that names one group (select, delete, restore): exactly `{ groupId }`, a
 * lowercase UUID.
 */
export function parseGroupIdRequest(value: unknown): { groupId: string } {
  if (!hasExactKeys(value, GROUP_ID_KEYS)) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly groupId")
  }
  return { groupId: parseGroupId(value.groupId) }
}

/** A member's user id from a request: a positive 32-bit integer, or `INVALID_REQUEST`. */
export function parseMemberUserId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new GroupError("INVALID_REQUEST", "User id must be a positive integer")
  }
  return value
}

/** A member's user id from a path segment: digits only, then {@link parseMemberUserId}. */
export function parseMemberUserIdParam(value: string): number {
  return parseMemberUserId(/^[1-9]\d{0,9}$/.test(value) ? Number(value) : value)
}

/** A role a member can be given: viewer, editor or admin. The owner role moves only by transfer. */
export function parseMemberRole(value: unknown): GroupRole {
  if (value !== GroupRole.VIEWER && value !== GroupRole.EDITOR && value !== GroupRole.ADMIN) {
    throw new GroupError("INVALID_REQUEST", "Role must be 1 (viewer), 2 (editor) or 3 (admin)")
  }
  return value
}

/** The body of a role change over REST, where the path names the group and member: `{ role }`. */
export function parseMemberRoleBody(value: unknown): { role: GroupRole } {
  if (!hasExactKeys(value, ["role"])) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly role")
  }
  return { role: parseMemberRole(value.role) }
}

/** The payload of a role change over the socket: exactly `{ groupId, role, userId }`. */
export function parseMemberRoleRequest(
  value: unknown,
): { groupId: string; userId: number; role: GroupRole } {
  if (!hasExactKeys(value, ["groupId", "role", "userId"])) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly groupId, userId and role")
  }
  return {
    groupId: parseGroupId(value.groupId),
    userId: parseMemberUserId(value.userId),
    role: parseMemberRole(value.role),
  }
}

/** The payload of a request that names one member over the socket: exactly `{ groupId, userId }`. */
export function parseMemberRequest(value: unknown): { groupId: string; userId: number } {
  if (!hasExactKeys(value, ["groupId", "userId"])) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly groupId and userId")
  }
  return { groupId: parseGroupId(value.groupId), userId: parseMemberUserId(value.userId) }
}

/**
 * The body of a transfer of ownership over REST, where the path names the group: exactly
 * `{ name, password, userId }`. The name and password are checked by the handler, not here.
 */
export function parseTransferBody(
  value: unknown,
): { userId: number; name: string; password: string } {
  if (!hasExactKeys(value, ["name", "password", "userId"])) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly userId, name and password")
  }
  if (typeof value.name !== "string" || value.name.length > 200) {
    throw new GroupError("INVALID_REQUEST", "Name must be a string")
  }
  if (typeof value.password !== "string" || value.password.length > 1024) {
    throw new GroupError("INVALID_REQUEST", "Password must be a string")
  }
  return { userId: parseMemberUserId(value.userId), name: value.name, password: value.password }
}

/** A group id from a request: a lowercase UUID of any version, or `INVALID_REQUEST`. */
export function parseGroupId(value: unknown): string {
  if (!isUuid(value)) {
    throw new GroupError("INVALID_REQUEST", "Group id must be a lowercase UUID")
  }
  return value
}

export function canRead(role: GroupRole): boolean {
  return isGroupRole(role)
}

export function canMutateNotes(role: GroupRole): boolean {
  return isGroupRole(role) && role >= GroupRole.EDITOR
}

export function canManageMember(
  actor: GroupRole,
  target: GroupRole,
  next?: GroupRole,
): boolean {
  if (!isGroupRole(actor) || !isGroupRole(target) || (next !== undefined && !isGroupRole(next))) {
    return false
  }
  if (actor === GroupRole.OWNER) {
    return true
  }
  if (actor !== GroupRole.ADMIN || target > GroupRole.EDITOR) {
    return false
  }
  return next === undefined || next <= GroupRole.EDITOR
}

/**
 * Whether `role` may rename the group: an admin or the owner. Every group follows the same rule.
 */
export function canRename(role: GroupRole): boolean {
  return isGroupRole(role) && role >= GroupRole.ADMIN
}

/**
 * Whether `role` may read the sign-in addresses of the group's members: an admin or the owner,
 * who manage the members. Viewers and editors see names only.
 */
export function canSeeMemberEmails(role: GroupRole): boolean {
  return isGroupRole(role) && role >= GroupRole.ADMIN
}

/** Whether `role` may read when members were last active: an admin or the owner. */
export function canSeeMemberLastSeen(role: GroupRole): boolean {
  return isGroupRole(role) && role >= GroupRole.ADMIN
}

/** Whether `role` may delete or restore the group: only the owner. */
export function canDelete(role: GroupRole): boolean {
  return isGroupRole(role) && role === GroupRole.OWNER
}

/** Whether `role` may pay for the group and change its plan: only the owner. */
export function canManageBilling(role: GroupRole): boolean {
  return isGroupRole(role) && role === GroupRole.OWNER
}

/**
 * Throws unless `role` may rename the group. `null` means the actor is not a member, which answers
 * "group not found" so a stranger cannot tell a group exists.
 */
export function assertCanRename(role: GroupRole | null): void {
  if (role === null || !canRead(role)) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (!canRename(role)) {
    throw new GroupError("ROLE_INSUFFICIENT", "Only an admin or the owner can rename a group")
  }
}

/**
 * Throws unless `role` may edit the group's description, colour and emoji: whoever may rename it.
 * See {@link assertCanRename}.
 */
export function assertCanEditDetails(role: GroupRole | null): void {
  if (role === null || !canRead(role)) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (!canRename(role)) {
    throw new GroupError(
      "ROLE_INSUFFICIENT",
      "Only an admin or the owner can edit a group's details",
    )
  }
}

/** Throws unless `role` may delete or restore the group: only the owner. See {@link assertCanRename}. */
export function assertCanDelete(role: GroupRole | null): void {
  if (role === null || !canRead(role)) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (!canDelete(role)) {
    throw new GroupError("ROLE_INSUFFICIENT", "Only the owner can delete or restore a group")
  }
}

/**
 * The roles `actor` may give a member who holds `target`, other than the one they hold: by
 * {@link canManageMember}, never the owner role (it moves only by a transfer of ownership), and
 * nothing for the owner, whose role changes only by that transfer. Empty when there is no choice.
 */
export function assignableRoles(actor: GroupRole, target: GroupRole): GroupRole[] {
  if (target === GroupRole.OWNER) return []
  return [GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN].filter((next) =>
    next !== target && canManageMember(actor, target, next)
  )
}

/** Whether `actor` may remove a member who holds `target`: by {@link canManageMember}, never the owner. */
export function canRemoveMember(actor: GroupRole, target: GroupRole): boolean {
  return target !== GroupRole.OWNER && canManageMember(actor, target)
}

/** Whether a member with `role` may leave the group: anyone but the owner. */
export function canLeave(role: GroupRole): boolean {
  return canRead(role) && role !== GroupRole.OWNER
}

/**
 * Throws unless `actor` may give the member who holds `target` the role `next`. `actor` is `null`
 * for a non-member (`GROUP_NOT_FOUND`, as a missing group answers) and `target` for a person who
 * is not a member (`MEMBER_NOT_FOUND`). The owner's own role, and the owner role itself, change
 * only by a transfer of ownership (`LAST_OWNER`). Giving a member the role they hold is allowed
 * and changes nothing.
 */
export function assertCanChangeRole(
  actor: GroupRole | null,
  target: GroupRole | null,
  next: GroupRole,
): void {
  if (actor === null || !canRead(actor)) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (target === null || !canRead(target)) {
    throw new GroupError("MEMBER_NOT_FOUND", "This person is not a member of the group")
  }
  if (target === GroupRole.OWNER || next === GroupRole.OWNER) {
    throw new GroupError("LAST_OWNER", "The owner's role changes only by transferring ownership")
  }
  if (!canManageMember(actor, target, next)) {
    throw new GroupError(
      "ROLE_INSUFFICIENT",
      "Only the owner, or an admin for viewers and editors, can change a role",
    )
  }
}

/** Throws unless `actor` may remove the member who holds `target`. See {@link assertCanChangeRole}. */
export function assertCanRemoveMember(actor: GroupRole | null, target: GroupRole | null): void {
  if (actor === null || !canRead(actor)) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (target === null || !canRead(target)) {
    throw new GroupError("MEMBER_NOT_FOUND", "This person is not a member of the group")
  }
  if (target === GroupRole.OWNER) {
    throw new GroupError("LAST_OWNER", "The owner cannot be removed from the group")
  }
  if (!canRemoveMember(actor, target)) {
    throw new GroupError(
      "ROLE_INSUFFICIENT",
      "Only the owner, or an admin for viewers and editors, can remove a member",
    )
  }
}

/** Throws unless a member with `role` may leave: anyone but the owner. `null` is a non-member. */
export function assertCanLeave(role: GroupRole | null): void {
  if (role === null || !canRead(role)) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (!canLeave(role)) {
    throw new GroupError(
      "LAST_OWNER",
      "The owner cannot leave the group. Transfer ownership to another member first.",
    )
  }
}

/** Whether `actor` may hand the group to a member who holds `target`: the owner, to anyone else. */
export function canTransfer(actor: GroupRole, target: GroupRole): boolean {
  return actor === GroupRole.OWNER && canRead(target) && target !== GroupRole.OWNER
}

/**
 * Throws unless `actor` may hand the group to the member who holds `target`: only the owner may,
 * to another member. `null` is a non-member, as in {@link assertCanChangeRole}.
 */
export function assertCanTransfer(actor: GroupRole | null, target: GroupRole | null): void {
  if (actor === null || !canRead(actor)) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (actor !== GroupRole.OWNER) {
    throw new GroupError("ROLE_INSUFFICIENT", "Only the owner can transfer ownership")
  }
  if (target === null || !canRead(target)) {
    throw new GroupError("MEMBER_NOT_FOUND", "This person is not a member of the group")
  }
  if (!canTransfer(actor, target)) {
    throw new GroupError("INVALID_REQUEST", "You already own this group")
  }
}

/**
 * Throws `NAME_MISMATCH` unless `typed` is the group's name: the owner confirms which group they
 * hand over. Spaces around it are ignored; letters must match exactly.
 */
export function assertTransferNameMatches(typed: string, name: string): void {
  if (typed.trim() !== name.trim()) {
    throw new GroupError("NAME_MISMATCH", "Type the group's name exactly as it is shown")
  }
}

export function assertOwnerRemains(ownerCount: number): void {
  if (ownerCount < 1) {
    throw new GroupError("LAST_OWNER", "A shared group must retain an owner")
  }
}

function isGroupRole(role: GroupRole): boolean {
  return Number.isInteger(role) && role >= GroupRole.VIEWER && role <= GroupRole.OWNER
}
