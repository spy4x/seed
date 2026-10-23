import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { DataExportStatus, type DataExportView } from "@domain/identity"
import { createDataExportStore, type DataExportCall } from "./data-export.ts"

const preparing: DataExportView = {
  id: `019a1b2c-0000-7000-8000-000000000001`,
  status: DataExportStatus.Preparing,
  requestedAt: new Date(`2026-10-23T10:00:00.000Z`),
  readyAt: null,
  expiresAt: null,
  sizeBytes: null,
  nextRequestAt: new Date(`2026-10-24T10:00:00.000Z`),
}

/** A store over scripted answers: each call takes the next one of its list. */
function store(answers: { latest?: DataExportCall[]; request?: DataExportCall[] }) {
  const calls: string[] = []
  const take = (name: `latest` | `request`) => {
    calls.push(name)
    const next = answers[name]?.shift()
    return next ? Promise.resolve(next) : Promise.reject(new Error(`offline`))
  }
  return {
    calls,
    data: createDataExportStore({ latest: () => take(`latest`), request: () => take(`request`) }),
  }
}

describe(`data export store`, () => {
  it(`reads the newest export, and reads "never asked" after a failed read`, async () => {
    const { data } = store({
      latest: [{ ok: true, export: preparing }, { ok: false, status: 500 }],
    })
    expect(data.current.value).toBeUndefined()
    await data.load()
    expect(data.current.value).toEqual(preparing)

    const fresh = store({ latest: [{ ok: false, status: 500 }] }).data
    await fresh.load()
    expect(fresh.current.value).toBeNull()
  })

  it(`shows the export a request started, with no error`, async () => {
    const { data } = store({ request: [{ ok: true, export: preparing }] })
    await data.request()
    expect(data.current.value).toEqual(preparing)
    expect(data.error.value).toBeNull()
    expect(data.pending.value).toBe(false)
  })

  it(`on a refusal within the day, reads the export again and says when to ask next`, async () => {
    const { data, calls } = store({
      request: [{ ok: false, status: 429, code: `TOO_SOON` }],
      latest: [{ ok: true, export: preparing }],
    })
    await data.request()
    expect(calls).toEqual([`request`, `latest`])
    expect(data.current.value).toEqual(preparing)
    expect(data.error.value).toEqual({ kind: `too-soon`, retryAt: preparing.nextRequestAt })
  })

  it(`names a failed request as a network error`, async () => {
    const { data } = store({ request: [{ ok: false, status: 500 }] })
    await data.request()
    expect(data.error.value).toEqual({ kind: `network` })
    await data.request()
    expect(data.error.value).toEqual({ kind: `network` })
  })

  it(`sends one request while another is on its way`, async () => {
    const { data, calls } = store({ request: [{ ok: true, export: preparing }] })
    await Promise.all([data.request(), data.request()])
    expect(calls).toEqual([`request`])
  })
})
