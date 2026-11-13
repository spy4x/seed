import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import type { Actor } from "@domain/identity"
import type { Operations } from "@spy4x/realtime/operations"
import { NOTES_OFF, NOTES_ON, type NotesSetup } from "@server/notes/setup.ts"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import { API_URL, sameOriginHeaders, WEB_APP_URL } from "../../_testing/mutation-requests.ts"
import { createCallRoute } from "../../routes/call.ts"
import { toRequestError } from "../../services/realtime.ts"
import {
  createNotesOperations,
  mountNotesRoutes,
  type NotesFeatureDependencies,
  type NotesRoutesDependencies,
} from "./switch.ts"

const USER = 7
const GROUP = `0190f3a0-0000-7000-8000-000000000001`
const NOTE = `0190f3a0-0000-7000-8000-000000000002`

/** Buses that count every dispatch and answer an empty result. */
function fakeBuses() {
  const dispatched: unknown[] = []
  const execute = (message: unknown) => {
    dispatched.push(message)
    return Promise.resolve({} as never)
  }
  const dependencies: NotesFeatureDependencies = {
    commandBus: { execute },
    queryBus: { execute },
    cursor: {
      encode: () => Promise.resolve(`cursor`),
      decode: () => Promise.reject(new Error(`no cursor`)),
    },
    noteCreated: () => Promise.resolve(),
  }
  return { dependencies, dispatched }
}

/** The API's path prefix and the stand-in for `parseAuth`, with the notes' routes mounted. */
function routesApp(setup: NotesSetup) {
  const { dependencies, dispatched } = fakeBuses()
  const routes: NotesRoutesDependencies = {
    ...dependencies,
    expectedOrigin: WEB_APP_URL,
    tokenApi: {
      authenticate: () => Promise.resolve(null),
      auditRefusal: () => Promise.resolve(),
      limitByIp: async (_c, next) => await next(),
      limitByToken: async (_c, next) => await next(),
    },
  }
  const app = new Hono<APIContext>().basePath(`/api`)
  app.use(`*`, async (c, next) => {
    c.set(`requestId`, `req-test-1`)
    c.set(`auth`, buildAuthData({ user: { id: USER }, session: { userId: USER } }))
    await next()
  })
  mountNotesRoutes(app, setup, routes)
  return { app, dispatched }
}

/** Every route the notes, the tags and the personal-token API answer. */
const NOTE_ROUTES: ReadonlyArray<[string, string]> = [
  [`GET`, `/groups/${GROUP}/notes`],
  [`POST`, `/groups/${GROUP}/notes`],
  [`POST`, `/groups/${GROUP}/notes/move`],
  [`GET`, `/groups/${GROUP}/notes/${NOTE}`],
  [`PATCH`, `/groups/${GROUP}/notes/${NOTE}`],
  [`DELETE`, `/groups/${GROUP}/notes/${NOTE}`],
  [`POST`, `/groups/${GROUP}/notes/${NOTE}/restore`],
  [`GET`, `/groups/${GROUP}/tags`],
  [`GET`, `/v1/groups/${GROUP}/notes`],
  [`POST`, `/v1/groups/${GROUP}/notes`],
  [`GET`, `/v1/groups/${GROUP}/notes/${NOTE}`],
]

/** One request to `path`, signed in and from the app's own page. */
function send(app: Hono<APIContext>, method: string, path: string) {
  return app.request(`${API_URL}${path}`, {
    method,
    headers: { ...sameOriginHeaders, authorization: `Bearer not-a-token` },
    body: method === `GET` || method === `DELETE` ? undefined : JSON.stringify({ title: `x` }),
  })
}

/** `POST /api/call/<name>` over `operations`, as the page sends it; answers status and body. */
async function call(operations: Operations<Actor>, name: string) {
  const app = new Hono<APIContext>().basePath(`/api`)
  app.use(`*`, async (c, next) => {
    c.set(`auth`, buildAuthData({ user: { id: USER }, session: { userId: USER } }))
    await next()
  })
  app.route(
    `/call`,
    createCallRoute({
      operations,
      mapError: toRequestError,
      log: () => {},
      expectedOrigin: WEB_APP_URL,
    }),
  )
  const response = await app.request(`${API_URL}/call/${name}`, {
    method: `POST`,
    headers: { ...sameOriginHeaders, "x-realtime-user": String(USER), "idempotency-key": `key-1` },
    body: JSON.stringify({ groupId: GROUP }),
  })
  return { status: response.status, body: await response.json() }
}

describe(`the notes switch`, () => {
  it(`mounts every note, tag and token-API route while the notes are on`, async () => {
    const { app } = routesApp(NOTES_ON)
    for (const [method, path] of NOTE_ROUTES) {
      expect({ method, path, status: (await send(app, method, path)).status }).not.toMatchObject({
        status: 404,
      })
    }
  })

  it(`answers 404 on every note, tag and token-API route with the notes off, and reads nothing`, async () => {
    const { app, dispatched } = routesApp(NOTES_OFF)
    for (const [method, path] of NOTE_ROUTES) {
      expect({ method, path, status: (await send(app, method, path)).status }).toEqual({
        method,
        path,
        status: 404,
      })
    }
    expect(dispatched).toEqual([])
  })

  it(`refuses every note, tag, attachment and widget operation as an unknown one with the notes off`, async () => {
    const names = Object.keys(createNotesOperations(NOTES_ON, fakeBuses().dependencies))
    for (const name of [`note.create`, `note.search`, `note.widget.total`, `tag.list`]) {
      expect(names).toContain(name)
    }
    expect(names).toContain(`attachment.download`)

    const { dependencies, dispatched } = fakeBuses()
    const off = createNotesOperations(NOTES_OFF, dependencies)
    const unknown = await call(off, `no.such-operation`)
    expect(unknown.status).toBe(404)
    for (const name of names) {
      expect({ name, ...await call(off, name) }).toEqual({ name, ...unknown })
    }
    expect(dispatched).toEqual([])
  })
})
