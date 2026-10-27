import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { ADMIN_GROUP_NO_FILTER, type AdminGroupDetail, type AdminGroupFiles } from "@domain/groups"
import { UserRole } from "@domain/identity"
import { AdminGroupActOutcome, type AdminGroupStoredFile } from "@server/groups/admin-groups.ts"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import {
  ADMIN_GROUP_FILE_CROSS_SITE,
  ADMIN_GROUP_FILE_NOT_FOUND,
  ADMIN_GROUP_NOT_FOUND,
  type AdminGroupsService,
  createAdminGroupsRoutes,
} from "./groups.ts"
import { apiError } from "../../_testing/api-error.ts"

const GROUP_ID = `0199c3a0-0000-7000-8000-000000000001`
const INVITATION_ID = `0199c3a0-0000-7000-8000-000000000002`
const FILE_ID = `0199c3a0-0000-7000-8000-000000000003`

const IMAGE_ID = `0199c3a0-0000-7000-8000-000000000004`
const SVG_ID = `0199c3a0-0000-7000-8000-000000000005`

const files: AdminGroupFiles = {
  files: [{
    id: FILE_ID,
    name: `receipt.pdf`,
    contentType: `application/pdf`,
    size: 700,
    uploader: { id: 42, name: `Ada Lovelace`, email: `ada@example.com` },
    createdAt: `2026-10-02T10:00:00.000Z`,
    noteTitle: `Taxes`,
    noteDeleted: false,
  }],
  total: 1,
  page: 1,
  pageSize: 25,
  query: ``,
  usage: { files: 1, bytes: 700, maxFiles: 100, maxBytes: 200 * 1024 * 1024 },
}

/** The group's stored files by id: a PDF, a PNG, and an SVG no upload accepts today. */
const STORED: Record<string, AdminGroupStoredFile> = {
  [FILE_ID]: {
    id: FILE_ID,
    name: `receipt.pdf`,
    contentType: `application/pdf`,
    objectKey: `attachments/${FILE_ID}`,
    noteId: `0199c3a0-0000-7000-8000-0000000000aa`,
  },
  [IMAGE_ID]: {
    id: IMAGE_ID,
    name: `IMG_0001.png`,
    contentType: `image/png`,
    objectKey: `attachments/${IMAGE_ID}`,
    noteId: `0199c3a0-0000-7000-8000-0000000000aa`,
  },
  [SVG_ID]: {
    id: SVG_ID,
    name: `logo.svg`,
    contentType: `image/svg+xml`,
    objectKey: `attachments/${SVG_ID}`,
    noteId: `0199c3a0-0000-7000-8000-0000000000aa`,
  },
}

const BYTES = new Uint8Array([1, 2, 3])

const detail: AdminGroupDetail = {
  group: {
    id: GROUP_ID,
    name: `Family`,
    emoji: null,
    color: null,
    owner: { id: 42, name: `Ada Lovelace`, email: `ada@example.com` },
    memberCount: 2,
    noteCount: 3,
    planId: `free`,
    createdAt: `2026-10-01T10:00:00.000Z`,
    lastActivityAt: null,
    deletedAt: null,
  },
  counts: { notes: 3, deletedNotes: 0, tags: 1, pendingInvitations: 1, files: 1, fileBytes: 700 },
  billing: null,
  members: [],
  invitations: [],
  imported: null,
  activity: [],
}

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const operator = () => buildAuthData({ user: { id: 7, role: UserRole.OPERATOR } })

