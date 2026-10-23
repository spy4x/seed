import type { Query } from "@spy4x/platform/cqrs"
import { pluralize } from "@spy4x/platform/universal/text"
import type { Actor } from "@domain/identity"
import { GroupError, GroupRole } from "./+lib.ts"

/**
 * How long the worker keeps a group's activity: events older than this many days are deleted. A
 * product that must keep its log longer passes its own number to `purgeOldAuditEvents`.
 */
export const AUDIT_RETENTION_DAYS = 365

/** The most events one page of the activity log holds, and the default. */
export const ACTIVITY_PAGE_MAX = 100
export const ACTIVITY_PAGE_DEFAULT = 50

/** What an audit event can point at besides a member: the thing the event is about. */
export type AuditEntityType = "note" | "invitation" | "tag"

/** Short facts an event keeps for its sentence: names, roles, a count. Never a body or an address. */
export type AuditDetails = Record<string, string | number>

/**
 * The kinds of event the activity log writes, as they are stored in `audit_events.event_kind`.
 * The server's writers use these strings; `describeActivity` has a sentence for each.
 */
export const ACTIVITY_KINDS = [
  "group.created",
  "group.renamed",
  "group.details_updated",
  "group.deleted",
  "group.restored",
  "group.member_role_changed",
  "group.member_removed",
  "group.member_left",
  "group.ownership_transferred",
  "group.invitation_created",
  "group.invitation_accepted",
  "group.invitation_revoked",
  "group.invitation_declined",
  "group.data_moved_out",
  "group.data_moved_in",
  "group.exported",
  "group.imported",
  "note.created",
  "note.deleted",
  "note.restored",
  "note.moved_out",
  "note.moved_in",
  "note.attachment.added",
  "note.attachment.removed",
  "tag.created",
  "tag.updated",
  "tag.deleted",
] as const

/**
 * The key an operator's action from the admin area adds to its audit row's details. Its presence,
 * whatever the value, marks the row as the operator's.
 */
export const OPERATOR_DETAIL = "operator"

/**
 * How a group's log names an operator who acted on the group from the admin area. Its members
 * never see who the operator is: not their name, not their sign-in e-mail, not their account id.
 */
export const SUPPORT_TEAM_LABEL = "Support team"

/** A person named in the log. `userId` is `null` once the account is gone. */
export interface ActivityPerson {
  userId: number | null
  /** Their name; empty when they set none or the account is gone. */
  name: string
}

/** What an event points at, and whether it can still be opened. */
export interface ActivityEntity {
  type: AuditEntityType
  id: string
  /** The note is still in the group; it is gone after a delete or a move. */
  exists: boolean
}

/** One line of a group's activity log. */
export interface ActivityEvent {
  /** A decimal string: the database's bigint is larger than a JavaScript number is exact for. */
  id: string
  kind: string
  at: Date
  actor: ActivityPerson
  /** The member a role change, removal or transfer is about. */
  target: ActivityPerson | null
  entity: ActivityEntity | null
  details: AuditDetails
}

/** Where the next page starts: after this event id, going back in time. */
export interface ActivityPageKey {
  id: string
}

export interface ActivityPage {
  limit: number
  after?: ActivityPageKey
}

export interface ActivityResult {
  events: ActivityEvent[]
  nextPageKey: ActivityPageKey | null
}

export interface GroupActivityPayload {
  actor: Actor
  groupId: string
  page: ActivityPage
}

/**
 * A page of the group's activity, newest first. Only an admin or the owner may read it: an editor
 * or a viewer is told `ROLE_INSUFFICIENT`, and a person who is not a member is told the group does
 * not exist.
 */
export class GroupActivityQuery implements Query<GroupActivityPayload, ActivityResult> {
  __resultType?: ActivityResult
  constructor(public data: GroupActivityPayload) {}
}

/** The read side of the log. The access check is the handler's, before it calls this. */
export interface GroupActivityRepository {
  list(groupId: string, page: ActivityPage): Promise<ActivityResult>
}

/** Whether `role` may read the group's activity: an admin or the owner. */
export function canViewActivity(role: GroupRole): boolean {
  return role >= GroupRole.ADMIN
}

/**
 * Throws unless `role` may read the group's activity. `null` means the actor is not a member,
 * which answers "group not found" so a stranger cannot tell a group exists.
 */
export function assertCanViewActivity(role: GroupRole | null): void {
  if (role === null) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (!canViewActivity(role)) {
    throw new GroupError("ROLE_INSUFFICIENT", "Only an admin or the owner can see the activity")
  }
}

/** A function, not a table: this module and `+lib.ts` import each other, so `GroupRole` is not set yet at load. */
function roleWord(role: unknown): string {
  switch (role) {
    case GroupRole.VIEWER:
      return "viewer"
    case GroupRole.EDITOR:
      return "editor"
    case GroupRole.ADMIN:
      return "admin"
    case GroupRole.OWNER:
      return "owner"
    default:
      return "member"
  }
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a"
}

/** "1 note" or "3 notes"; "some notes" when the event kept no count. */
function counted(count: unknown, noun: string): string {
  if (count === 1) return `1 ${noun}`
  return `${typeof count === "number" ? count : "some"} ${pluralize(noun)}`
}

