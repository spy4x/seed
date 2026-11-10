import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupRole } from "@domain/groups"
import { NOTE_TITLE_MAX_LENGTH } from "@domain/notes"
import { checkRows } from "@server/imports/import-kind.ts"
import { NOTE_IMPORT_MAX_COLUMNS, NOTE_IMPORT_MAX_ROWS, noteImportKind } from "./note-import.ts"

const utf8 = (text: string) => new TextEncoder().encode(text)

/** `text` as UTF-16 little-endian with its byte-order mark, as Excel saves "Unicode text". */
function utf16le(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes.set([0xff, 0xfe])
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    bytes[2 + index * 2] = code & 0xff
    bytes[3 + index * 2] = code >> 8
  }
  return bytes
}

async function read(bytes: Uint8Array) {
  const result = await noteImportKind.read(bytes)
  if (!result.ok) throw new Error(`not read: ${result.error}`)
  return result.value
}

describe("reading a notes file", () => {
  it("reads a header, guesses each field's column from its name and keeps the rows", async () => {
    const file = await read(utf8(`Tags,Body,Title\r\nx,First body,First\r\ny,,Second\r\n`))
    expect(file.columns).toEqual([`Tags`, `Body`, `Title`])
    expect(file.mapping).toEqual({ title: 2, body: 1 })
    expect(file.rows).toEqual([[`x`, `First body`, `First`], [`y`, ``, `Second`]])
  })

  it("reads a file without a header as title then body", async () => {
    const file = await read(utf8(`Buy milk,Two litres\nCall mum,\n`))
    expect(file.columns).toBeNull()
    expect(file.mapping).toEqual({ title: 0, body: 1 })
    expect(file.rows).toHaveLength(2)
  })

  it("reads UTF-16 with its byte-order mark and a semicolon delimiter", async () => {
    const file = await read(utf16le(`title;body\r\nПривет;Ünïcödé body\r\n`))
    expect(file.rows).toEqual([[`Привет`, `Ünïcödé body`]])
  })

  it("keeps a cell that looks like a formula or HTML as the text it is", async () => {
    const file = await read(utf8(`title,body\n"=HYPERLINK(""x"")",<img src=x onerror=alert(1)>\n`))
    const { values } = checkRows(noteImportKind, file.rows, file.mapping)
    expect(values).toEqual([{ title: `=HYPERLINK("x")`, body: `<img src=x onerror=alert(1)>` }])
  })

  it("refuses a file past the row or column limit, saying which", async () => {
    const rows = await noteImportKind.read(utf8(`title\n${`a\n`.repeat(NOTE_IMPORT_MAX_ROWS + 1)}`))
    expect(rows).toEqual({
      ok: false,
      error: expect.stringContaining(`${NOTE_IMPORT_MAX_ROWS} rows`),
    })
    const wide = await noteImportKind.read(utf8(`${`a,`.repeat(NOTE_IMPORT_MAX_COLUMNS)}a\n`))
    expect(wide).toEqual({ ok: false, error: expect.stringContaining(`columns`) })
  })

  it("refuses a file with only a header, and one whose quote never closes", async () => {
    expect(await noteImportKind.read(utf8(`title,body\n`)))
      .toEqual({ ok: false, error: `The file has no rows to import.` })
    expect(await noteImportKind.read(utf8(`title\n"open\n`)))
      .toEqual({ ok: false, error: expect.stringContaining(`never closed`) })
  })

  it("refuses a binary file named as a CSV, whose NUL bytes Postgres cannot store", async () => {
    expect(await noteImportKind.read(utf8(`title,body\nA\0B,x\n`)))
      .toEqual({ ok: false, error: `The file is not a text file.` })
  })
})

describe("checking a note row", () => {
  it("refuses a row without a title and one whose title is too long, in words", () => {
    const { result } = checkRows(noteImportKind, [[``, `body`], [
      `x`.repeat(NOTE_TITLE_MAX_LENGTH + 1),
    ]], {
      title: 0,
      body: 1,
    })
    expect(result.withErrors).toBe(2)
    expect(result.rows.map((row) => row.row)).toEqual([1, 2])
    expect(result.rows.every((row) => row.errors.length === 1)).toBe(true)
  })

  it("lets only an editor or above import notes", () => {
    expect(noteImportKind.canCreate(GroupRole.VIEWER)).toBe(false)
    expect(noteImportKind.canCreate(GroupRole.EDITOR)).toBe(true)
  })
})
