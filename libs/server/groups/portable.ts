import type postgres from "postgres"
import { type } from "arktype"
import type { LimitKey } from "@domain/billing"
import {
  GROUP_EXPORT_FORMAT,
  GROUP_EXPORT_VERSION,
  GROUP_IMPORT_ENTRIES_MAX,
  GROUP_IMPORT_PROBLEMS_MAX,
  type GroupExportSettings,
  type GroupFilePart,
  GroupImportError,
  type GroupImportProblem,
  legacyExportColor,
  parseGroupColor,
  parseGroupDescription,
  parseGroupEmoji,
  parseGroupName,
} from "@domain/groups"
import { isRecord } from "@spy4x/platform/universal/is-record"

/** Every entity in an export file has an id, which the file's other entities name it by. */
export interface PortableEntry {
  id: string
}

/** What an aggregate's import needs, in the import's own transaction. */
export interface PortableContext {
  /** The new group. */
  groupId: string
  /** The importer, who owns the new group and is written as every entity's creator. */
  actorId: number
  /** The sequence of the change recorded for the import; every written row is stamped with it. */
  changeSequence: string
  /**
   * The new id of the entity of `kind` that the file named `fileId`, for an aggregate imported
   * before this one; `undefined` when the file had none.
   */
  newIdOf(kind: string, fileId: string): string | undefined
}

/**
 * An aggregate that joins export and import (`docs/aggregates.md`, "Making an aggregate
 * exportable"). The exporter reads it into the file, the importer checks every entry with `parse`
 * and `check` before anything is written, then calls `write` in one transaction, in the order of
 * the registry, so an aggregate other aggregates point at is written first.
 */
export interface PortableAggregate<E extends PortableEntry = PortableEntry> {
  /** Its key in the file's `aggregates`, such as `notes`. Never rename it: files keep it. */
  kind: string
  /** The nouns its count is said with: `note`, `notes`. */
  one: string
  other: string
  /** The plan cap its count goes under, when a plan limits it; a new group's plan is checked. */
  limit?: LimitKey
  /** Checks one entry of a file and returns it. Throws with a message that says what is wrong. */
  parse(value: unknown): E
  /** What is wrong across the file's entries, by index (`null`: the entries as a whole). */
  check?(entries: readonly E[]): readonly { index: number | null; problem: string }[]
  /** The group's entities, in pages, for the file. Never a person, a secret or a deleted row. */
  read(sql: postgres.Sql, groupId: string): AsyncIterable<readonly E[]>
  /**
   * Writes the entries into the new group under new UUID v7 ids, mapping what they name through
   * `context.newIdOf`, and answers the new id of each by its id in the file.
   */
  write(
    sql: postgres.TransactionSql,
    entries: readonly E[],
    context: PortableContext,
  ): Promise<ReadonlyMap<string, string>>
}

/** Registers a typed aggregate in the registry, which holds them all under one type. */
export function portable<E extends PortableEntry>(
  aggregate: PortableAggregate<E>,
): PortableAggregate {
  return aggregate as unknown as PortableAggregate
}

/** A file that passed every check: the group's settings and each aggregate's entries. */
export interface ParsedGroupFile {
  settings: GroupExportSettings
  /** By kind, in the order of the registry; a kind the file left out has no entries. */
  entries: ReadonlyMap<string, readonly PortableEntry[]>
}

const FILE_KEYS = ["format", "version", "exportedAt", "group", "aggregates"]
const SETTINGS_KEYS = ["name", "description", "color", "emoji"]
const isoDate = type("string.date.iso")

/** `Note`, from `note`. */
function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The first line of an error's message: arktype puts one problem on each line. */
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.split("\n")[0]
}

/**
 * Checks a whole export file against every registered aggregate and answers it parsed, or throws
 * {@link GroupImportError} with the problems found. Reading stops at
 * {@link GROUP_IMPORT_PROBLEMS_MAX} problems, and a list longer than
 * {@link GROUP_IMPORT_ENTRIES_MAX} is refused unread. A file that is not an export, or is from a
 * newer version, is refused before its parts are read. Nothing here reads the database.
 */
