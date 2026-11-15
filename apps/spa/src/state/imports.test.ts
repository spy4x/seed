import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  type ImportCheckResult,
  type ImportMapping,
  ImportStatus,
  type ImportSummary,
} from "@domain/imports"
import { GUEST_REFUSAL_CODE } from "@domain/identity"
import {
  createImportsStore,
  IMPORT_CHECK_DELAY_MS,
  type ImportsResult,
  type ImportsTimer,
  type ImportsTransport,
} from "./imports.ts"

const GROUP = `0190a000-0000-7000-8000-0000000000aa`
const ID = `0190a000-0000-7000-8000-000000000001`

function summary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    id: ID,
    groupId: GROUP,
    kind: `notes`,
    status: ImportStatus.READY,
    userId: 1,
    fileName: `notes.csv`,
    fileSize: 120,
    fields: [
      { key: `title`, label: `Title`, required: true },
      { key: `body`, label: `Body` },
    ],
    preview: { columns: [`Title`, `Body`], sample: [[`A`, `a`]], mapping: { title: 0 } },
    rowCount: 1,
    savedCount: null,
    errorCount: null,
    skippedCount: null,
    options: null,
    failure: null,
    createdAt: new Date(),
    readAt: new Date(),
    failedAt: null,
    commitRequestedAt: null,
    committedAt: null,
    undoneAt: null,
    ...overrides,
  }
}

const CHECK: ImportCheckResult = { rowCount: 1, valid: 1, withErrors: 0, rows: [] }

const ok = <T>(data: T): ImportsResult<T> => ({ ok: true, data })
const refusal = (status: number, code?: string, error = `Refused.`): ImportsResult<never> => ({
  ok: false,
  status,
  error,
  code,
})

/** A transport that records each call and answers from `answers`, in order, per call kind. */
function fake(answers: Partial<{ [K in keyof ImportsTransport]: unknown[] }> = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const next = (name: keyof ImportsTransport, fallback: unknown) => {
    const queue = answers[name]
    return queue && queue.length > 0 ? queue.shift() : fallback
  }
  const transport: ImportsTransport = {
    upload: (...args) => {
      calls.push({ name: `upload`, args })
      return Promise.resolve(next(`upload`, ok(summary({ status: ImportStatus.READING }))) as never)
    },
    list: (...args) => {
      calls.push({ name: `list`, args })
      return Promise.resolve(next(`list`, ok({ imports: [summary()] })) as never)
    },
    get: (...args) => {
      calls.push({ name: `get`, args })
      return Promise.resolve(next(`get`, ok(summary())) as never)
    },
    check: (...args) => {
      calls.push({ name: `check`, args })
      const answer = next(`check`, ok(CHECK))
      return answer instanceof Promise ? answer as never : Promise.resolve(answer as never)
    },
    commit: (...args) => {
      calls.push({ name: `commit`, args })
      return Promise.resolve(
        next(`commit`, ok(summary({ status: ImportStatus.COMMITTING }))) as never,
      )
    },
    undo: (...args) => {
      calls.push({ name: `undo`, args })
      return Promise.resolve(next(`undo`, ok(summary({ status: ImportStatus.UNDONE }))) as never)
    },
  }
  return { transport, calls, of: (name: string) => calls.filter((c) => c.name === name) }
}

