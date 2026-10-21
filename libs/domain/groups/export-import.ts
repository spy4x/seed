import type { Command, Query } from "@spy4x/platform/cqrs"
import type { Actor } from "@domain/identity"
import { canRead, type GroupColor, GroupError, GroupRole, type GroupSummary } from "./+lib.ts"
import type { MoveAllAllowances } from "./move-all.ts"

/**
 * Exporting a group to one JSON file, and importing such a file as a new group (#230). The owner
 * downloads the file; anyone who may create a group imports it. An import never touches an
 * existing group: it creates a new one, with a new id for every entity in the file. Each aggregate
 * joins by registering itself (`docs/aggregates.md`, "Making an aggregate exportable").
 */

/** What the `format` field of every export file says, so an import can tell it is one. */
export const GROUP_EXPORT_FORMAT = "seed.group-export"

/**
 * The version of the file this code writes and reads. A file with a higher number comes from a
 * newer app and is refused; raise it only when an older reader would misread the new file.
 */
export const GROUP_EXPORT_VERSION = 1

/**
 * The largest file an import takes, in bytes: the 5 MiB ceiling of the API's bounded body reader
 * (`DEFAULT_MAX_BYTES` of `@spy4x/net/bounded-body`), which no other route goes beyond.
 */
export const GROUP_IMPORT_MAX_BYTES = 5 * 1024 * 1024

/** The most problems a refused file reports one by one; the rest are only counted. */
export const GROUP_IMPORT_PROBLEMS_MAX = 20

/** The audit and change events an export and an import write. */
export const GROUP_FILE_EVENTS = {
  exported: "group.exported",
  imported: "group.imported",
} as const

/** The group's own settings, as the file holds them: no member, invitation, plan or secret. */
export interface GroupExportSettings {
  name: string
  description: string
  color: GroupColor | null
  emoji: string | null
}

/** Why a file cannot be imported. The app words each one; see `libs/ui/group-import-screen.tsx`. */
export type GroupImportProblem =
  /** Not JSON, or JSON that is not a group export. */
  | { kind: "not_export" }
  /** A version this app does not know yet. */
  | { kind: "newer_version" }
  /** Over {@link GROUP_IMPORT_MAX_BYTES}. */
  | { kind: "too_large"; maxBytes: number }
  /**
   * One part of the file is wrong. `where` names it ("Note 3", "Group settings", "Tags") and
   * `problem` says what is wrong with it.
   */
  | { kind: "invalid"; where: string; problem: string }

/**
 * A file the import refuses. Nothing is written. `problems` holds at most
 * {@link GROUP_IMPORT_PROBLEMS_MAX}; `total` counts them all.
 */
export class GroupImportError extends Error {
  readonly code = "IMPORT_REFUSED"
  constructor(
    public readonly problems: readonly GroupImportProblem[],
    public readonly total: number = problems.length,
  ) {
    super("The file cannot be imported")
    this.name = "GroupImportError"
  }
}

/** One kind of entity in a file, and how many of it, with the nouns its count is said with. */
export interface GroupFilePart {
  kind: string
  count: number
  /** The noun for one, such as `note`. */
  one: string
  /** The noun for any other count, such as `notes`. */
  other: string
}

/** What a checked file holds: the group's name and how many of each kind, in display order. */
export interface GroupImportSummary {
  name: string
  parts: GroupFilePart[]
}

/** The group an import created, and what went into it. */
export interface GroupImportResult {
  group: GroupSummary
  parts: GroupFilePart[]
}

/** Only the owner exports: the file holds everything the group keeps. */
export function canExportGroup(role: GroupRole): boolean {
  return canRead(role) && role === GroupRole.OWNER
}

/**
 * Throws unless `role` may export the group. `null` is a stranger, who is told the group does not
 * exist, so a stranger cannot learn that it does.
 */
export function assertCanExportGroup(role: GroupRole | null): void {
  if (role === null) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (!canExportGroup(role)) {
    throw new GroupError("ROLE_INSUFFICIENT", "Only the owner can export the group")
  }
}

