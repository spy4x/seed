import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type postgres from "postgres"
import { unzipSync } from "fflate"
import { parseCsv } from "@spy4x/platform/universal/csv"
import { PlanError } from "@domain/billing"
import {
  GROUP_EXPORT_FORMAT,
  GROUP_EXPORT_VERSION,
  GROUP_IMPORT_ENTRIES_MAX,
  GROUP_IMPORT_PROBLEMS_MAX,
  GroupImportError,
} from "@domain/groups"
import { TAG_MAX_PER_GROUP } from "@domain/tags"
import { notePortable } from "@server/notes/note-portable.ts"
import { tagPortable } from "@server/tags/tag-portable.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { translatorFor } from "../mail/mail.ts"
import {
  groupFileParts,
  parseGroupFile,
  portable,
  type PortableAggregate,
  writeGroupFile,
  writeGroupSpreadsheets,
} from "./portable.ts"
import { PostgresGroupPorter } from "./postgres-group-porter.ts"

const AGGREGATES = [tagPortable, notePortable]
const at = "2026-10-01T09:00:00.000Z"

function tag(name: string, id = uuidV7()) {
  return { id, name, color: "#1d4ed8", createdAt: at, updatedAt: at }
}

function note(title: string, tagIds: string[] = [], id = uuidV7()) {
  return { id, title, body: "Body", tagIds, createdAt: at, updatedAt: at }
}

function file(aggregates: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    format: GROUP_EXPORT_FORMAT,
    version: GROUP_EXPORT_VERSION,
    exportedAt: at,
    group: { name: "Family", description: "", color: "#15803d", emoji: null },
    aggregates,
    ...overrides,
  }
}

/** The problems a refused file reports, or a failure when it is accepted. */
function problemsOf(value: unknown) {
  try {
    parseGroupFile(value, AGGREGATES)
  } catch (error) {
    if (error instanceof GroupImportError) return { problems: error.problems, total: error.total }
    throw error
  }
  throw new Error("The file was accepted")
}

