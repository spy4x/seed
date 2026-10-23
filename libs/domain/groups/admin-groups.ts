import { type } from "arktype"
import { parseSort, serializeSort, type SortRule } from "@spy4x/platform/universal/sort"
import { UserRole } from "@domain/identity"
import type { GroupColor, GroupRole } from "./+lib.ts"

// ---------------------------------------------------------------------------------------------
// The operator area's groups module (#426): `/api/admin/groups/...`. Counts and account facts
// only: no note, tag or description text ever reaches these shapes.
// ---------------------------------------------------------------------------------------------

/** How many groups one page of the operator's group list shows. */
export const ADMIN_GROUPS_PAGE_SIZE = 25

/** The longest search the group list takes, in characters. */
export const ADMIN_GROUP_SEARCH_MAX_LENGTH = 100

/** How many activity events, and how many invitations, a group's page shows. */
export const ADMIN_GROUP_ACTIVITY_LIMIT = 50
export const ADMIN_GROUP_INVITATION_LIMIT = 100

/**
 * The lowest role that may hand a group to another member. A transfer moves billing and every
 * owner's right, so it takes a supervisor; an operator may remove members and revoke invitations.
 */
export const ADMIN_GROUP_TRANSFER_ROLE = UserRole.SUPERVISOR

/** A person a group's page names: the owner, a member, an invitation's creator. */
export interface AdminGroupPerson {
  id: number
  /** First and last name; empty when they set none. */
  name: string
  /** The address they sign in with, or `null` for an older account with a username only. */
  email: string | null
}

/** One group in the operator's group list. Dates are ISO 8601. */
export interface AdminGroupRow {
  id: string
  name: string
  emoji: string | null
  color: GroupColor | null
  owner: AdminGroupPerson
  memberCount: number
  /** Notes that are not deleted. A count, never their text. */
  noteCount: number
  /** The plan the subscription names while it is trialing, active or past due; else `free`. */
  planId: string
  createdAt: string
  /** The newest entry in the group's activity log, or `null` when it has none. */
  lastActivityAt: string | null
  /** When the group went to the trash, or `null` while it is active. */
  deletedAt: string | null
}

/** The answer of `GET /api/admin/groups`. */
export interface AdminGroupListResponse {
  groups: AdminGroupRow[]
  /** How many groups match the search and filter, over every page. */
  total: number
  /** The page shown, 1-based. */
  page: number
  pageSize: number
}

/** One member of a group, as the operator sees them. */
export interface AdminGroupMember extends AdminGroupPerson {
  /** Their profile picture (#228); `null` or absent for none. */
  pictureId?: string | null
  role: GroupRole
  /** The person's role in the product, which decides whether an operator may act on them. */
  userRole: UserRole
  blocked: boolean
  joinedAt: string
}

/** Where an invitation stands: still usable, or why it no longer is. */
export type AdminInvitationState = "pending" | "revoked" | "declined" | "used" | "expired"

/** One invitation of the group. Never its token or the token's hash. */
export interface AdminGroupInvitation {
  id: string
  role: GroupRole
  /** The address it is tied to, or `null` for a link anyone may use. */
  email: string | null
  uses: number
  maxUses: number
  state: AdminInvitationState
  createdBy: AdminGroupPerson | null
  createdAt: string
  expiresAt: string
}

/** A person the activity log names. `userId` is `null` once the account is gone. */
export interface AdminActivityPerson {
  userId: number | null
  name: string
}

/**
 * One entry of the group's activity log. Only its numeric facts are kept (roles, counts): a note's
 * title or a tag's name never leaves the API, so a sentence names the act alone.
 */
export interface AdminGroupActivityEvent {
  id: string
  kind: string
  at: string
  actor: AdminActivityPerson
  target: AdminActivityPerson | null
  details: Record<string, number>
  /** An operator did this from the admin app. */
  byOperator: boolean
}

/** The group's subscription as stored, or `null` when it never had one. */
export interface AdminGroupBilling {
  planId: string | null
  /** `BillingStatus`: 1 trialing, 2 active, 3 past due, 4 canceled, 5 incomplete, 6 paused. */
  status: number
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
}

/** How much the group holds. Counts only. */
export interface AdminGroupCounts {
  notes: number
  deletedNotes: number
  tags: number
  pendingInvitations: number
  /** Files on the group's notes, those in the trash included, and their bytes. */
  files: number
  fileBytes: number
}

/** The most files the operator's Files tab lists, newest first. */
export const ADMIN_GROUP_FILE_LIMIT = 200

/**
 * One file on a note of the group, as the operator sees it: its type, size, uploader and date.
 * Never its name or its note's title: those are written inside the group.
 */
