import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupRole } from "@domain/groups"
import {
  assertCanSeeImport,
  IMPORT_FILE_NAME_MAX_LENGTH,
  ImportError,
  importMappingBodySchema,
  importUpload,
  importUploadQuerySchema,
  parseImportFileName,
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
