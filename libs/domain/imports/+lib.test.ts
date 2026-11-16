import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupRole } from "@domain/groups"
import {
  assertCanSeeImport,
  IMPORT_CHOICE_FIELDS_MAX,
  IMPORT_FILE_NAME_MAX_LENGTH,
  IMPORT_OPTIONS_MAX_BYTES,
  IMPORT_OPTIONS_MAX_KEYS,
  IMPORT_REVIEW_ROWS_MAX,
  importCommitBodySchema,
  ImportError,
  importMappingBodySchema,
  importUpload,
  importUploadQuerySchema,
  parseImportFileName,
  parseImportOptions,
  parseImportRequest,
} from "./+lib.ts"

/** The code of the `ImportError` that `run` throws, or `null` when it throws none. */
function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    if (error instanceof ImportError) return error.code
    throw error
  }
}

describe("who sees an import", () => {
  it("shows it to its starter, whatever their role", () => {
    expect(codeOf(() => assertCanSeeImport(GroupRole.VIEWER, 7, 7))).toBeNull()
  })

  it("shows another member's import to an admin and the owner", () => {
    expect(codeOf(() => assertCanSeeImport(GroupRole.ADMIN, 7, 8))).toBeNull()
    expect(codeOf(() => assertCanSeeImport(GroupRole.OWNER, 7, 8))).toBeNull()
  })

  it("tells an editor another member's import does not exist", () => {
    expect(codeOf(() => assertCanSeeImport(GroupRole.EDITOR, 7, 8))).toBe(`ITEM_NOT_FOUND`)
  })

  it("tells a stranger the group does not exist", () => {
    expect(codeOf(() => assertCanSeeImport(null, 7, 7))).toBe(`GROUP_NOT_FOUND`)
  })
})

describe("an upload's request", () => {
  it("takes a kind of lower case words and a file name", () => {
    expect(parseImportRequest(importUploadQuerySchema, { kind: `notes`, name: `a.csv` }))
      .toEqual({ kind: `notes`, name: `a.csv` })
  })

  it("refuses a kind with capitals and a missing name, naming the fields", () => {
    try {
      parseImportRequest(importUploadQuerySchema, { kind: `Notes` })
      throw new Error(`not refused`)
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError)
      expect(Object.keys((error as ImportError).fields ?? {}).sort()).toEqual([`kind`, `name`])
    }
  })

  it("trims a file name and cuts it to the longest kept", () => {
    expect(parseImportFileName(`  bank.csv `)).toBe(`bank.csv`)
    expect(Array.from(parseImportFileName(`é`.repeat(300))).length)
      .toBe(IMPORT_FILE_NAME_MAX_LENGTH)
  })

  it("refuses a file name with direction or control characters", () => {
    expect(codeOf(() => parseImportFileName(`invoice‮vsc.exe`))).toBe(`INVALID_REQUEST`)
    expect(codeOf(() => parseImportFileName(`a\u0000.csv`))).toBe(`INVALID_REQUEST`)
    expect(codeOf(() => parseImportFileName(`   `))).toBe(`INVALID_REQUEST`)
  })

  it("fingerprints the bytes by their digest, never by the bytes themselves", async () => {
    const upload = await importUpload(new TextEncoder().encode(`abc`))
    expect(JSON.stringify({ file: upload })).toBe(
      `{"file":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}`,
    )
  })
})

describe("a mapping's body", () => {
  it("takes field keys to whole column numbers", () => {
    expect(parseImportRequest(importMappingBodySchema, { mapping: { title: 0, body: 2 } }))
      .toEqual({ mapping: { title: 0, body: 2 } })
  })

  it("refuses a negative, fractional or text column", () => {
    for (const column of [-1, 1.5, `1`]) {
      expect(
        codeOf(() => parseImportRequest(importMappingBodySchema, { mapping: { title: column } })),
      )
        .toBe(`INVALID_REQUEST`)
    }
  })
})