/**
 * The file name of an export: the group's name in lower-case letters and digits joined by dashes,
 * then the UTC date, such as `family-2026-10-21.json`. A name with no such character gives
 * `group-…`.
 */
export function groupExportFileName(name: string, at: Date): string {
  const slug = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(
    /[^a-z0-9]+/g,
    "-",
  )
    .replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "")
  return `${slug || "group"}-${at.toISOString().slice(0, 10)}.json`
}

/** The body of `POST /api/groups/import`: the new group's name and the file, as one JSON value. */
export function parseGroupImportBody(value: unknown): { name: string | null; file: unknown } {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) || !("file" in value) ||
    !Object.keys(value).every((key) => key === "file" || key === "name")
  ) {
    throw new GroupError("INVALID_REQUEST", "Expected file, and at most name")
  }
  const { name, file } = value as { name?: unknown; file: unknown }
  if (name !== undefined && typeof name !== "string") {
    throw new GroupError("INVALID_REQUEST", "Group name must be a string")
  }
  return { name: name ?? null, file }
}

export interface GroupExportPayload {
  actor: Actor
  groupId: string
  requestId?: string
}

/** The file of an export: its name, and its JSON text in the pieces it is read in. */
export interface GroupExportResult {
  fileName: string
  chunks: AsyncIterable<string>
}

/**
 * Exports a group to one file. Only the owner may. It writes the `group.exported` audit event
 * before the file starts, so the log says who took the group's data even when the download stops
 * halfway.
 */
export class GroupExportCommand implements Command<GroupExportPayload, GroupExportResult> {
  __resultType?: GroupExportResult
  constructor(public data: GroupExportPayload) {}
}

export interface GroupImportCheckPayload {
  actor: Actor
  /** The file, parsed from JSON; anything else is refused as not an export. */
  file: unknown
}

/**
 * Checks a file the way an import would and says what it holds. It writes nothing. A file the
 * import would refuse is refused with {@link GroupImportError}, and one that does not fit a new
 * group's plan with the plan's refusal.
 */
export class GroupImportCheckQuery implements Query<GroupImportCheckPayload, GroupImportSummary> {
  __resultType?: GroupImportSummary
  constructor(public data: GroupImportCheckPayload) {}
}

export interface GroupImportPayload {
  actor: Actor
  file: unknown
  /** The new group's name; `null` keeps the name in the file. */
  name: string | null
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/**
 * Creates a new group from a file, owned by the actor, in one transaction: the group, then each
 * registered aggregate's entities under new ids, with the references between them mapped. It checks
 * the file again first, and refuses as {@link GroupImportCheckQuery} does.
 */
export class GroupImportCommand implements Command<GroupImportPayload, GroupImportResult> {
  __resultType?: GroupImportResult
  constructor(public data: GroupImportPayload) {}
}

/** What an import is given, besides the actor. */
export interface GroupImportInput {
  file: unknown
  /** The new group's name; `null` keeps the name in the file. */
  name: string | null
  requestId?: string
}

/**
 * Where a group's file is made and read. The handler checks who may export first; anyone may
 * import. `allowances` are the caps of the plan a new group starts on (`null`: no cap).
 */
export interface GroupFilePorter {
  /** Throws `GROUP_NOT_FOUND` for a group that is gone. Writes the `group.exported` event. */
  exportGroup(groupId: string, actorId: number, requestId?: string): Promise<GroupExportResult>
  /** Throws {@link GroupImportError}, or a `PlanError` when the file does not fit `allowances`. */
  check(file: unknown, allowances: MoveAllAllowances): GroupImportSummary
  /** Throws as {@link GroupFilePorter.check} does, or `INVALID_REQUEST` for a name it refuses. */
  importGroup(
    input: GroupImportInput,
    actorId: number,
    allowances: MoveAllAllowances,
  ): Promise<GroupImportResult>
}