export function parseGroupFile(
  value: unknown,
  aggregates: readonly PortableAggregate[],
): ParsedGroupFile {
  if (!isRecord(value) || value.format !== GROUP_EXPORT_FORMAT) {
    throw new GroupImportError([{ kind: "not_export" }])
  }
  const { version } = value
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new GroupImportError([{ kind: "not_export" }])
  }
  if (version > GROUP_EXPORT_VERSION) throw new GroupImportError([{ kind: "newer_version" }])

  const problems: GroupImportProblem[] = []
  const report: Report = (where, problem) => {
    if (problems.length < GROUP_IMPORT_PROBLEMS_MAX) {
      problems.push({ kind: "invalid", where, problem })
    }
  }
  report.full = () => problems.length >= GROUP_IMPORT_PROBLEMS_MAX

  for (const key of Object.keys(value)) {
    if (!FILE_KEYS.includes(key)) {
      report("The file", `it holds "${key}", which this app does not know`)
    }
  }
  if (isoDate(value.exportedAt) instanceof type.errors) {
    report("The file", "exportedAt must be a date and time")
  }

  const settings = parseSettings(value.group, report)

  const parts = value.aggregates
  const entries = new Map<string, readonly PortableEntry[]>()
  if (!isRecord(parts)) {
    report("The file", "aggregates must be an object")
  } else {
    const known = new Set(aggregates.map((aggregate) => aggregate.kind))
    for (const kind of Object.keys(parts)) {
      if (!known.has(kind)) report("The file", `it holds "${kind}", which this app does not know`)
    }
    for (const aggregate of aggregates) {
      if (report.full()) break
      entries.set(aggregate.kind, parseEntries(aggregate, parts[aggregate.kind] ?? [], report))
    }
  }

  if (problems.length > 0) throw new GroupImportError(problems)
  return { settings: settings!, entries }
}

/** Records one problem; `full` says the file has as many as it reports, so reading may stop. */
interface Report {
  (where: string, problem: string): void
  full(): boolean
}

function parseSettings(
  value: unknown,
  report: Report,
): GroupExportSettings | null {
  const where = "Group settings"
  if (!isRecord(value)) {
    report(where, "group must be an object")
    return null
  }
  for (const key of Object.keys(value)) {
    if (!SETTINGS_KEYS.includes(key)) report(where, `"${key}" is not a setting this app knows`)
  }
  const read = <T>(parse: () => T): T | null => {
    try {
      return parse()
    } catch (error) {
      report(where, messageOf(error))
      return null
    }
  }
  const name = read(() => parseGroupName(value.name))
  const description = read(() => parseGroupDescription(value.description ?? ""))
  const color = read(() => parseGroupColor(legacyExportColor(value.color ?? null)))
  const emoji = read(() => parseGroupEmoji(value.emoji ?? null))
  return name === null ? null : { name, description: description ?? "", color, emoji }
}

function parseEntries(
  aggregate: PortableAggregate,
  value: unknown,
  report: Report,
): PortableEntry[] {
  const label = capitalized(aggregate.one)
  if (!Array.isArray(value)) {
    report(capitalized(aggregate.other), `${aggregate.kind} must be a list`)
    return []
  }
  // Counted before a single entry is read: each read is synchronous work on the API's thread.
  if (value.length > GROUP_IMPORT_ENTRIES_MAX) {
    report(
      capitalized(aggregate.other),
      `the file holds ${value.length} ${aggregate.other}, and an import takes at most ` +
        `${GROUP_IMPORT_ENTRIES_MAX}`,
    )
    return []
  }
  const parsed: PortableEntry[] = []
  const ids = new Set<string>()
  let valid = true
  for (const [index, item] of value.entries()) {
    if (report.full()) return parsed
    try {
      const entry = aggregate.parse(item)
      if (ids.has(entry.id)) {
        report(`${label} ${index + 1}`, `another ${aggregate.one} in the file has the same id`)
        valid = false
      }
      ids.add(entry.id)
      parsed.push(entry)
    } catch (error) {
      report(`${label} ${index + 1}`, messageOf(error))
      valid = false
    }
  }
  // The checks across entries read every entry, so they run only once each one is valid.
  if (valid) {
    for (const { index, problem } of aggregate.check?.(parsed) ?? []) {
      report(index === null ? capitalized(aggregate.other) : `${label} ${index + 1}`, problem)
    }
  }
  return parsed
}

/**
 * What a parsed file holds, in display order: the registry's order reversed, so the entities a
 * person works with (notes) come before the ones they are sorted by (tags).
 */
export function groupFileParts(
  file: ParsedGroupFile,
  aggregates: readonly PortableAggregate[],
): GroupFilePart[] {
  return [...aggregates].reverse().map((aggregate) => ({
    kind: aggregate.kind,
    count: file.entries.get(aggregate.kind)?.length ?? 0,
    one: aggregate.one,
    other: aggregate.other,
  }))
}

/**
 * The text of a group's export file, in pieces: the header and the settings first, then every
 * registered aggregate's entries page by page, so a large group is never held in memory whole.
 */
export async function* writeGroupFile(
  sql: postgres.Sql,
  groupId: string,
  settings: GroupExportSettings,
  aggregates: readonly PortableAggregate[],
  now: Date,
): AsyncGenerator<string> {
  const header = {
    format: GROUP_EXPORT_FORMAT,
    version: GROUP_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    group: settings,
  }
  yield `${JSON.stringify(header).slice(0, -1)},"aggregates":{`
  for (const [position, aggregate] of aggregates.entries()) {
    yield `${position > 0 ? "," : ""}${JSON.stringify(aggregate.kind)}:[`
    let first = true
    for await (const page of aggregate.read(sql, groupId)) {
      if (page.length === 0) continue
      yield `${first ? "" : ","}${page.map((entry) => JSON.stringify(entry)).join(",")}`
      first = false
    }
    yield "]"
  }
  yield "}}"
}
