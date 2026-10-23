import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { ADMIN_GROUP_NO_FILTER, type AdminGroupDetail, type AdminGroupFiles } from "@domain/groups"
import { UserRole } from "@domain/identity"
import { AdminGroupActOutcome } from "@server/groups/admin-groups.ts"
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
  ADMIN_GROUP_FILE_NOT_FOUND,
  ADMIN_GROUP_NOT_FOUND,
  type AdminGroupsService,
  createAdminGroupsRoutes,
} from "./groups.ts"
import { apiError } from "../../_testing/api-error.ts"

const GROUP_ID = `0199c3a0-0000-7000-8000-000000000001`
const INVITATION_ID = `0199c3a0-0000-7000-8000-000000000002`
const FILE_ID = `0199c3a0-0000-7000-8000-000000000003`

const files: AdminGroupFiles = {
  files: [{
    id: FILE_ID,
    contentType: `application/pdf`,
    size: 700,
    uploader: { id: 42, name: `Ada Lovelace`, email: `ada@example.com` },
    createdAt: `2026-10-02T10:00:00.000Z`,
    noteDeleted: false,
  }],
  usage: { files: 1, bytes: 700, maxFiles: 100, maxBytes: 200 * 1024 * 1024 },
}

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
  { outcome = AdminGroupActOutcome.Done } = {},
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
    files: (id) => (calls.push([`files`, id]), Promise.resolve(id === GROUP_ID ? files : null)),
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
  })

  it(`removes a file as the operator and answers the files as they read now`, async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[7])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(files)
    expect(calls).toEqual([
      [`removeFile`, { id: 7, role: UserRole.OPERATOR }, GROUP_ID, FILE_ID],
      [`files`, GROUP_ID],
    ])
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
})
