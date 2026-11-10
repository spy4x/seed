import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { GroupRole } from "@domain/groups"
import { IMPORT_FILE_MAX_BYTES, ImportStatus, type ImportSummary } from "@domain/imports"
import { noteImportKind } from "@server/notes/note-import.ts"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import { apiError } from "../_testing/api-error.ts"
import {
  createImportCheckHandler,
  createImportCommitHandler,
  createImportCreateHandler,
  createImportGetHandler,
  createImportListHandler,
  createImportUndoHandler,
  type ImportHandlerDependencies,
} from "../features/imports/handlers.ts"
import { createImportsRoute } from "./imports.ts"

const GROUP_ID = uuidV7()
const IMPORT_ID = uuidV7()
const STARTER = 7
const OTHER_EDITOR = 8
const ADMIN = 9
const STRANGER = 10
const ROLES: Record<number, GroupRole> = {
  [STARTER]: GroupRole.EDITOR,
  [OTHER_EDITOR]: GroupRole.EDITOR,
  [ADMIN]: GroupRole.ADMIN,
}
const FILE = new TextEncoder().encode(`title,body\nFirst,One\n,Missing title\n`)
const origin = {
  cookie: `sessionIdToken=1:token`,
  origin: `http://local`,
  "sec-fetch-site": `same-origin`,
}
const json = { ...origin, "content-type": `application/json` }

/** A read import of {@link FILE}, started by {@link STARTER}. */
function readImport(): ImportSummary {
  const at = new Date(`2026-11-01T09:00:00Z`)
  return {
    id: IMPORT_ID,
    groupId: GROUP_ID,
    kind: `notes`,
    status: ImportStatus.READY,
    userId: STARTER,
    fileName: `notes.csv`,
    fileSize: FILE.byteLength,
    fields: [...noteImportKind.fields],
    preview: { columns: [`title`, `body`], sample: [], mapping: { title: 0, body: 1 } },
    rowCount: 2,
    savedCount: null,
    errorCount: null,
    failure: null,
    createdAt: at,
    readAt: at,
    failedAt: null,
    commitRequestedAt: null,
    committedAt: null,
    undoneAt: null,
  }
}

/** The route on the real handlers, over an in-memory store that records every write. */
function app(userId: number | null = STARTER) {
  const writes: string[] = []
  const stored = readImport()
  const dependencies: ImportHandlerDependencies = {
    roleOf: (groupId, user) => Promise.resolve(groupId === GROUP_ID ? ROLES[user] ?? null : null),
    kinds: [noteImportKind],
    imports: {
      create: (input) => {
        writes.push(`create ${input.fileName} ${input.file.byteLength}`)
        return Promise.resolve({ ...stored, id: input.id, status: ImportStatus.READING })
      },
      get: (groupId, id) =>
        Promise.resolve(groupId === GROUP_ID && id === IMPORT_ID ? stored : null),
      listForUser: (_groupId, user) => Promise.resolve(user === STARTER ? [stored] : []),
      file: () => Promise.resolve(FILE),
      requestCommit: (_groupId, _id, _actor, mapping) => {
        writes.push(`commit ${JSON.stringify(mapping)}`)
        return Promise.resolve({ ...stored, status: ImportStatus.COMMITTING })
      },
      undo: () => {
        writes.push(`undo`)
        return Promise.resolve({ ...stored, status: ImportStatus.UNDONE })
      },
    },
  }
  const hono = new Hono<APIContext>()
  hono.use(`*`, async (c, next) => {
    c.set(`requestId`, `req-imports-1`)
    if (userId !== null) c.set(`auth`, buildAuthData({ user: { id: userId } }))
    await next()
  })
  hono.route(
    `/groups/:groupId/imports`,
    createImportsRoute({
      create: createImportCreateHandler(dependencies),
      list: createImportListHandler(dependencies),
      get: createImportGetHandler(dependencies),
      check: createImportCheckHandler(dependencies),
      commit: createImportCommitHandler(dependencies),
      undo: createImportUndoHandler(dependencies),
    }),
  )
  return { hono, writes }
}

const base = `http://local/groups/${GROUP_ID}/imports`