describe("an upload's options", () => {
  it("are absent without the query, and a JSON object of text otherwise", () => {
    expect(parseImportOptions(undefined)).toBeUndefined()
    expect(parseImportOptions(`{"accountId":"a1"}`)).toEqual({ accountId: `a1` })
  })

  it("takes exactly the most bytes and keys, and refuses one more of either", () => {
    const filler = `{"a":"${`x`.repeat(IMPORT_OPTIONS_MAX_BYTES - 8)}"}`
    expect(new TextEncoder().encode(filler).byteLength).toBe(IMPORT_OPTIONS_MAX_BYTES)
    expect(codeOf(() => parseImportOptions(filler))).toBeNull()
    expect(codeOf(() => parseImportOptions(filler.replace(`"a"`, `"ab"`))))
      .toBe(`INVALID_REQUEST`)
    const keys = (count: number) =>
      JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, `v`])))
    expect(codeOf(() => parseImportOptions(keys(IMPORT_OPTIONS_MAX_KEYS)))).toBeNull()
    expect(codeOf(() => parseImportOptions(keys(IMPORT_OPTIONS_MAX_KEYS + 1))))
      .toBe(`INVALID_REQUEST`)
  })

  it("counts bytes, not characters", () => {
    const wide = `{"a":"${`é`.repeat(IMPORT_OPTIONS_MAX_BYTES / 2)}"}`
    expect(wide.length).toBeLessThan(IMPORT_OPTIONS_MAX_BYTES + 10)
    expect(codeOf(() => parseImportOptions(wide))).toBe(`INVALID_REQUEST`)
  })

  it("refuses text that is not JSON, an array, a number value and a key that is no field key", () => {
    for (
      const raw of [`{`, `[]`, `["a"]`, `"a"`, `null`, `{"a":1}`, `{"1a":"x"}`, `{"__proto__":"x"}`]
    ) {
      expect([raw, codeOf(() => parseImportOptions(raw))]).toEqual([raw, `INVALID_REQUEST`])
    }
  })
})

describe("a save's body", () => {
  it("takes a mapping alone, or with choices of text per row number", () => {
    expect(parseImportRequest(importCommitBodySchema, { mapping: { title: 0 } }))
      .toEqual({ mapping: { title: 0 } })
    expect(
      parseImportRequest(importCommitBodySchema, {
        mapping: { title: 0 },
        choices: { "1": { category: `c1` }, "12": { category: `` } },
      }),
    ).toEqual({
      mapping: { title: 0 },
      choices: { "1": { category: `c1` }, "12": { category: `` } },
    })
  })

  it("refuses a row number below 1 or not a number, a long or non-text value and too many fields", () => {
    const fields = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, `v`]))
    expect(
      codeOf(() =>
        parseImportRequest(importCommitBodySchema, {
          mapping: {},
          choices: { "1": fields(IMPORT_CHOICE_FIELDS_MAX) },
        })
      ),
    ).toBeNull()
    for (
      const choices of [
        { "0": { a: `v` } },
        { "-1": { a: `v` } },
        { "x": { a: `v` } },
        { "1": { a: `v`.repeat(201) } },
        { "1": { a: 1 } },
        { "1": fields(IMPORT_CHOICE_FIELDS_MAX + 1) },
      ]
    ) {
      expect([
        choices,
        codeOf(() => parseImportRequest(importCommitBodySchema, { mapping: {}, choices })),
      ])
        .toEqual([choices, `INVALID_REQUEST`])
    }
  })

  it("takes keep as whole row numbers from 1, up to the review's row cap", () => {
    const keep = Array.from({ length: IMPORT_REVIEW_ROWS_MAX }, (_, i) => i + 1)
    expect(parseImportRequest(importCommitBodySchema, { mapping: {}, keep }))
      .toEqual({ mapping: {}, keep })
  })

  it("refuses keep with a row below 1, a fraction, text, or more rows than the review answers", () => {
    for (
      const keep of [
        [0],
        [-1],
        [1.5],
        [`1`],
        `1`,
        Array.from({ length: IMPORT_REVIEW_ROWS_MAX + 1 }, (_, i) => i + 1),
      ]
    ) {
      expect([
        keep,
        codeOf(() => parseImportRequest(importCommitBodySchema, { mapping: {}, keep })),
      ]).toEqual([keep, `INVALID_REQUEST`])
    }
  })
})