describe("parseGroupFile", () => {
  it("accepts a valid file and keeps every entry by kind", () => {
    const blue = tag("Blue")
    const parsed = parseGroupFile(
      file({ tags: [blue], notes: [note("One", [blue.id]), note("Two")] }),
      AGGREGATES,
    )
    expect(parsed.settings).toEqual({
      name: "Family",
      description: "",
      color: "#15803d",
      emoji: null,
    })
    expect(parsed.entries.get("tags")?.length).toBe(1)
    expect(parsed.entries.get("notes")?.length).toBe(2)
    expect(groupFileParts(parsed, AGGREGATES).map((part) => [part.kind, part.count])).toEqual([
      ["notes", 2],
      ["tags", 1],
    ])
  })

  it("keeps the group's time zone, and reads a file without one as having none", () => {
    const zoned = file({}, {
      group: { name: "Family", description: "", color: null, emoji: null, timeZone: "Asia/Tokyo" },
    })
    expect(parseGroupFile(zoned, AGGREGATES).settings.timeZone).toBe("Asia/Tokyo")
    expect("timeZone" in parseGroupFile(file({}), AGGREGATES).settings).toBe(false)
  })

  it("refuses an unknown time zone as a problem of the group's settings", () => {
    const { problems } = problemsOf(
      file({}, { group: { name: "Family", timeZone: "Mars/Olympus" } }),
    )
    expect(problems).toEqual([expect.objectContaining({ place: { part: "settings" } })])
  })

  it("reads a version 1 file's old colour names as the hex the migration gave them", () => {
    const parsed = parseGroupFile(
      file({ tags: [{ ...tag("Work"), color: "blue" }] }, {
        version: 1,
        group: { name: "Family", description: "", color: "green", emoji: null },
      }),
      AGGREGATES,
    )
    expect(parsed.settings.color).toBe("#15803d")
    expect(
      parsed.entries.get("tags")?.map((entry) => (entry as unknown as { color: string }).color),
    )
      .toEqual(["#1d4ed8"])
  })

  it("still refuses a colour that is neither hex nor an old colour name", () => {
    expect(
      problemsOf(file({ tags: [{ ...tag("Work"), color: "teal" }] }, {
        group: { name: "Family", description: "", color: "lime", emoji: null },
      })).problems.length,
    ).toBe(2)
  })

  it("skips a part whose kind the app switched off, unread, even a broken one", () => {
    const parsed = parseGroupFile(
      file({ tags: [tag("Work")], notes: [{ title: "" }, "not a note"] }),
      [tagPortable],
      ["notes"],
    )
    expect([...parsed.entries.keys()]).toEqual(["tags"])
    expect(parsed.entries.get("tags")).toHaveLength(1)
  })

  it("treats a kind the file leaves out as empty", () => {
    expect(parseGroupFile(file({ notes: [note("One")] }), AGGREGATES).entries.get("tags"))
      .toEqual([])
  })

  it("refuses a value that is not a group export", () => {
    const others = [null, [], "text", { format: "other", version: 1 }, file({}, { version: "1" })]
    for (const value of others) {
      expect(problemsOf(value).problems).toEqual([{ kind: "not_export" }])
    }
  })

  it("refuses a file from a newer version before reading its parts", () => {
    expect(problemsOf(file({ notes: "broken" }, { version: GROUP_EXPORT_VERSION + 1 })).problems)
      .toEqual([{ kind: "newer_version" }])
  })

  it("names the entry and the field of an invalid note, counting from one", () => {
    const { problems } = problemsOf(file({ notes: [note("Fine"), { ...note("x"), title: 5 }] }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({
      kind: "invalid",
      where: "Note 2",
      place: { part: "notes", index: 2 },
      issue: { code: "domain", field: "title" },
    })
    expect((problems[0] as { problem: string }).problem).toContain("title")
  })

  it("refuses a note over the create rules, such as an empty title, naming the rule by code", () => {
    expect(problemsOf(file({ notes: [note("   ")] })).problems[0]).toMatchObject({
      where: "Note 1",
      place: { part: "notes", index: 1 },
      issue: { code: "required", field: "title" },
    })
  })

  it("names an unknown part and an unknown setting by place and code, with the key", () => {
    const { problems } = problemsOf(file({ invoices: [] }, { group: { name: "A", pink: true } }))
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        place: { part: "file" },
        issue: { code: "unknownKey", values: { key: "invoices" } },
      }),
      expect.objectContaining({
        place: { part: "settings" },
        issue: { code: "unknownKey", values: { key: "pink" } },
      }),
    ]))
  })

  it("refuses an unknown part, an unknown field and bad settings", () => {
    const { problems } = problemsOf(
      file({ invoices: [] }, { extra: true, group: { name: "", color: "pink" } }),
    )
    expect(problems.map((problem) => (problem as { where: string }).where).sort()).toEqual([
      "Group settings",
      "Group settings",
      "The file",
      "The file",
    ])
  })

  it("refuses two tags of the same name, without regard to case", () => {
    expect(problemsOf(file({ tags: [tag("Home"), tag("home")] })).problems).toEqual([
      {
        kind: "invalid",
        where: "Tag 2",
        problem: "another tag in the file is called this",
        place: { part: "tags", index: 2 },
        issue: { code: "duplicateTagName" },
      },
    ])
  })

  it("refuses more tags than a group holds", () => {
    const tags = Array.from({ length: TAG_MAX_PER_GROUP + 1 }, (_, index) => tag(`Tag ${index}`))
    expect(problemsOf(file({ tags })).problems[0]).toMatchObject({
      where: "Tags",
      place: { part: "tags" },
      issue: {
        code: "tooManyTags",
        values: { count: TAG_MAX_PER_GROUP + 1, max: TAG_MAX_PER_GROUP },
      },
    })
  })

  it("refuses two entries of one kind with the same id", () => {
    const id = uuidV7()
    expect(problemsOf(file({ notes: [note("A", [], id), note("B", [], id)] })).problems[0])
      .toMatchObject({ where: "Note 2", issue: { code: "duplicateId" } })
  })

  it("stops reading entries once it has found as many problems as it reports", () => {
    let read = 0
    const counting = portable({
      ...notePortable,
      parse: (value) => {
        read++
        return notePortable.parse(value)
      },
    })
    const notes = Array.from({ length: GROUP_IMPORT_PROBLEMS_MAX + 500 }, () => ({ title: 1 }))
    try {
      parseGroupFile(file({ notes, tags: [] }), [tagPortable, counting])
      throw new Error("The file was accepted")
    } catch (error) {
      if (!(error instanceof GroupImportError)) throw error
      expect(error.problems).toHaveLength(GROUP_IMPORT_PROBLEMS_MAX)
      expect(error.total).toBe(GROUP_IMPORT_PROBLEMS_MAX)
    }
    expect(read).toBe(GROUP_IMPORT_PROBLEMS_MAX)
  })

  it("refuses a list longer than an import takes without reading any entry of it", () => {
    let read = 0
    const counting = portable({
      ...notePortable,
      parse: (value) => {
        read++
        return notePortable.parse(value)
      },
    })
    const notes = Array.from({ length: GROUP_IMPORT_ENTRIES_MAX + 1 }, () => ({}))
    try {
      parseGroupFile(file({ notes, tags: [] }), [tagPortable, counting])
      throw new Error("The file was accepted")
    } catch (error) {
      if (!(error instanceof GroupImportError)) throw error
      expect(error.problems).toEqual([{
        kind: "invalid",
        where: "Notes",
        problem: `the file holds ${
          GROUP_IMPORT_ENTRIES_MAX + 1
        } notes, and an import takes at most ${GROUP_IMPORT_ENTRIES_MAX}`,
        place: { part: "notes" },
        issue: {
          code: "tooManyEntries",
          values: { count: GROUP_IMPORT_ENTRIES_MAX + 1, max: GROUP_IMPORT_ENTRIES_MAX },
        },
      }])
    }
    expect(read).toBe(0)
  })
})

