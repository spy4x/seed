import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  dataExportFileName,
  type DataExportRow,
  DataExportStatus,
  dataExportView,
} from "./data-export.ts"

const requestedAt = new Date(`2026-10-23T10:00:00.000Z`)
const hours = (n: number) => new Date(requestedAt.getTime() + n * 3_600_000)
const row = (over: Partial<DataExportRow> = {}): DataExportRow => ({
  id: `019a1b2c-0000-7000-8000-000000000001`,
  requestedAt,
  readyAt: null,
  expiresAt: null,
  expiredAt: null,
  sizeBytes: null,
  ...over,
})
const ready = { readyAt: hours(1), expiresAt: hours(1 + 7 * 24), sizeBytes: `4200000` }

describe("dataExportView", () => {
  it("reads a fresh request as preparing, and as failed once a day passed without a file", () => {
    expect(dataExportView(row(), hours(23)).status).toBe(DataExportStatus.Preparing)
    expect(dataExportView(row(), hours(24)).status).toBe(DataExportStatus.Failed)
  })

  it("reads a stored file as ready until it expires, even before its expiry job ran", () => {
    expect(dataExportView(row(ready), hours(2)).status).toBe(DataExportStatus.Ready)
    expect(dataExportView(row(ready), hours(1 + 7 * 24)).status).toBe(DataExportStatus.Expired)
    expect(dataExportView(row({ ...ready, expiredAt: hours(3) }), hours(3)).status)
      .toBe(DataExportStatus.Expired)
  })

  it("lets the next request come a day after this one, and counts the size as a number", () => {
    const view = dataExportView(row(ready), hours(2))
    expect(view.nextRequestAt).toEqual(hours(24))
    expect(view.sizeBytes).toBe(4_200_000)
  })
})

describe("dataExportFileName", () => {
  it("names the file after the day it was made", () => {
    expect(dataExportFileName(new Date(`2026-10-23T23:59:00.000Z`))).toBe(`my-data-2026-10-23.zip`)
  })
})