export interface AdminGroupFile {
  id: string
  contentType: string
  size: number
  /** `null` once the account is gone. */
  uploader: AdminGroupPerson | null
  createdAt: string
  /** The file's note is in the trash; the file goes when the note is purged. */
  noteDeleted: boolean
}

/** The answer of `GET /api/admin/groups/:id/files`. */
export interface AdminGroupFiles {
  /** The newest {@link ADMIN_GROUP_FILE_LIMIT} files. */
  files: AdminGroupFile[]
  /** Every file of the group and the plan's caps for them, `null` for none. */
  usage: { files: number; bytes: number; maxFiles: number | null; maxBytes: number | null }
}

/** The answer of `GET /api/admin/groups/:id`. */
export interface AdminGroupDetail {
  group: AdminGroupRow
  counts: AdminGroupCounts
  billing: AdminGroupBilling | null
  members: AdminGroupMember[]
  /** The newest {@link ADMIN_GROUP_INVITATION_LIMIT} invitations, newest first. */
  invitations: AdminGroupInvitation[]
  /** The newest {@link ADMIN_GROUP_ACTIVITY_LIMIT} entries of the activity log, newest first. */
  activity: AdminGroupActivityEvent[]
  /**
   * When the group was made from an export file, and by whom (`null` once that account is gone);
   * `null` for a group created empty.
   */
  imported: { at: string; by: AdminGroupPerson | null } | null
}

/** Whether the list shows active groups, groups in the trash, or both. */
export type AdminGroupStatusFilter = "any" | "active" | "deleted"

/** A column the group list sorts by, on the server. */
export type AdminGroupSortKey = "name" | "memberCount" | "createdAt" | "lastActivityAt"

/** Every {@link AdminGroupSortKey}, in the order the list's columns show them. */
export const ADMIN_GROUP_SORT_KEYS: readonly AdminGroupSortKey[] = [
  "name",
  "memberCount",
  "lastActivityAt",
  "createdAt",
]

/** The order of the group list when the address names none: newest first. */
export const ADMIN_GROUP_DEFAULT_SORT: SortRule<AdminGroupSortKey>[] = [
  { key: "createdAt", direction: "desc" },
]

/** The search and filter of the group list, as the page's address and the API's query carry them. */
export interface AdminGroupFilter {
  /** Words that must each appear in the group's name or its owner's name or address. */
  query: string
  status: AdminGroupStatusFilter
  /** The order, most significant rule first; empty means newest first. Ties go by id. */
  sort: SortRule<AdminGroupSortKey>[]
  /** 1-based. */
  page: number
}

/** The filter that shows every group, first page, newest first. */
export const ADMIN_GROUP_NO_FILTER: AdminGroupFilter = {
  query: "",
  status: "any",
  sort: ADMIN_GROUP_DEFAULT_SORT,
  page: 1,
}

/**
 * Reads the group list's filter from query parameters (`q`, `status`, `sort`, `page`). A value it
 * does not understand falls back to the default for that part, so a hand-edited address still
 * shows a list.
 */
export function parseAdminGroupFilter(params: URLSearchParams): AdminGroupFilter {
  const query = (params.get("q") ?? "").trim().slice(0, ADMIN_GROUP_SEARCH_MAX_LENGTH)
  const rawStatus = params.get("status")
  const status: AdminGroupStatusFilter = rawStatus === "active" || rawStatus === "deleted"
    ? rawStatus
    : "any"
  const pageNumber = Number(params.get("page"))
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 100_000
    ? pageNumber
    : 1
  const sort = parseSort(params.get("sort"), ADMIN_GROUP_SORT_KEYS, ADMIN_GROUP_DEFAULT_SORT)
  return { query, status, sort, page }
}

/** The query string of `filter`, leaving out every part at its default. No leading `?`. */
export function adminGroupFilterQuery(filter: AdminGroupFilter): string {
  const params = new URLSearchParams()
  if (filter.query) params.set("q", filter.query)
  if (filter.status !== "any") params.set("status", filter.status)
  const sort = serializeSort(filter.sort)
  if (sort !== serializeSort(ADMIN_GROUP_DEFAULT_SORT)) params.set("sort", sort)
  if (filter.page > 1) params.set("page", String(filter.page))
  return params.toString()
}

/** The body of `POST /api/admin/groups/:id/transfer`: the member who becomes the owner. */
export const adminGroupTransferSchema = type({
  userId: "1 <= number.integer <= 2147483647",
  "+": "reject",
})
export type AdminGroupTransferRequest = typeof adminGroupTransferSchema.infer
