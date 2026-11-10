import { type } from "arktype"
import { assertRoomFor } from "@domain/billing"
import { canMutateNotes } from "@domain/groups"
import { NoteError, parseNoteRequest } from "@domain/notes"
import {
  type CsvParseError,
  decodeTextFile,
  parseCsv,
  sniffCsv,
} from "@spy4x/platform/universal/csv"
import { err, ok } from "@spy4x/platform/universal/result"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { cellOf, importKind } from "@server/imports/import-kind.ts"
import {
  insertNoteRows,
  PostgresNoteRepository,
  trashNoteRows,
} from "./postgres-note-repository.ts"

/** The most rows one notes file holds, the header not counted. */
export const NOTE_IMPORT_MAX_ROWS = 5_000

/** The most columns a notes file may have. */
export const NOTE_IMPORT_MAX_COLUMNS = 50

/** The largest notes file, in bytes. */
export const NOTE_IMPORT_MAX_BYTES = 2 * 1024 * 1024

/** The longest cell, in characters: a note's body. */
const MAX_CELL = 10_000

/** Header names, lower case, that guess each field's column. */
const HEADER_GUESSES: Record<string, RegExp> = {
  title: /^(title|name|subject|heading)$/,
  body: /^(body|text|content|note|notes|description)$/,
}

const noteRowSchema = type({ title: `string`, body: `string` })

/**
 * Seed's own import kind: notes from a CSV file, one note per row (`docs/imports.md`). The file may
 * be UTF-8, UTF-16 with its byte-order mark, or a single-byte encoding; its delimiter and header
 * are guessed (`@spy4x/platform/universal/csv`). A row needs a title; its body is optional. Cells
 * are stored as the text they are: a cell that looks like a formula or HTML stays that text. Undo
 * moves the batch's notes to the trash.
 */
export const noteImportKind = importKind<{ title: string; body: string }>({
  id: `notes`,
  label: `Notes`,
  accept: [`.csv`, `.txt`],
  maxBytes: NOTE_IMPORT_MAX_BYTES,
  fields: [
    { key: `title`, label: `Title`, required: true },
    { key: `body`, label: `Body` },
  ],
  canCreate: canMutateNotes,
  read(bytes) {
    const { text } = decodeTextFile(bytes)
    // A binary file named `.csv` decodes to text with NUL bytes, which Postgres cannot store.
    if (hasUnstorableTextCharacters(text)) return err(`The file is not a text file.`)
    const { delimiter, header } = sniffCsv(text)
    const parsed = parseCsv(text, {
      delimiter,
      maxRows: NOTE_IMPORT_MAX_ROWS + 1,
      maxColumns: NOTE_IMPORT_MAX_COLUMNS,
      maxFieldLength: MAX_CELL,
    })
    if (!parsed.ok) return err(csvProblem(parsed.error))
    const all = parsed.value
    // The guess looks for numbers and dates under a header; a notes file has none, so a first row
    // that names a field is a header too.
    const named = (all[0] ?? []).some((cell) =>
      HEADER_GUESSES.title.test(cell.trim().toLowerCase())
    )
    const columns = header || named ? all[0] ?? null : null
    const rows = columns ? all.slice(1) : all
    if (rows.length === 0) return err(`The file has no rows to import.`)
    if (rows.length > NOTE_IMPORT_MAX_ROWS) {
      return err(
        `The file has more than ${NOTE_IMPORT_MAX_ROWS} rows. Split it into smaller files.`,
      )
    }
    return ok({ columns, rows, mapping: guessMapping(columns, rows) })
  },
  check(row, mapping) {
    try {
      const note = parseNoteRequest(noteRowSchema, {
        title: cellOf(row, mapping, `title`),
        body: cellOf(row, mapping, `body`),
      })
      return ok({ title: note.title.trim(), body: note.body })
    } catch (error) {
      if (error instanceof NoteError) return err([error.message])
      throw error
    }
  },
  async commit(tx, values, context) {
    const ids = await insertNoteRows(tx, context, values)
    const cap = context.allowances.maxNotes
    if (cap !== null && ids.length > 0) {
      const used = await new PostgresNoteRepository(tx).count(context.groupId) - 1
      assertRoomFor(`maxNotes`, cap, used, context.role)
    }
    return ids
  },
  async undo(tx, ids, context) {
    await trashNoteRows(tx, context, ids)
  },
})

/**
 * Each field's column: a header cell named like it, else the title in the first column and the
 * body in the second, when the file has one.
 */
function guessMapping(columns: string[] | null, rows: readonly string[][]): Record<string, number> {
  if (columns) {
    const mapping: Record<string, number> = {}
    for (const [key, pattern] of Object.entries(HEADER_GUESSES)) {
      const index = columns.findIndex((cell) => pattern.test(cell.trim().toLowerCase()))
      if (index >= 0) mapping[key] = index
    }
    if (mapping.title !== undefined) return mapping
  }
  const wide = (columns?.length ?? 0) > 1 || rows.some((row) => row.length > 1)
  return wide ? { title: 0, body: 1 } : { title: 0 }
}

/** Why the CSV could not be read, in words, with the line a text editor shows. */
function csvProblem(problem: CsvParseError): string {
  switch (problem.type) {
    case `too-many-rows`:
      return `The file has more than ${NOTE_IMPORT_MAX_ROWS} rows. Split it into smaller files.`
    case `too-many-columns`:
      return `Line ${problem.line} has more than ${problem.maxColumns} columns.`
    case `field-too-long`:
      return `A cell on line ${problem.line} is longer than ${problem.maxFieldLength} characters.`
    case `unclosed-quote`:
      return `A quote on line ${problem.line} is never closed.`
    case `malformed`:
      return `Line ${problem.line} is not valid CSV.`
  }
}