describe("writeGroupFile", () => {
  it("writes a file that parseGroupFile reads back whole", async () => {
    const blue = tag("Blue")
    const pages: Record<string, unknown[][]> = {
      tags: [[blue]],
      notes: [[note("One", [blue.id])], [], [note("Two")]],
    }
    const reading: PortableAggregate[] = AGGREGATES.map((aggregate) => ({
      ...aggregate,
      async *read() {
        for (const page of pages[aggregate.kind]) yield page as never
      },
    }))
    const settings = { name: "Family", description: "Ours", color: null, emoji: "🏡" }
    let text = ""
    for await (
      const piece of writeGroupFile(
        null as unknown as postgres.Sql,
        uuidV7(),
        settings,
        reading,
        new Date(at),
      )
    ) {
      text += piece
    }
    const parsed = parseGroupFile(JSON.parse(text), AGGREGATES)
    expect(parsed.settings).toEqual(settings)
    expect(
      parsed.entries.get("notes")?.map((entry) => (entry as unknown as { title: string }).title),
    )
      .toEqual(["One", "Two"])
    expect(parsed.entries.get("tags")?.length).toBe(1)
  })
})

/** The registered aggregates, each reading `pages[kind]` instead of the database. */
function reading(pages: Record<string, unknown[][]>): PortableAggregate[] {
  return AGGREGATES.map((aggregate) => ({
    ...aggregate,
    async *read() {
      for (const page of pages[aggregate.kind] ?? []) yield page as never
    },
  }))
}

/** Every piece of a spreadsheet ZIP, joined, unzipped into its files' text by name. */
async function spreadsheets(
  aggregates: readonly PortableAggregate[],
  language: "en" | "de" = "en",
): Promise<Record<string, string>> {
  const pieces: Uint8Array[] = []
  for await (
    const piece of writeGroupSpreadsheets(
      null as unknown as postgres.Sql,
      uuidV7(),
      aggregates,
      translatorFor(language),
      new Date(at),
    )
  ) {
    pieces.push(piece)
  }
  const zip = new Uint8Array(await new Blob(pieces as BlobPart[]).arrayBuffer())
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
  return Object.fromEntries(
    Object.entries(unzipSync(zip)).map(([name, bytes]) => [name, decoder.decode(bytes)]),
  )
}

/** The rows of a CSV file, as a spreadsheet reads them. */
function cells(text: string): string[][] {
  const parsed = parseCsv(text)
  if (!parsed.ok) throw new Error(`Not a CSV file: ${JSON.stringify(parsed.error)}`)
  return parsed.value
}