/** A timer the test fires by hand, recording each delay asked for. */
function manualTimer() {
  const waiting = new Map<number, () => void>()
  const delays: number[] = []
  let handles = 0
  const timer: ImportsTimer = {
    set(run, ms) {
      delays.push(ms)
      waiting.set(++handles, run)
      return handles
    },
    clear: (handle) => void waiting.delete(handle),
  }
  return {
    timer,
    delays,
    pending: () => waiting.size,
    fire: async () => {
      const runs = [...waiting.values()]
      waiting.clear()
      for (const run of runs) run()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

describe(`the imports store`, () => {
  it(`opens a read import on its saved mapping, every field listed, and checks it at once`, async () => {
    const { transport, of } = fake()
    const store = createImportsStore(transport, manualTimer().timer)
    await store.open(GROUP, ID)
    await Promise.resolve()
    expect(store.mapping.value).toEqual({ title: 0, body: null })
    expect(of(`check`).map((c) => c.args[2])).toEqual([{ title: 0 }])
    expect(store.check.value).toEqual(CHECK)
    expect(store.groupId.value).toBe(GROUP)
  })

  it(`checks once, ${IMPORT_CHECK_DELAY_MS} ms after the last of several column changes`, async () => {
    const { transport, of } = fake()
    const clock = manualTimer()
    const store = createImportsStore(transport, clock.timer)
    await store.open(GROUP, ID)
    store.map(`body`, 1)
    store.map(`body`, 0)
    store.map(`body`, 1)
    expect(clock.pending()).toBe(1)
    expect(clock.delays).toEqual([400, 400, 400])
    await clock.fire()
    expect(of(`check`).map((c) => c.args[2] as ImportMapping)).toEqual([
      { title: 0 },
      { title: 0, body: 1 },
    ])
  })

  it(`drops a check's answer once a newer check was sent`, async () => {
    let answerOld: (value: ImportsResult<ImportCheckResult>) => void = () => {}
    const old = new Promise<ImportsResult<ImportCheckResult>>((resolve) => (answerOld = resolve))
    const newer = { ...CHECK, valid: 0, withErrors: 1 }
    const { transport } = fake({ check: [ok(CHECK), old, ok(newer)] })
    const clock = manualTimer()
    const store = createImportsStore(transport, clock.timer)
    await store.open(GROUP, ID)
    store.map(`body`, 1)
    await clock.fire()
    store.map(`body`, null)
    await clock.fire()
    answerOld(ok({ ...CHECK, valid: 99 }))
    await Promise.resolve()
    expect(store.check.value).toEqual(newer)
  })

  it(`saves only the mapped fields, with one idempotency key kept until an answer comes`, async () => {
    const { transport, of } = fake({
      commit: [refusal(0), ok(summary({ status: ImportStatus.COMMITTING }))],
    })
    const store = createImportsStore(transport, manualTimer().timer)
    await store.open(GROUP, ID)
    await store.commit()
    expect(store.error.value).toBe(`Something went wrong, and nothing changed. Try again.`)
    await store.commit()
    const [first, retry] = of(`commit`)
    expect(first.args[2]).toEqual({ title: 0 })
    expect(retry.args[3]).toBe(first.args[3])
    expect(String(first.args[3])[14]).toBe(`7`)
    expect(store.current.value?.status).toBe(ImportStatus.COMMITTING)
    await store.undo()
    await store.undo()
    const [undo1, undo2] = of(`undo`)
    expect(undo2.args[2]).not.toBe(undo1.args[2])
  })

  it(`reads the import again when a save meets a change made first (409)`, async () => {
    const { transport, of } = fake({
      commit: [refusal(409, `VERSION_CONFLICT`)],
      get: [ok(summary()), ok(summary({ status: ImportStatus.COMMITTED, savedCount: 1 }))],
    })
    const store = createImportsStore(transport, manualTimer().timer)
    await store.open(GROUP, ID)
    await store.commit()
    await Promise.resolve()
    expect(of(`get`).length).toBe(2)
    expect(store.current.value?.status).toBe(ImportStatus.COMMITTED)
    expect(store.error.value).toBeNull()
  })

  it(`says the import is gone on a 404, and a role too low on a 403`, async () => {
    const gone = createImportsStore(fake({ get: [refusal(404)] }).transport, manualTimer().timer)
    await gone.open(GROUP, ID)
    expect(gone.gone.value).toBe(true)

    const viewer = createImportsStore(
      fake({ commit: [refusal(403, `ROLE_INSUFFICIENT`)] }).transport,
      manualTimer().timer,
    )
    await viewer.open(GROUP, ID)
    await viewer.commit()
    expect(viewer.forbidden.value).toBe(true)
    expect(viewer.error.value).toBeNull()
  })

  it(`shows another refusal of a save in the API's words`, async () => {
    const store = createImportsStore(
      fake({ commit: [refusal(422, `IMPORT_REFUSED`, `The plan has no room.`)] }).transport,
      manualTimer().timer,
    )
    await store.open(GROUP, ID)
    await store.commit()
    expect(store.error.value).toBe(`The plan has no room.`)
  })

  it(`uploads a file and gives its id, or says why it was refused`, async () => {
    const file = new File([`Title\nA`], `notes.csv`, { type: `text/csv` })
    const { transport, of } = fake({
      upload: [
        refusal(413, `FILE_TOO_LARGE`, `The file is larger than 2 MB.`),
        refusal(0),
        refusal(403, GUEST_REFUSAL_CODE),
      ],
    })
    const store = createImportsStore(transport, manualTimer().timer)
    expect(await store.upload(GROUP, `notes`, file)).toBeNull()
    expect(store.uploadError.value).toBe(`The file is larger than 2 MB.`)
    expect(await store.upload(GROUP, `notes`, file)).toBeNull()
    expect(store.uploadError.value).toBe(`Could not upload the file. Try again.`)
    // A guest's refusal is the frame's to say: the picker shows nothing of its own.
    expect(await store.upload(GROUP, `notes`, file)).toBeNull()
    expect(store.uploadError.value).toBeNull()
    expect(await store.upload(GROUP, `notes`, file)).toBe(ID)
    const keys = of(`upload`).map((c) => c.args[3])
    // The retry after no answer kept the key; after an answer, a new one.
    expect(keys[2]).toBe(keys[1])
    expect(keys[1]).not.toBe(keys[0])
    expect(of(`upload`)[0].args.slice(0, 2)).toEqual([GROUP, `notes`])
  })

  it(`reads nothing more for an import once the page left it`, async () => {
    let answer: (value: ImportsResult<ImportSummary>) => void = () => {}
    const late = new Promise<ImportsResult<ImportSummary>>((resolve) => (answer = resolve))
    const { transport, of } = fake({ get: [ok(summary()), late as unknown] })
    const store = createImportsStore(transport, manualTimer().timer)
    await store.open(GROUP, ID)
    const refreshing = store.refresh()
    store.close()
    answer(ok(summary({ status: ImportStatus.COMMITTED })))
    await refreshing
    expect(store.current.value?.status).toBe(ImportStatus.READY)
    expect(store.groupId.value).toBeNull()
    await store.refresh()
    expect(of(`get`).length).toBe(2)
  })
})