function buildApp(
  auth: APIContext["Variables"]["auth"] = operator(),
  {
    outcome = AdminGroupActOutcome.Done,
    stored = true,
    auditFails = false,
  }: { outcome?: AdminGroupActOutcome; stored?: boolean; auditFails?: boolean } = {},
) {
  const calls: unknown[][] = []
  const groups: AdminGroupsService = {
    list: (
      filter,
    ) => (calls.push([`list`, filter]),
      Promise.resolve({ groups: [detail.group], total: 1, page: filter.page, pageSize: 25 })),
    detail: (id) => (calls.push([`detail`, id]), Promise.resolve(id === GROUP_ID ? detail : null)),
    revokeInvitation: (actor, groupId, invitationId) => (
      calls.push([`revoke`, actor, groupId, invitationId]), Promise.resolve(outcome)
    ),
    removeMember: (actor, groupId, userId) => (
      calls.push([`remove`, actor, groupId, userId]), Promise.resolve(outcome)
    ),
    transferOwnership: (actor, groupId, userId) => (
      calls.push([`transfer`, actor, groupId, userId]), Promise.resolve(outcome)
    ),
    widget: (groupId, widgetId, request) => (
      calls.push([`widget`, groupId, widgetId, request]),
        Promise.resolve(
          groupId === GROUP_ID && widgetId === `notes.total` ? { current: 3, previous: 1 } : null,
        )
    ),
    files: (id, filter) => (
      calls.push([`files`, id, filter]), Promise.resolve(id === GROUP_ID ? files : null)
    ),
    file: (groupId, fileId) => (
      calls.push([`file`, groupId, fileId]),
        Promise.resolve(groupId === GROUP_ID ? STORED[fileId] ?? null : null)
    ),
    readFile: (key) => (calls.push([`readFile`, key]), Promise.resolve(stored ? BYTES : null)),
    recordFileAccess: (actor, groupId, file, access) => {
      calls.push([`audit`, actor, groupId, file.id, access])
      return auditFails ? Promise.reject(new Error(`the database is down`)) : Promise.resolve()
    },
    removeFile: (actor, groupId, fileId) => (
      calls.push([`removeFile`, actor, groupId, fileId]), Promise.resolve(outcome)
    ),
  }
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules: [createAdminGroupsRoutes({ limit: passThrough, groups })],
  })
  return { app: mountRoute(`/admin`, route, auth), calls }
}

interface Route {
  method: string
  path: string
  body?: unknown
}

/** Every path of the module. */
const ROUTES: Route[] = [
  { method: `GET`, path: `/admin/groups` },
  { method: `GET`, path: `/admin/groups?q=ada&status=deleted&sort=name:asc&page=2` },
  { method: `GET`, path: `/admin/groups/${GROUP_ID}` },
  { method: `POST`, path: `/admin/groups/${GROUP_ID}/invitations/${INVITATION_ID}/revoke` },
  { method: `POST`, path: `/admin/groups/${GROUP_ID}/members/42/remove` },
  { method: `POST`, path: `/admin/groups/${GROUP_ID}/transfer`, body: { userId: 42 } },
  { method: `GET`, path: `/admin/groups/${GROUP_ID}/files` },
  { method: `POST`, path: `/admin/groups/${GROUP_ID}/files/${FILE_ID}/remove` },
  {
    method: `GET`,
    path:
      `/admin/groups/${GROUP_ID}/widgets/notes.total?from=2026-10-01&to=2026-10-21&timeZone=Europe%2FBerlin`,
  },
  { method: `GET`, path: `/admin/groups/${GROUP_ID}/files/${IMAGE_ID}/thumbnail` },
  { method: `GET`, path: `/admin/groups/${GROUP_ID}/files/${IMAGE_ID}/open` },
  { method: `GET`, path: `/admin/groups/${GROUP_ID}/files/${FILE_ID}/download` },
]