describe("uploading a file", () => {
  it("stores the file and answers 201 with the import", async () => {
    const { hono, writes } = app()
    const response = await hono.request(`${base}?kind=notes&name=notes.csv`, {
      method: `POST`,
      headers: origin,
      body: FILE,
    })
    expect(response.status).toBe(201)
    expect((await response.json()).status).toBe(ImportStatus.READING)
    expect(writes).toEqual([`create notes.csv ${FILE.byteLength}`])
  })

  it("refuses a body declared larger than the cap with 413", async () => {
    const { hono, writes } = app()
    const response = await hono.request(`${base}?kind=notes&name=notes.csv`, {
      method: `POST`,
      headers: { ...origin, "content-length": String(IMPORT_FILE_MAX_BYTES + 1) },
      body: FILE,
    })
    expect(response.status).toBe(413)
    expect((await apiError(response)).reason).toBe(`FILE_TOO_LARGE`)
    expect(writes).toEqual([])
  })

  it("refuses a file past the kind's own cap, an ending it does not take and an unknown kind", async () => {
    const { hono, writes } = app()
    const big = new Uint8Array(noteImportKind.maxBytes + 1)
    const cases: [string, Uint8Array<ArrayBuffer>, number, string][] = [
      [`kind=notes&name=big.csv`, big, 413, `FILE_TOO_LARGE`],
      [`kind=notes&name=notes.xlsx`, FILE, 422, `IMPORT_REFUSED`],
      [`kind=invoices&name=notes.csv`, FILE, 400, `INVALID_REQUEST`],
      [`kind=Notes&name=notes.csv`, FILE, 400, `INVALID_REQUEST`],
    ]
    for (const [query, body, status, reason] of cases) {
      const response = await hono.request(`${base}?${query}`, {
        method: `POST`,
        headers: origin,
        body,
      })
      expect([query, response.status, (await apiError(response)).reason]).toEqual([
        query,
        status,
        reason,
      ])
    }
    expect(writes).toEqual([])
  })

  it("asks for a session first", async () => {
    const { hono } = app(null)
    const response = await hono.request(`${base}?kind=notes&name=a.csv`, {
      method: `POST`,
      body: FILE,
    })
    expect(response.status).toBe(401)
  })
})

describe("who sees and acts on an import", () => {
  it("answers the starter and an admin, and tells another editor and a stranger it does not exist", async () => {
    const statuses: Record<number, number> = {}
    for (const user of [STARTER, ADMIN, OTHER_EDITOR, STRANGER]) {
      statuses[user] = (await app(user).hono.request(`${base}/${IMPORT_ID}`)).status
    }
    expect(statuses).toEqual({ [STARTER]: 200, [ADMIN]: 200, [OTHER_EDITOR]: 404, [STRANGER]: 404 })
  })

  it("lets neither another editor nor a stranger check, save or undo it", async () => {
    for (const user of [OTHER_EDITOR, STRANGER]) {
      const { hono, writes } = app(user)
      for (const step of [`check`, `commit`, `undo`]) {
        const response = await hono.request(`${base}/${IMPORT_ID}/${step}`, {
          method: `POST`,
          headers: json,
          body: JSON.stringify({ mapping: { title: 0 } }),
        })
        const { reason } = await apiError(response)
        expect([user, step, response.status]).toEqual([user, step, 404])
        expect([`GROUP_NOT_FOUND`, `ITEM_NOT_FOUND`]).toContain(reason)
      }
      expect(writes).toEqual([])
    }
  })
})

describe("checking and saving", () => {
  it("answers every refused row under the mapping and saves nothing", async () => {
    const { hono, writes } = app()
    const response = await hono.request(`${base}/${IMPORT_ID}/check`, {
      method: `POST`,
      headers: json,
      body: JSON.stringify({ mapping: { title: 0, body: 1 } }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      rowCount: 2,
      valid: 1,
      withErrors: 1,
      rows: [{ row: 2 }],
    })
    expect(writes).toEqual([])
  })

  it("refuses a mapping to a column the file lacks before queueing the save", async () => {
    const { hono, writes } = app()
    const response = await hono.request(`${base}/${IMPORT_ID}/commit`, {
      method: `POST`,
      headers: json,
      body: JSON.stringify({ mapping: { title: 5 } }),
    })
    expect(response.status).toBe(400)
    expect(writes).toEqual([])
  })

  it("queues the save with the mapping and answers 202", async () => {
    const { hono, writes } = app()
    const response = await hono.request(`${base}/${IMPORT_ID}/commit`, {
      method: `POST`,
      headers: json,
      body: JSON.stringify({ mapping: { title: 0 } }),
    })
    expect(response.status).toBe(202)
    expect(writes).toEqual([`commit {"title":0}`])
  })
})
