import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { Attachment, AttachmentListResult } from "@domain/notes"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.json" with { type: "json" }
import { messageText } from "@ui/message.ts"
import { type AttachmentDependencies, createAttachmentsStore } from "./attachments.ts"

/** The store's message as an English screen shows it. */
const EN = createTranslator({ language: `en`, catalogs: [{ source: app }] })
const english = (message: Parameters<typeof messageText>[1]) => messageText(EN, message)

const GROUP = `0199c3a0-0000-7000-8000-000000000001`
const NOTE = `0199c3a0-0000-7000-8000-000000000002`
const MB = 1024 * 1024

const usage = {
  files: 3,
  bytes: 5 * MB,
  maxFiles: 100,
  maxBytes: 200 * MB,
  maxFileBytes: 2 * MB,
  maxPerNote: 10,
}

function attachment(id: string, name: string, type = `application/pdf`, size = 1000): Attachment {
  return {
    id,
    noteId: NOTE,
    name,
    contentType: type,
    size,
    createdByUserId: 1,
    createdAt: new Date(0),
  }
}

const file = (name: string, type = `application/pdf`, size = 1000) =>
  new File([new Uint8Array(size)], name, { type })

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** Fake calls that record what was sent; each one can be overridden. */
function fakeCalls(overrides: Partial<AttachmentDependencies> = {}) {
  const calls: string[] = []
  let signed = 0
  let online = true
  const dependencies: AttachmentDependencies = {
    list: ({ noteId }) => {
      calls.push(`list ${noteId}`)
      return Promise.resolve<AttachmentListResult>({ attachments: [], usage })
    },
    sign: ({ name }) => {
      calls.push(`sign ${name}`)
      const id = `0199c3a0-0000-7000-8000-00000000010${++signed}`
      return Promise.resolve({
        id,
        url: `https://files.test/${id}`,
        headers: { "content-type": `x` },
      })
    },
    put: (upload, _file, onProgress) => {
      calls.push(`put ${upload.id}`)
      onProgress(50)
      onProgress(100)
      return Promise.resolve()
    },
    confirm: ({ id }) => {
      calls.push(`confirm ${id}`)
      return Promise.resolve({ attachment: attachment(id, `scan.pdf`) })
    },
    cancel: ({ id }) => {
      calls.push(`cancel ${id}`)
      return Promise.resolve({ id })
    },
    remove: ({ id }) => {
      calls.push(`remove ${id}`)
      return Promise.resolve({ id })
    },
    download: ({ id }) => {
      calls.push(`download ${id}`)
      return Promise.resolve({ url: `https://files.test/get/${id}` })
    },
    canCall: () => online,
    ...overrides,
  }
  return { dependencies, calls, setOnline: (value: boolean) => (online = value) }
}