function quoted(value: unknown): string {
  return typeof value === "string" && value !== "" ? `“${value}”` : ""
}

/**
 * One event in plain language, such as "Ada moved 3 notes to Family". A person with no name reads
 * as their e-mail (the server fills it in), and "Someone" if they have neither. An event an
 * operator wrote from the admin area reads "Support team". An actor whose account is gone reads
 * "Deleted user"; a missing target reads "a member". An event whose facts
 * were not kept (one written before the log existed) gets the shortest true sentence; a kind this
 * code does not know still reads as an event, never as a code.
 */
export function describeActivity(
  event: Pick<ActivityEvent, "kind" | "actor" | "target" | "details">,
): string {
  const who = OPERATOR_DETAIL in event.details
    ? SUPPORT_TEAM_LABEL
    : event.actor.userId === null
    ? "Deleted user"
    : event.actor.name || "Someone"
  // A missing actor can only be a deleted account: the column was required until the log existed.
  // A missing target is either a deleted account or an event written before targets were kept, so
  // it reads "a member", which is true of both.
  const target = event.target?.userId == null ? "a member" : event.target.name || "a member"
  const { details } = event
  switch (event.kind) {
    case "group.created":
      return `${who} created the group`
    case "group.renamed": {
      const from = quoted(details.from)
      const to = quoted(details.to)
      return from && to
        ? `${who} renamed the group from ${from} to ${to}`
        : `${who} renamed the group`
    }
    case "group.details_updated":
      return `${who} changed the group's description, colour or emoji`
    case "group.deleted":
      return `${who} deleted the group`
    case "group.restored":
      return `${who} restored the group`
    case "group.member_role_changed": {
      const to = roleWord(details.to)
      return typeof details.from === "number"
        ? `${who} changed ${target} from ${article(roleWord(details.from))} ${
          roleWord(details.from)
        } to ${article(to)} ${to}`
        : `${who} changed the role of ${target}`
    }
    case "group.member_removed":
      return `${who} removed ${target} from the group`
    case "group.member_left":
      return `${who} left the group`
    case "group.ownership_transferred":
      return `${who} made ${target} the owner of the group`
    case "group.invitation_created": {
      const role = roleWord(details.role)
      return typeof details.role === "number"
        ? `${who} invited someone to join as ${article(role)} ${role}`
        : `${who} invited someone to join`
    }
    case "group.invitation_accepted":
      return `${who} joined the group`
    case "group.invitation_revoked":
      return `${who} withdrew an invitation`
    case "group.invitation_declined":
      return `${who} declined an invitation`
    case "group.data_moved_out": {
      const to = typeof details.groupName === "string" && details.groupName !== ""
        ? details.groupName
        : "another group"
      return `${who} moved all the group's data (${counted(details.count, "item")}) to ${to}`
    }
    case "group.data_moved_in":
      return `${who} moved all of another group's data (${counted(details.count, "item")}) here`
    case "group.exported":
      return `${who} exported the group to a file`
    case "group.imported":
      return `${who} created the group from an export file (${counted(details.count, "item")})`
    case "note.created": {
      const title = quoted(details.title)
      return title ? `${who} added the note ${title}` : `${who} added a note`
    }
    case "note.deleted": {
      const title = quoted(details.title)
      return title ? `${who} deleted the note ${title}` : `${who} deleted a note`
    }
    case "note.restored": {
      const title = quoted(details.title)
      return title ? `${who} restored the note ${title}` : `${who} restored a note`
    }
    case "note.moved_out": {
      const to = typeof details.groupName === "string" && details.groupName !== ""
        ? details.groupName
        : "another group"
      return `${who} moved ${counted(details.count, "note")} to ${to}`
    }
    case "note.moved_in":
      return `${who} moved ${counted(details.count, "note")} here from another group`
    case "note.attachment.added": {
      const name = quoted(details.name)
      const title = quoted(details.title)
      const file = name ? `the file ${name}` : "a file"
      return title ? `${who} attached ${file} to ${title}` : `${who} attached ${file}`
    }
    case "note.attachment.removed": {
      const name = quoted(details.name)
      const title = quoted(details.title)
      const file = name ? `the file ${name}` : "a file"
      return title ? `${who} removed ${file} from ${title}` : `${who} removed ${file}`
    }
    case "tag.created": {
      const name = quoted(details.name)
      return name ? `${who} added the tag ${name}` : `${who} added a tag`
    }
    case "tag.updated": {
      const name = quoted(details.name)
      const from = quoted(details.from)
      if (from && name) return `${who} renamed the tag ${from} to ${name}`
      if (!name) return `${who} changed a tag`
      return typeof details.color === "string"
        ? `${who} changed the colour of the tag ${name}`
        : `${who} changed the tag ${name}`
    }
    case "tag.deleted": {
      const name = quoted(details.name)
      const deleted = name ? `${who} deleted the tag ${name}` : `${who} deleted a tag`
      return typeof details.notes === "number" && details.notes > 0
        ? `${deleted}, which ${counted(details.notes, "note")} carried`
        : deleted
    }
    default:
      return `${who} changed something in the group`
  }
}
