import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { UserRole } from "@domain/identity"
import { type AdminImportFilter, ImportStatus } from "@domain/imports"
import { type AdminImportPage, toAdminImportRow } from "@server/imports/admin-imports.ts"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import { createAdminImportsRoutes } from "./imports.ts"

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()
const GROUP = `0190a000-0000-7000-8000-0000000000aa`

/** A database row of a saved import: read in 2 s, saved in 5 s, one row left out. */
const raw = {
  id: `0190a000-0000-7000-8000-000000000001`,
  groupId: GROUP,
  groupName: `Team`,
  kind: `notes`,
  status: ImportStatus.COMMITTED,
  uploaderId: 42,
  rowCount: 3,
  savedCount: 2,
  errorCount: 1,
  skippedCount: null,
  failure: null,
  createdAt: new Date(`2026-11-15T10:00:00.000Z`),
  readAt: new Date(`2026-11-15T10:00:02.000Z`),
  failedAt: null,
  commitRequestedAt: new Date(`2026-11-15T10:01:00.000Z`),
  committedAt: new Date(`2026-11-15T10:01:05.000Z`),
  undoneAt: null,
}

const COUNTS = {
  all: 1,
  failed: 0,
  reading: 0,
  ready: 0,
  committing: 0,
  committed: 1,
  undone: 0,
}

function buildApp(options: { role?: UserRole; signedOut?: boolean } = {}) {
  const calls: AdminImportFilter[] = []
  const list = (filter: AdminImportFilter): Promise<AdminImportPage> => {
    calls.push(filter)
    return Promise.resolve({ imports: [toAdminImportRow(raw)], counts: COUNTS, total: 1 })
  }
  const app = mountRoute(
    `/admin`,
    createAdminRoute({
      auth: testSessionGuards(),
      mutationGuards: testMutationGuards,
      modules: [createAdminImportsRoutes({ limit: passThrough, list })],
    }),
    options.signedOut ? null : buildAuthData({
      user: { id: 7, role: options.role ?? UserRole.OPERATOR },
    }),
  )
  return { app, calls }
}

const get = (app: ReturnType<typeof buildApp>[`app`], path: string, headers = sameOriginHeaders) =>
  app.request(`${API_URL}/admin${path}`, { headers: { ...headers } })

describe(`the admin imports route`, () => {
  it(`answers 404 to a viewer and reads nothing`, async () => {
    const { app, calls } = buildApp({ role: UserRole.VIEWER })
    expect((await get(app, `/imports`)).status).toBe(404)
    expect(calls).toEqual([])
  })

  it(`answers 401 without a session and reads nothing`, async () => {
    const { app, calls } = buildApp({ signedOut: true })
    expect((await get(app, `/imports`, sameOriginWithoutCookieHeaders)).status).toBe(401)
    expect(calls).toEqual([])
  })

  it(`lists a page of imports with the chips' counts, its status and page from the address`, async () => {
    const { app, calls } = buildApp()
    const response = await get(app, `/imports?status=committed&page=2`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(calls).toEqual([{ status: `committed`, page: 2 }])
    expect(body).toMatchObject({ counts: COUNTS, total: 1, page: 2, pageSize: 50 })
    expect(body.imports[0]).toMatchObject({
      group: { id: GROUP, name: `Team` },
      uploaderId: 42,
      savedCount: 2,
      errorCount: 1,
      readMs: 2000,
      saveMs: 5000,
    })
  })

  it(`reads an unknown status or page as the first page of all`, async () => {
    const { app, calls } = buildApp()
    await get(app, `/imports?status=deleted&page=-3`)
    expect(calls).toEqual([{ status: `all`, page: 1 }])
  })
})

describe(`an admin import row`, () => {
  it(`carries no file name, file or cells, only what the operator area shows`, () => {
    const withFile = { ...raw, fileName: `secret.csv`, file: new Uint8Array([1]), sample: [[`x`]] }
    const row = toAdminImportRow(withFile)
    expect(Object.keys(row)).not.toContain(`fileName`)
    expect(JSON.stringify(row)).not.toContain(`secret`)
    expect(Object.keys(row).sort()).toEqual([
      `commitRequestedAt`,
      `committedAt`,
      `createdAt`,
      `errorCount`,
      `failedAt`,
      `failure`,
      `group`,
      `id`,
      `kind`,
      `readAt`,
      `readMs`,
      `rowCount`,
      `saveMs`,
      `savedCount`,
      `skippedCount`,
      `status`,
      `undoneAt`,
      `uploaderId`,
    ])
  })

  it(`times a failed read to its failure, and a failed save from its start to its failure`, () => {
    const failedAt = new Date(`2026-11-15T10:00:03.000Z`)
    const readFailed = toAdminImportRow({
      ...raw,
      status: ImportStatus.FAILED,
      readAt: null,
      failedAt,
      commitRequestedAt: null,
      committedAt: null,
    })
    expect([readFailed.readMs, readFailed.saveMs]).toEqual([3000, null])

    const saveFailed = toAdminImportRow({
      ...raw,
      status: ImportStatus.FAILED,
      committedAt: null,
      failedAt: new Date(`2026-11-15T10:01:09.000Z`),
    })
    expect([saveFailed.readMs, saveFailed.saveMs]).toEqual([2000, 9000])

    const reading = toAdminImportRow({ ...raw, readAt: null, commitRequestedAt: null })
    expect(reading.readMs).toBeNull()
  })
})