/** Lets every queued promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`note attachments store`, () => {
  it(`shows the note's files and the group's room, with a link for each image's thumbnail`, async () => {
    const image = attachment(`0199c3a0-0000-7000-8000-000000000003`, `map.png`, `image/png`)
    const pdf = attachment(`0199c3a0-0000-7000-8000-000000000004`, `scan.pdf`)
    const { dependencies, calls } = fakeCalls({
      list: () => Promise.resolve({ attachments: [image, pdf], usage }),
    })
    const store = createAttachmentsStore(dependencies)

    await store.open(GROUP, NOTE)
    await settle()

    expect(store.rows.value.map((row) => [row.name, row.status, row.src])).toEqual([
      [`map.png`, `ready`, `https://files.test/get/${image.id}`],
      [`scan.pdf`, `ready`, undefined],
    ])
    expect(store.usage.value).toEqual(usage)
    expect(calls).toEqual([`download ${image.id}`])
  })

  it(`signs, uploads with progress, confirms, then counts the file and announces it`, async () => {
    const progress: (number | undefined)[] = []
    const put = deferred()
    const { dependencies, calls } = fakeCalls({
      put: (_upload, _file, onProgress) => {
        onProgress(40)
        return put.promise
      },
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)

    store.add([file(`scan.pdf`)])
    await settle()
    progress.push(store.rows.value[0].progress)
    expect(store.rows.value[0].status).toBe(`uploading`)
    put.resolve()
    await settle()

    expect(progress).toEqual([40])
    expect(store.rows.value.map((row) => [row.name, row.status])).toEqual([[`scan.pdf`, `ready`]])
    expect(calls).toEqual([
      `list ${NOTE}`,
      `sign scan.pdf`,
      `confirm 0199c3a0-0000-7000-8000-000000000101`,
    ])
    expect(store.usage.value).toMatchObject({ files: 4, bytes: 5 * MB + 1000 })
    expect(english(store.announcement.value)).toBe(`scan.pdf uploaded`)
  })

  it(`keeps an uploaded file's row id after its confirm, and links and removes it by the stored id`, async () => {
    const { dependencies, calls } = fakeCalls()
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)
    store.add([file(`scan.pdf`)])
    const rowId = store.rows.value[0].id
    await settle()
    await settle()
    const [row] = store.rows.value
    expect(row.status).toBe(`ready`)
    // The same row, so the page does not draw it anew and the focus in it stays.
    expect(row.id).toBe(rowId)
    expect(row.fileId).not.toBe(rowId)

    await store.link(row.id)
    expect(await store.remove(row.id)).toBeNull()
    expect(calls).toContain(`download ${row.fileId}`)
    expect(calls).toContain(`remove ${row.fileId}`)
    expect(store.rows.value).toEqual([])
  })

  it(`refuses a type, a size and a full note before anything is sent, naming each file`, async () => {
    const full = Array.from(
      { length: 9 },
      (_, i) => attachment(`0199c3a0-0000-7000-8000-00000000020${i}`, `${i}.pdf`),
    )
    const { dependencies, calls } = fakeCalls({
      list: () => Promise.resolve({ attachments: full, usage }),
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)

    store.add([
      file(`photo.heic`, `image/heic`),
      file(`big.pdf`, `application/pdf`, 2 * MB + 1),
      file(`last.png`, `image/png`),
      file(`a.png`, `image/png`),
      file(`b.png`, `image/png`),
    ])
    await settle()

    expect(store.refusals.value.map(english)).toEqual([
      `photo.heic cannot be attached. Only JPEG, PNG, WebP and GIF images and PDF files can be.`,
      `big.pdf is 2 MB. Each file can be up to 2 MB.`,
      `A note holds up to 10 files. 2 were not attached: a.png, b.png.`,
    ])
    expect(calls.filter((call) => call.startsWith(`sign`))).toEqual([`sign last.png`])
  })

  it(`keeps files chosen for a new note waiting, and uploads them once the note is created`, async () => {
    const { dependencies, calls } = fakeCalls()
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, null)

    store.add([file(`scan.pdf`)])
    await settle()
    expect(store.rows.value.map((row) => row.status)).toEqual([`waiting`])
    expect(calls).toEqual([])

    await store.created(NOTE)
    await settle()
    expect(store.rows.value.map((row) => row.status)).toEqual([`ready`])
    expect(calls).toContain(`sign scan.pdf`)
    expect(store.usage.value).toMatchObject({ maxFiles: 100 })
  })

  it(`keeps a new note's uploads when its own page opens it after the create`, async () => {
    const put = deferred()
    const { dependencies } = fakeCalls({ put: () => put.promise })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, null)
    store.add([file(`scan.pdf`)])
    void store.created(NOTE)
    await settle()
    expect(store.rows.value.map((row) => row.status)).toEqual([`uploading`])

    // The create page navigates to the note's page, which opens the same note.
    await store.open(GROUP, NOTE)
    expect(store.rows.value.map((row) => row.status)).toEqual([`uploading`])
    put.resolve()
    await settle()
    expect(store.rows.value.map((row) => row.status)).toEqual([`ready`])

    // Opened again later, the note is read afresh.
    await store.open(GROUP, NOTE)
    expect(store.rows.value).toEqual([])
  })

  it(`waits without a network and sends what waits once it is back`, async () => {
    const { dependencies, calls, setOnline } = fakeCalls()
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)
    setOnline(false)

    store.add([file(`scan.pdf`)])
    await settle()
    expect(store.rows.value[0].status).toBe(`waiting`)

    setOnline(true)
    await store.flush()
    expect(store.rows.value[0].status).toBe(`ready`)
    expect(calls.filter((call) => call.startsWith(`sign`))).toEqual([`sign scan.pdf`])
  })

  it(`shows the plan's notice and drops the file when the group has no room`, async () => {
    const refusal = {
      code: `PLAN_LIMIT_REACHED`,
      entitlement: `maxAttachments`,
      limit: 100,
      canUpgrade: true,
    }
    const { dependencies } = fakeCalls({
      sign: () => Promise.reject(new RealtimeRequestError(`forbidden`, `full`, refusal)),
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)

    store.add([file(`scan.pdf`)])
    await settle()

    expect(store.plan.value).toEqual(refusal)
    expect(store.rows.value).toEqual([])
  })

  it(`names a file whose bytes are not its type and keeps no row for it`, async () => {
    const { dependencies } = fakeCalls({
      confirm: () =>
        Promise.reject(
          new RealtimeRequestError(`bad_request`, `no`, { code: `FILE_CONTENT`, limit: null }),
        ),
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)

    store.add([file(`invoice.pdf`)])
    await settle()

    expect(store.refusals.value.map(english)).toEqual([
      `invoice.pdf is not really a PDF, so it was not attached.`,
    ])
    expect(store.rows.value).toEqual([])
  })

  it(`marks a file failed when the network drops, and sends it again on retry`, async () => {
    let tries = 0
    const { dependencies, calls } = fakeCalls({
      put: () => ++tries === 1 ? Promise.reject(new Error(`network`)) : Promise.resolve(),
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)

    store.add([file(`scan.pdf`)])
    await settle()
    expect(store.rows.value[0]).toMatchObject({ status: `failed`, error: undefined })

    await store.retry(store.rows.value[0].id)
    expect(store.rows.value[0].status).toBe(`ready`)
    expect(calls.filter((call) => call.startsWith(`sign`)).length).toBe(2)
  })

  it(`cancels an upload in flight: the PUT is aborted and nothing is confirmed`, async () => {
    let aborted = false
    const { dependencies, calls } = fakeCalls({
      put: (_upload, _file, _onProgress, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(`abort`, () => {
            aborted = true
            reject(new DOMException(`canceled`, `AbortError`))
          })
        }),
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)
    store.add([file(`scan.pdf`)])
    await settle()

    store.cancel(store.rows.value[0].id)
    await settle()

    expect(aborted).toBe(true)
    expect(store.rows.value).toEqual([])
    expect(calls.some((call) => call.startsWith(`confirm`))).toBe(false)
  })

  it(`lets the server go of a signed upload before a retry and on a cancel`, async () => {
    let tries = 0
    const { dependencies, calls } = fakeCalls({
      put: (upload, _file, _onProgress, signal) => {
        calls.push(`put ${upload.id}`)
        if (++tries === 1) return Promise.reject(new Error(`network`))
        return new Promise((_resolve, reject) =>
          signal.addEventListener(`abort`, () => reject(new DOMException(`canceled`, `AbortError`)))
        )
      },
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)
    store.add([file(`scan.pdf`)])
    await settle()
    const first = `0199c3a0-0000-7000-8000-000000000101`
    const second = `0199c3a0-0000-7000-8000-000000000102`

    void store.retry(store.rows.value[0].id)
    await settle()
    expect(calls).toEqual([
      `list ${NOTE}`,
      `sign scan.pdf`,
      `put ${first}`,
      `cancel ${first}`,
      `sign scan.pdf`,
      `put ${second}`,
    ])

    store.cancel(store.rows.value[0].id)
    await settle()
    expect(calls.at(-1)).toBe(`cancel ${second}`)
  })

  it(`removes a file and frees its room; a failure keeps the row and says what to do`, async () => {
    const pdf = attachment(`0199c3a0-0000-7000-8000-000000000004`, `scan.pdf`)
    let fail = true
    const { dependencies } = fakeCalls({
      list: () => Promise.resolve({ attachments: [pdf], usage }),
      remove: () => fail ? Promise.reject(new Error(`network`)) : Promise.resolve({}),
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)

    expect(english(await store.remove(pdf.id))).toBe(
      `Could not remove scan.pdf. Check your connection and try again.`,
    )
    expect(store.rows.value.length).toBe(1)
    fail = false
    expect(english(await store.remove(pdf.id))).toBe(null)
    expect(store.rows.value).toEqual([])
    expect(store.usage.value).toMatchObject({ files: 2, bytes: 5 * MB - 1000 })
  })

  it(`counts a file someone else removed a moment ago as removed`, async () => {
    const pdf = attachment(`0199c3a0-0000-7000-8000-000000000004`, `scan.pdf`)
    const { dependencies } = fakeCalls({
      list: () => Promise.resolve({ attachments: [pdf], usage }),
      remove: () =>
        Promise.reject(
          new RealtimeRequestError(`not_found`, `gone`, { code: `ATTACHMENT_NOT_FOUND` }),
        ),
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)
    expect(english(await store.remove(pdf.id))).toBe(null)
    expect(store.rows.value).toEqual([])
  })

  it(`drops the files of a note the page has left`, async () => {
    const late = deferred<AttachmentListResult>()
    const other = `0199c3a0-0000-7000-8000-000000000009`
    const { dependencies } = fakeCalls({
      list: ({ noteId }) =>
        noteId === NOTE ? late.promise : Promise.resolve({ attachments: [], usage }),
    })
    const store = createAttachmentsStore(dependencies)
    const first = store.open(GROUP, NOTE)
    await store.open(GROUP, other)
    late.resolve({
      attachments: [attachment(`0199c3a0-0000-7000-8000-000000000004`, `x.pdf`)],
      usage,
    })
    await first
    expect(store.noteId.value).toBe(other)
    expect(store.rows.value).toEqual([])
  })

  it(`gives a fresh link to a file, and says the link expired when none comes`, async () => {
    let fail = false
    const { dependencies } = fakeCalls({
      download: ({ id }) =>
        fail
          ? Promise.reject(new Error(`x`))
          : Promise.resolve({ url: `https://files.test/${id}` }),
    })
    const store = createAttachmentsStore(dependencies)
    await store.open(GROUP, NOTE)
    expect(await store.link(`abc`)).toBe(`https://files.test/abc`)
    fail = true
    const expired = await store.link(`abc`).then(() => null, (cause: Error) => cause.message)
    expect(english(expired)).toBe(`This link expired. Try again.`)
  })
})