function send(
  app: ReturnType<typeof buildApp>["app"],
  { method, path, body }: Route,
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}${path}`, {
    method,
    headers: body === undefined
      ? { ...headers }
      : { ...headers, "content-type": `application/json` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe(`operator area group routes`, () => {
  // A viewer is the only role below operator.
  for (const route of ROUTES) {
    it(`answers 404 to a viewer on ${route.method} ${route.path} and does nothing`, async () => {
      const viewer = buildAuthData({ user: { id: 7, role: UserRole.VIEWER } })
      const { app, calls } = buildApp(viewer)
      const response = await send(app, route)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
    })

    it(`answers 401 without a session on ${route.method} ${route.path}`, async () => {
      const { app, calls } = buildApp(null)
      const response = await send(app, route, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })
  }

  it(`lists groups with the search, status, sort and page the address asks for`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[1])

    expect(response.status).toBe(200)
    expect((await response.json()).total).toBe(1)
    expect(calls).toEqual([[`list`, {
      query: `ada`,
      status: `deleted`,
      sort: [{ key: `name`, direction: `asc` }],
      page: 2,
    }]])
  })

  it(`lists every group, newest first, without a query`, async () => {
    const { app, calls } = buildApp()
    await send(app, ROUTES[0])
    expect(calls).toEqual([[`list`, ADMIN_GROUP_NO_FILTER]])
  })

  it(`answers one group, and 404 for an id that is no UUID without reading anything`, async () => {
    const { app, calls } = buildApp()
    expect(await (await send(app, ROUTES[2])).json()).toEqual(detail)
    const missing = await send(app, { method: `GET`, path: `/admin/groups/not-a-uuid` })
    expect(missing.status).toBe(404)
    expect((await apiError(missing)).message).toBe(ADMIN_GROUP_NOT_FOUND)
    expect(calls).toEqual([[`detail`, GROUP_ID]])
  })

  it(`revokes an invitation as the operator and answers the group as it reads now`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[3])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ group: detail })
    expect(calls).toEqual([
      [`revoke`, { id: 7, role: UserRole.OPERATOR }, GROUP_ID, INVITATION_ID],
      [`detail`, GROUP_ID],
    ])
  })

  it(`removes a member and transfers the group with the ids the request names`, async () => {
    const { app, calls } = buildApp(
      buildAuthData({ user: { id: 7, role: UserRole.SUPERVISOR } }),
    )
    expect((await send(app, ROUTES[4])).status).toBe(200)
    expect((await send(app, ROUTES[5])).status).toBe(200)
    const actor = { id: 7, role: UserRole.SUPERVISOR }
    expect(calls.filter((call) => call[0] !== `detail`)).toEqual([
      [`remove`, actor, GROUP_ID, 42],
      [`transfer`, actor, GROUP_ID, 42],
    ])
  })

  it(`answers 404 for a member or invitation id that cannot exist, without acting`, async () => {
    const { app, calls } = buildApp()
    for (
      const path of [
        `/admin/groups/${GROUP_ID}/members/0/remove`,
        `/admin/groups/${GROUP_ID}/members/2147483648/remove`,
        `/admin/groups/${GROUP_ID}/invitations/abc/revoke`,
        `/admin/groups/abc/transfer`,
      ]
    ) {
      expect((await send(app, { method: `POST`, path, body: { userId: 1 } })).status).toBe(404)
    }
    expect(calls).toEqual([])
  })

  it(`refuses a transfer whose body is not one member id, without acting`, async () => {
    const { app, calls } = buildApp()
    const path = `/admin/groups/${GROUP_ID}/transfer`
    for (
      const body of [{}, { userId: 0 }, { userId: 1.5 }, { userId: `42` }, { userId: 42, x: 1 }]
    ) {
      expect((await send(app, { method: `POST`, path, body })).status).toBe(400)
    }
    expect((await send(app, { method: `POST`, path })).status).toBe(400)
    expect(calls).toEqual([])
  })

  it(`refuses an operator's cross-site action with 403 and does nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[3], crossSiteHeaders)

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  const refusals: [AdminGroupActOutcome, number][] = [
    [AdminGroupActOutcome.NotFound, 404],
    [AdminGroupActOutcome.GroupDeleted, 409],
    [AdminGroupActOutcome.Self, 403],
    [AdminGroupActOutcome.Outranked, 403],
    [AdminGroupActOutcome.RoleTooLow, 403],
    [AdminGroupActOutcome.Unchanged, 409],
    [AdminGroupActOutcome.IsOwner, 409],
    [AdminGroupActOutcome.LastGroup, 409],
    [AdminGroupActOutcome.SubscriptionRenews, 409],
    [AdminGroupActOutcome.RecipientBlocked, 409],
  ]
  for (const [outcome, status] of refusals) {
    it(`answers ${status} with a sentence when the service refuses with outcome ${outcome}`, async () => {
      const { app, calls } = buildApp(operator(), { outcome })
      const response = await send(app, ROUTES[4])

      expect(response.status).toBe(status)
      expect(typeof (await apiError(response)).message).toBe(`string`)
      // A refusal reads nothing more: the page keeps the group it has.
      expect(calls.map((call) => call[0])).toEqual([`remove`])
    })
  }

  it(`answers an overview widget's counts for the days and the zone the address names`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[8])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ current: 3, previous: 1 })
    expect(calls).toEqual([[`widget`, GROUP_ID, `notes.total`, {
      groupId: GROUP_ID,
      range: { from: `2026-10-01`, to: `2026-10-21` },
      timeZone: `Europe/Berlin`,
    }]])
  })

  it(`answers 404 for a widget or a group that does not exist`, async () => {
    const { app } = buildApp()
    const unknown = await send(app, {
      method: `GET`,
      path: `/admin/groups/${GROUP_ID}/widgets/nope?from=2026-10-01&to=2026-10-21&timeZone=UTC`,
    })
    expect(unknown.status).toBe(404)
  })

  it(`answers 400 for a reversed range, a range past a year or an unknown zone, reading nothing`, async () => {
    const { app, calls } = buildApp()
    for (
      const query of [
        `from=2026-10-21&to=2026-10-01&timeZone=UTC`,
        `from=2024-01-01&to=2026-10-21&timeZone=UTC`,
        `from=2026-10-01&to=2026-10-21&timeZone=Mars/Olympus`,
        `from=2026-10-01&timeZone=UTC`,
      ]
    ) {
      const response = await send(app, {
        method: `GET`,
        path: `/admin/groups/${GROUP_ID}/widgets/notes.total?${query}`,
      })
      expect(response.status).toBe(400)
    }
    expect(calls).toEqual([])
  })

  it(`answers the group's files and room, and 404 for a group that is not there`, async () => {
    const { app, calls } = buildApp()
    expect(await (await send(app, ROUTES[6])).json()).toEqual(files)
    const missing = `/admin/groups/0199c3a0-0000-7000-8000-00000000000f/files`
    expect((await send(app, { method: `GET`, path: missing })).status).toBe(404)
    expect((await send(app, { method: `GET`, path: `/admin/groups/abc/files` })).status).toBe(404)
    expect(calls.map((call) => call[0])).toEqual([`files`, `files`])
    expect(calls[0]).toEqual([`files`, GROUP_ID, { query: ``, page: 1 }])
  })

  it(`passes the file-name search and the page the address asks for`, async () => {
    const { app, calls } = buildApp()
    const path = `/admin/groups/${GROUP_ID}/files?q=%20receipt%20&page=3`
    expect((await send(app, { method: `GET`, path })).status).toBe(200)
    expect(calls).toEqual([[`files`, GROUP_ID, { query: `receipt`, page: 3 }]])
  })

  it(`removes a file as the operator and answers the files as they read now`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[7])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(files)
    expect(calls).toEqual([
      [`removeFile`, { id: 7, role: UserRole.OPERATOR }, GROUP_ID, FILE_ID],
      [`files`, GROUP_ID, { query: ``, page: 1 }],
    ])
  })

  it(`answers the page of files the removal was made from`, async () => {
    const { app, calls } = buildApp()
    const path = `/admin/groups/${GROUP_ID}/files/${FILE_ID}/remove?q=receipt&page=2`
    expect((await send(app, { method: `POST`, path })).status).toBe(200)
    expect(calls.at(-1)).toEqual([`files`, GROUP_ID, { query: `receipt`, page: 2 }])
  })

  it(`answers 404 for a file id that cannot exist or is gone, and 409 in a group in the trash`, async () => {
    const bad = buildApp()
    const path = `/admin/groups/${GROUP_ID}/files/abc/remove`
    expect((await send(bad.app, { method: `POST`, path })).status).toBe(404)
    expect(bad.calls).toEqual([])

    const gone = buildApp(operator(), { outcome: AdminGroupActOutcome.NotFound })
    const response = await send(gone.app, ROUTES[7])
    expect(response.status).toBe(404)
    expect(await apiError(response)).toMatchObject({
      code: `not_found`,
      message: ADMIN_GROUP_FILE_NOT_FOUND,
    })

    const trashed = buildApp(operator(), { outcome: AdminGroupActOutcome.GroupDeleted })
    expect((await send(trashed.app, ROUTES[7])).status).toBe(409)
    expect(trashed.calls.map((call) => call[0])).toEqual([`removeFile`])
  })

  it(`serves an image's thumbnail in place with the store's safety headers, and audits nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[9])

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
    expect(response.headers.get(`content-type`)).toBe(`image/png`)
    expect(response.headers.get(`content-disposition`)).toMatch(/^inline; filename="IMG_0001.png"/)
    expect(response.headers.get(`x-content-type-options`)).toBe(`nosniff`)
    expect(response.headers.get(`content-security-policy`)).toBe(`sandbox; default-src 'none'`)
    expect(calls).toEqual([[`file`, GROUP_ID, IMAGE_ID], [`readFile`, `attachments/${IMAGE_ID}`]])
  })

  it(`has no thumbnail for a PDF or an SVG, without reading the store`, async () => {
    for (const id of [FILE_ID, SVG_ID]) {
      const { app, calls } = buildApp()
      const path = `/admin/groups/${GROUP_ID}/files/${id}/thumbnail`
      expect((await send(app, { method: `GET`, path })).status).toBe(404)
      expect(calls).toEqual([[`file`, GROUP_ID, id]])
    }
  })

  it(`opens an image in place and writes the operator's audit row before it answers`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[10])

    expect(response.status).toBe(200)
    expect(response.headers.get(`content-disposition`)).toMatch(/^inline;/)
    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    expect(calls).toEqual([
      [`file`, GROUP_ID, IMAGE_ID],
      [`readFile`, `attachments/${IMAGE_ID}`],
      [`audit`, { id: 7, role: UserRole.OPERATOR }, GROUP_ID, IMAGE_ID, `open`],
    ])
  })

  it(`saves a PDF or an SVG that is opened, never shows it on the admin host`, async () => {
    for (const [id, type] of [[FILE_ID, `application/pdf`], [SVG_ID, `image/svg+xml`]]) {
      const { app, calls } = buildApp()
      const path = `/admin/groups/${GROUP_ID}/files/${id}/open`
      const response = await send(app, { method: `GET`, path })
      expect(response.status).toBe(200)
      expect(response.headers.get(`content-type`)).toBe(type)
      expect(response.headers.get(`content-disposition`)).toMatch(/^attachment;/)
      expect(response.headers.get(`x-content-type-options`)).toBe(`nosniff`)
      expect(response.headers.get(`content-security-policy`)).toBe(`sandbox; default-src 'none'`)
      expect(calls.at(-1)).toEqual([
        `audit`,
        { id: 7, role: UserRole.OPERATOR },
        GROUP_ID,
        id,
        `open`,
      ])
    }
  })

  it(`downloads any file, an image too, as an attachment under its name, with an audit row`, async () => {
    for (const id of [FILE_ID, IMAGE_ID]) {
      const { app, calls } = buildApp()
      const path = `/admin/groups/${GROUP_ID}/files/${id}/download`
      const response = await send(app, { method: `GET`, path })
      expect(response.status).toBe(200)
      expect(response.headers.get(`content-disposition`)).toBe(
        `attachment; filename="${STORED[id].name}"; filename*=UTF-8''${STORED[id].name}`,
      )
      expect(calls.at(-1)).toEqual([
        `audit`,
        { id: 7, role: UserRole.OPERATOR },
        GROUP_ID,
        id,
        `download`,
      ])
    }
  })

  it(`refuses an open or a download another site starts, before reading or auditing anything`, async () => {
    for (const route of [ROUTES[10], ROUTES[11]]) {
      for (const site of [`cross-site`, `same-site`, `none`, null]) {
        const { app, calls } = buildApp()
        const headers: Record<string, string> = { ...sameOriginHeaders }
        if (site === null) delete headers[`sec-fetch-site`]
        else headers[`sec-fetch-site`] = site
        const response = await send(app, route, headers)
        expect(response.status).toBe(403)
        expect((await apiError(response)).message).toBe(ADMIN_GROUP_FILE_CROSS_SITE)
        expect(calls).toEqual([])
      }
    }
  })

  it(`finds a file only through its own group's path, and audits no file it did not serve`, async () => {
    const { app, calls } = buildApp()
    const other = `0199c3a0-0000-7000-8000-00000000000f`
    for (
      const path of [
        `/admin/groups/${other}/files/${IMAGE_ID}/open`,
        `/admin/groups/${GROUP_ID}/files/0199c3a0-0000-7000-8000-00000000000e/download`,
        `/admin/groups/${GROUP_ID}/files/not-a-uuid/open`,
      ]
    ) {
      const response = await send(app, { method: `GET`, path })
      expect(response.status).toBe(404)
      expect((await apiError(response)).message).toBe(ADMIN_GROUP_FILE_NOT_FOUND)
    }
    expect(calls.map((call) => call[0])).toEqual([`file`, `file`])
  })

  it(`answers 404 and writes no audit row when the store no longer has the file`, async () => {
    const { app, calls } = buildApp(operator(), { stored: false })
    expect((await send(app, ROUTES[11])).status).toBe(404)
    expect(calls.map((call) => call[0])).toEqual([`file`, `readFile`])
  })

  it(`serves nothing when the audit row cannot be written`, async () => {
    const { app } = buildApp(operator(), { auditFails: true })
    const response = await send(app, ROUTES[11])
    expect(response.status).toBe(500)
    expect(response.headers.get(`content-disposition`)).toBe(null)
  })
})