describe("writeGroupSpreadsheets", () => {
  it("writes notes.csv with the person's headings, a byte order mark and accents intact", async () => {
    const files = await spreadsheets(
      reading({ notes: [[{ ...note("Café crème"), body: "Größe über ½" }]] }),
      "de",
    )
    const text = files["notes.csv"]
    expect(text.startsWith("\uFEFF")).toBe(true)
    expect(text.endsWith("\r\n")).toBe(true)
    expect(text.split("\r\n")[0]).toBe("\uFEFFID,Titel,Text,Tag-IDs,Erstellt,Zuletzt geändert")
    expect(cells(text)[1].slice(1)).toEqual(["Café crème", "Größe über ½", "", at, at])
  })

  it("writes a note text that starts with =HYPERLINK( as a text cell, not a formula", async () => {
    const payload = `=HYPERLINK("https://evil.example","Click")`
    const files = await spreadsheets(reading({ notes: [[{ ...note(payload), body: payload }]] }))
    const [, row] = cells(files["notes.csv"])
    expect(row[1]).toBe(`'${payload}`)
    expect(row[2]).toBe(`'${payload}`)
  })

  it("lists an aggregate with no spreadsheet in README.txt and leaves its file out", async () => {
    const files = await spreadsheets(reading({ tags: [[tag("Blue")]], notes: [] }), "de")
    expect(Object.keys(files).sort()).toEqual(["README.txt", "notes.csv"])
    expect(files["README.txt"]).toContain("Nicht als Tabelle verfügbar")
    expect(files["README.txt"]).toContain("\n- tags\n")
  })

  it("streams a 50,000-note group page by page, never reading it all before the first bytes", async () => {
    const pages = 100
    let read = 0
    const notes: PortableAggregate = {
      ...notePortable,
      async *read() {
        for (let page = 0; page < pages; page++) {
          read++
          yield Array.from({ length: 500 }, (_, index) => note(`Note ${page}-${index}`)) as never
        }
      },
    }
    const readAtPiece: number[] = []
    const pieces: Uint8Array[] = []
    for await (
      const piece of writeGroupSpreadsheets(
        null as unknown as postgres.Sql,
        uuidV7(),
        [notes],
        translatorFor("en"),
        new Date(at),
      )
    ) {
      readAtPiece.push(read)
      pieces.push(piece)
    }
    expect(readAtPiece[0]).toBeLessThan(pages)
    expect(new Set(readAtPiece).size).toBeGreaterThan(pages / 2)
    const zip = new Uint8Array(await new Blob(pieces as BlobPart[]).arrayBuffer())
    const text = new TextDecoder().decode(unzipSync(zip)["notes.csv"])
    expect(text.split("\r\n").length).toBe(1 + 50_000 + 1)
  })

  it("fails its first piece when the first page cannot be read", async () => {
    const failing: PortableAggregate = {
      ...notePortable,
      // deno-lint-ignore require-yield
      async *read() {
        throw new Error("the database is down")
      },
    }
    const pieces = writeGroupSpreadsheets(
      null as unknown as postgres.Sql,
      uuidV7(),
      [failing],
      translatorFor("en"),
      new Date(at),
    )
    await expect(pieces.next()).rejects.toThrow("the database is down")
  })
})

describe("PostgresGroupPorter.check", () => {
  const porter = new PostgresGroupPorter(null as unknown as postgres.Sql, AGGREGATES)

  it("says what the file holds", () => {
    expect(porter.check(file({ notes: [note("A")] }), { maxNotes: null })).toEqual({
      name: "Family",
      parts: [
        { kind: "notes", count: 1, one: "note", other: "notes" },
        { kind: "tags", count: 0, one: "tag", other: "tags" },
      ],
    })
  })

  it("refuses a file with more notes than a new group's plan holds", () => {
    const notes = [note("A"), note("B"), note("C")]
    expect(() => porter.check(file({ notes }), { maxNotes: 2 })).toThrow(PlanError)
    expect(porter.check(file({ notes }), { maxNotes: 3 }).parts[0].count).toBe(3)
  })
})
