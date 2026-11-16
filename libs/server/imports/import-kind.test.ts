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
import type postgres from "postgres"
import {
  assertChoices,
  assertKeep,
  assertMapping,
  cellOf,
  checkRows,
  columnCount,
  type ImportKind,
  importKind,
  kindOf,
  reviewValues,
  valuesToSave,
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

  it("refuses a required field that is also a choice", () => {
    expect(() =>
      importKind(
        amounts({ fields: [{ key: `amount`, label: `Amount`, required: true, choice: true }] }),
      )
    ).toThrow(`required field amount cannot be a choice`)
    expect(importKind(amounts({ fields: [{ key: `amount`, label: `Amount`, choice: true }] })).id)
      .toBe(`amounts`)
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

describe("the person's choices", () => {
  const kind = importKind(amounts({
    fields: [{ key: `amount`, label: `Amount`, required: true }, {
      key: `category`,
      label: `Category`,
      choice: true,
    }],
  }))

  it("pass for a choice field on any row the file has", () => {
    expect(codeOf(() => assertChoices(kind, { "1": { category: `c` }, "3": {} }, 3))).toBeNull()
  })

  it("refuse a field that is not a choice, a field the kind lacks and a row past the file", () => {
    expect(codeOf(() => assertChoices(kind, { "1": { amount: `5` } }, 3))).toBe(`INVALID_REQUEST`)
    expect(codeOf(() => assertChoices(kind, { "1": { color: `red` } }, 3))).toBe(`INVALID_REQUEST`)
    expect(codeOf(() => assertChoices(kind, { "4": { category: `c` } }, 3))).toBe(`INVALID_REQUEST`)
    expect(codeOf(() => assertChoices(kind, { "0": { category: `c` } }, 3))).toBe(`INVALID_REQUEST`)
  })
})

describe("the rows the person keeps", () => {
  it("pass for rows 1 to the file's last", () => {
    expect(codeOf(() => assertKeep([1, 3], 3))).toBeNull()
    expect(codeOf(() => assertKeep([], 0))).toBeNull()
  })

  it("refuse a row past the file and a row below 1", () => {
    expect(codeOf(() => assertKeep([1, 4], 3))).toBe(`INVALID_REQUEST`)
    expect(codeOf(() => assertKeep([0], 3))).toBe(`INVALID_REQUEST`)
  })
})

describe("a review", () => {
  const tx = {} as postgres.TransactionSql
  const context = { importId: `i`, groupId: `g`, actorId: 1, role: GroupRole.EDITOR, options: null }

  it("hands the options to every row's check", () => {
    const seen: unknown[] = []
    const kind = importKind(amounts({
      check: (_row, _mapping, options) => {
        seen.push(options)
        return ok(1)
      },
    }))
    expect(checkRows(kind, [[`1`], [`2`]], { amount: 0 }, { accountId: `a` }).valueRows)
      .toEqual([1, 2])
    expect(seen).toEqual([{ accountId: `a` }, { accountId: `a` }])
  })

  it("answers one review per value and refuses a kind that answers another number", async () => {
    const one = { skip: null, suggestions: {} }
    const fine = importKind(
      amounts({ review: (_tx, values) => Promise.resolve(values.map(() => one)) }),
    )
    expect(await reviewValues(fine, tx, [1, 2], context)).toEqual([one, one])
    const short = importKind(amounts({ review: () => Promise.resolve([one]) }))
    await expect(reviewValues(short, tx, [1, 2], context)).rejects.toThrow(
      `review answered 1 rows for 2`,
    )
  })

  it("leaves skipped rows out and overlays each kept row's suggestions with its row's choices", () => {
    const saved = valuesToSave(
      [10, 20, 30],
      [1, 3, 4],
      [
        { skip: `Saved before`, suggestions: { category: `food` } },
        { skip: null, suggestions: { category: `rent`, note: `x` } },
        { skip: null, suggestions: { category: `fun` } },
      ],
      { "1": { category: `ignored` }, "2": { category: `refused row` }, "3": { category: `home` } },
    )
    expect(saved).toEqual({
      values: [20, 30],
      choices: [{ category: `home`, note: `x` }, { category: `fun` }],
      skipped: 1,
    })
  })

  it("saves a kept row whose skip is overridable, with its suggestions and choices, and leaves an unkept one out", () => {
    const saved = valuesToSave(
      [10, 20],
      [1, 2],
      [
        { skip: `Matches a transfer`, suggestions: { category: `food` }, overridable: true },
        { skip: `Matches a transfer`, suggestions: { category: `rent` }, overridable: true },
      ],
      { "1": { note: `mine` } },
      [1],
    )
    expect(saved).toEqual({
      values: [10],
      choices: [{ category: `food`, note: `mine` }],
      skipped: 1,
    })
  })

  it("leaves a kept row out when its skip is not overridable", () => {
    const final = { skip: `Saved before`, suggestions: {} }
    expect(valuesToSave([10, 20], [1, 2], [final, { ...final, overridable: false }], {}, [1, 2]))
      .toEqual({ values: [], choices: [], skipped: 2 })
  })

  it("ignores keep of a row the review did not skip and of a row number no value has", () => {
    expect(
      valuesToSave([10], [2], [{ skip: null, suggestions: {}, overridable: true }], {}, [1, 2, 9]),
    ).toEqual({ values: [10], choices: [{}], skipped: 0 })
  })

  it("keeps every value without a review, with only the person's choices", () => {
    expect(valuesToSave([10, 20], [1, 2], null, { "2": { category: `c` } })).toEqual({
      values: [10, 20],
      choices: [{}, { category: `c` }],
      skipped: 0,
    })
  })
})
