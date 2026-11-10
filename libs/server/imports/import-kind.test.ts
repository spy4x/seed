import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupRole } from "@domain/groups"
import {
  IMPORT_CHECK_ROWS_MAX,
  IMPORT_FILE_MAX_BYTES,
  IMPORT_ROW_ERRORS_MAX,
  ImportError,
} from "@domain/imports"
import { err, ok } from "@spy4x/platform/universal/result"
import {
  assertMapping,
  cellOf,
  checkRows,
  columnCount,
  type ImportKind,
  importKind,
  kindOf,
} from "./import-kind.ts"

/** A kind whose row needs a number in its `amount` column. */
function amounts(overrides: Partial<ImportKind<number>> = {}): ImportKind<number> {
  return {
    id: `amounts`,
    label: `Amounts`,
    accept: [`.csv`],
    maxBytes: 1024,
    fields: [{ key: `amount`, label: `Amount`, required: true }, { key: `memo`, label: `Memo` }],
    canCreate: (role) => role >= GroupRole.EDITOR,
    read: () => ok({ columns: null, rows: [], mapping: {} }),
    check: (row, mapping) => {
      const value = Number(cellOf(row, mapping, `amount`))
      return Number.isFinite(value) ? ok(value) : err([`Not a number`, `Still not a number`])
    },
    commit: () => Promise.resolve([]),
    undo: () => Promise.resolve(),
    ...overrides,
  }
}

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

describe("defining an import kind", () => {
  it("takes a valid kind and freezes it", () => {
    const kind = importKind(amounts())
    expect(kind.id).toBe(`amounts`)
    expect(Object.isFrozen(kind)).toBe(true)
  })

  it("refuses an id, an ending, a size or field keys that are not valid", () => {
    expect(() => importKind(amounts({ id: `Amounts` }))).toThrow(RangeError)
    expect(() => importKind(amounts({ accept: [] }))).toThrow(RangeError)
    expect(() => importKind(amounts({ accept: [`csv`] }))).toThrow(RangeError)
    expect(() => importKind(amounts({ maxBytes: IMPORT_FILE_MAX_BYTES + 1 }))).toThrow(RangeError)
    expect(() => importKind(amounts({ maxBytes: 0 }))).toThrow(RangeError)
    expect(() => importKind(amounts({ fields: [] }))).toThrow(RangeError)
    expect(() =>
      importKind(amounts({ fields: [{ key: `a`, label: `A` }, { key: `a`, label: `B` }] }))
    ).toThrow(RangeError)
  })

  it("finds a listed kind by id and refuses an unknown one", () => {
    const kind = importKind(amounts())
    expect(kindOf([kind], `amounts`)).toBe(kind)
    expect(codeOf(() => kindOf([kind], `invoices`))).toBe(`INVALID_REQUEST`)
  })
})

describe("a mapping", () => {
  const kind = importKind(amounts())

  it("passes when every required field is mapped to a column the file has", () => {
    expect(codeOf(() => assertMapping(kind, { amount: 1 }, 2))).toBeNull()
  })

  it("refuses a field the kind lacks, a column past the file, and an unmapped required field", () => {
    expect(codeOf(() => assertMapping(kind, { amount: 0, total: 1 }, 2))).toBe(`INVALID_REQUEST`)
    expect(codeOf(() => assertMapping(kind, { amount: 2 }, 2))).toBe(`INVALID_REQUEST`)
    expect(codeOf(() => assertMapping(kind, { memo: 0 }, 2))).toBe(`INVALID_REQUEST`)
  })

  it("counts the columns of the widest row or the header", () => {
    expect(columnCount({ columns: [`a`], rows: [[`1`, `2`, `3`], [`1`]] })).toBe(3)
    expect(columnCount({ columns: [`a`, `b`, `c`, `d`], rows: [[`1`]] })).toBe(4)
  })

  it("reads a mapped cell trimmed, and an unmapped or missing one as empty", () => {
    expect(cellOf([` 5 `], { amount: 0 }, `amount`)).toBe(`5`)
    expect(cellOf([`5`], {}, `amount`)).toBe(``)
    expect(cellOf([`5`], { amount: 3 }, `amount`)).toBe(``)
  })
})

describe("checking every row", () => {
  const kind = importKind(amounts())

  it("keeps the valid values in file order and numbers the refused rows from 1", () => {
    const { values, result } = checkRows(kind, [[`1`], [`x`], [`3`]], { amount: 0 })
    expect(values).toEqual([1, 3])
    expect(result).toEqual({
      rowCount: 3,
      valid: 2,
      withErrors: 1,
      rows: [{ row: 2, errors: [`Not a number`, `Still not a number`] }],
    })
  })

  it("caps the refused rows and each row's errors, yet counts every row", () => {
    const noisy = importKind(amounts({ check: () => err(Array(50).fill(`Wrong`)) }))
    const rows = Array.from({ length: IMPORT_CHECK_ROWS_MAX + 5 }, () => [`x`])
    const { result } = checkRows(noisy, rows, { amount: 0 })
    expect(result.withErrors).toBe(IMPORT_CHECK_ROWS_MAX + 5)
    expect(result.rows).toHaveLength(IMPORT_CHECK_ROWS_MAX)
    expect(result.rows[0].errors).toHaveLength(IMPORT_ROW_ERRORS_MAX)
  })
})
