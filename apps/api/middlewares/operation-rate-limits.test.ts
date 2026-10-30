import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import type { Actor } from "@domain/identity"
import type { Operations } from "@spy4x/realtime/operations"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  sameOriginHeaders,
  WEB_APP_URL,
} from "../_testing/mutation-requests.ts"
import { Hono } from "hono"
import type { NoteCreateCommand } from "@domain/notes"
import type { APIContext } from "../_types.ts"
import { createCallRoute } from "../routes/call.ts"
import { createNotesRoute, type NotesRouteDependencies } from "../routes/notes.ts"
import { createGroupsRoute, type GroupsRouteDependencies } from "../routes/groups.ts"
import { Realtime, toRequestError } from "../services/realtime.ts"
import {
  createOperationRateLimits,
  type OperationBudget,
  type OperationRateLimits,
} from "./operation-rate-limits.ts"

const BUDGET: OperationBudget = { commands: 3, queries: 5, guestCommands: 2, guestQueries: 4 }

/** A new in-process store, standing in for Valkey. */
function memoryStore(): RateLimitStore {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

interface Stack {
  limits: OperationRateLimits
  operations: Operations<Actor>
  /** How many times a handler ran. */
  ran: { command: number; query: number }
}

function stack(store: (name: string) => RateLimitStore = memoryStore): Stack {
  const ran = { command: 0, query: 0 }
  const limits = createOperationRateLimits({ budget: BUDGET, store, onStoreError: () => {} })
  const operations = limits.limit({
    "note.create": { kind: "command", handle: () => ({ created: ++ran.command }) },
    "note.list": { kind: "query", handle: () => ({ listed: ++ran.query }) },
  })
  return { limits, operations, ran }
}

/** Who calls: a user id, whether a guest, and the address the request came from. */
interface Who {
  userId: number
  guest?: boolean
  client?: string
}

/** One adapter, answering `ok` or the error code of each call. */
interface Transport {
  command(): Promise<string>
  query(): Promise<string>
}

let keys = 0

function authOf(who: Who) {
  return buildAuthData({
    user: { id: who.userId, guestSince: who.guest ? new Date("2026-10-01T00:00:00Z") : null },
    session: { id: who.userId * 10, userId: who.userId },
  })
}

function socket(s: Stack, who: Who): Transport {
  const auth = authOf(who)
  const realtime = new Realtime({
    clock: new FakeClock(),
    entitledSession: () => Promise.resolve(auth),
    memberUserIds: () => Promise.resolve([]),
    operations: s.operations,
    identify: s.limits.identify,
    log: () => {},
  })
  const ws = new FakeSocket("wss://app.example.com/api/ws")
  ws.openFromPeer()
  realtime.attach(ws, auth, who.client ?? `192.0.2.1`)
  let sent = 0
  const send = async (frame: Record<string, unknown>) => {
    const id = `request-${++sent}`
    ws.receive(JSON.stringify({ ...frame, id }))
    for (let drains = 0; drains < 10; drains++) {
      await drainMicrotasks()
      const answer = ws.frames().find((candidate) =>
        (candidate as { requestId?: string }).requestId === id
      ) as { kind: string; code?: string } | undefined
      if (answer) return answer.kind === `server.result` ? `ok` : String(answer.code)
    }
    return `no answer`
  }
  return {
    command: () =>
      send({ kind: `client.command`, name: `note.create`, idempotencyKey: `key-${++keys}` }),
    query: () => send({ kind: `client.query`, name: `note.list` }),
  }
}

function callRoute(s: Stack, who: Who): Transport {
  const app = mountRoute(
    `/call`,
    createCallRoute({
      operations: s.operations,
      identify: s.limits.identify,
      mapError: toRequestError,
      log: () => {},
      expectedOrigin: WEB_APP_URL,
    }),
    authOf(who),
  )
  const send = async (name: string, headers: Record<string, string>) => {
    const response = await app.request(`${API_URL}/call/${name}`, {
      method: `POST`,
      headers: {
        ...sameOriginHeaders,
        "x-realtime-user": String(who.userId),
        "x-real-ip": who.client ?? `192.0.2.1`,
        ...headers,
      },
      body: `{}`,
    })
    const body = await response.json()
    return response.ok ? `ok` : String(body.error.code)
  }
  return {
    command: () => send(`note.create`, { "idempotency-key": `key-${++keys}` }),
    query: () => send(`note.list`, {}),
  }
}

async function times(count: number, call: () => Promise<string>): Promise<string[]> {
  const answers: string[] = []
  for (let i = 0; i < count; i++) answers.push(await call())
  return answers
}

const TRANSPORTS = [[`the socket`, socket], [`the call route`, callRoute]] as const

for (const [via, open] of TRANSPORTS) {
  describe(`operation budget over ${via}`, () => {
    it(`refuses a person's writes past the budget, and runs none of them`, async () => {
      const s = stack()
      const as = open(s, { userId: 1 })

      expect(await times(BUDGET.commands + 2, as.command)).toEqual([
        ...Array(BUDGET.commands).fill(`ok`),
        `rate_limited`,
        `rate_limited`,
      ])
      expect(s.ran.command).toBe(BUDGET.commands)
    })

    it(`keeps answering reads under their own budget once writes are spent`, async () => {
      const s = stack()
      const as = open(s, { userId: 1 })
      await times(BUDGET.commands + 1, as.command)

      expect(await times(BUDGET.queries + 1, as.query)).toEqual([
        ...Array(BUDGET.queries).fill(`ok`),
        `rate_limited`,
      ])
    })

    it(`gives another person a budget of their own`, async () => {
      const s = stack()
      await times(BUDGET.commands + 1, open(s, { userId: 1 }).command)

      expect(await open(s, { userId: 2 }).command()).toBe(`ok`)
    })

    it(`counts guests by address, so a new guest account on it gets no more writes`, async () => {
      const s = stack()
      const first = open(s, { userId: 1, guest: true, client: `192.0.2.7` })
      expect(await times(BUDGET.guestCommands, first.command)).toEqual(
        Array(BUDGET.guestCommands).fill(`ok`),
      )

      expect(await open(s, { userId: 2, guest: true, client: `192.0.2.7` }).command())
        .toBe(`rate_limited`)
      expect(await open(s, { userId: 3, guest: true, client: `198.51.100.7` }).command())
        .toBe(`ok`)
      expect(await first.query()).toBe(`ok`)
    })

    it(`lets calls through while the store is down`, async () => {
      const down = () => Promise.reject(new Error(`valkey is down`))
      const s = stack(() => ({
        read: down,
        write: down,
        delete: down,
        consume: down,
        release: down,
      }))
      const as = open(s, { userId: 1 })

      expect(await times(BUDGET.commands + 1, as.command)).toEqual(
        Array(BUDGET.commands + 1).fill(`ok`),
      )
    })
  })
}

const GROUP_ID = `01900000-0000-7000-8000-000000000001`

/**
 * The API as `index.ts` wires it, cut to what the budget touches: the app-wide `restWrites`
 * middleware before the notes, groups and call routes, and a stand-in sign-in route. Every request
 * comes from `who`, at its address.
 */
function restApp(s: Stack, who: Who | null) {
  const ran = { notes: 0, groups: 0 }
  const app = new Hono<APIContext>().basePath(`/api`)
  app.use(`*`, async (c, next) => {
    c.set(`requestId`, `req-test-1`)
    c.set(`auth`, who ? authOf(who) : null)
    await next()
  })
  app.use(`*`, s.limits.restWrites)
  app.post(`/auth/sign-out`, (c) => c.json({ signedOut: true }))
  app.route(
    `/call`,
    createCallRoute({
      operations: s.operations,
      identify: s.limits.identify,
      mapError: toRequestError,
      log: () => {},
      expectedOrigin: WEB_APP_URL,
    }),
  )
  app.route(
    `/groups/:groupId/notes`,
    createNotesRoute({
      create: (command: NoteCreateCommand) => {
        ran.notes++
        return Promise.resolve({ note: { id: command.data.id }, created: true })
      },
      expectedOrigin: WEB_APP_URL,
    } as unknown as NotesRouteDependencies),
  )
  app.route(
    `/groups`,
    createGroupsRoute({
      create: () => {
        ran.groups++
        return Promise.resolve({ group: { id: GROUP_ID }, created: true })
      },
      expectedOrigin: WEB_APP_URL,
    } as unknown as GroupsRouteDependencies),
  )
  const send = (path: string, body: unknown) =>
    app.request(`${API_URL}${path}`, {
      method: `POST`,
      headers: {
        ...sameOriginHeaders,
        "x-realtime-user": String(who?.userId ?? 0),
        "x-real-ip": who?.client ?? `192.0.2.1`,
        "idempotency-key": `key-${++keys}`,
      },
      body: JSON.stringify(body),
    })
  let ids = 0
  const id = () => `01900000-0000-7000-8000-${String(++ids).padStart(12, `0`)}`
  return {
    ran,
    note: () => send(`/groups/${GROUP_ID}/notes`, { id: id(), title: `Plan`, body: `` }),
    group: () => send(`/groups`, { id: id(), name: `Team` }),
    call: () => send(`/call/note.create`, {}),
    signOut: () => send(`/auth/sign-out`, {}),
  }
}

/** `ok`, or the error code a refused request answers with and its status. */
async function outcome(response: Response): Promise<string> {
  if (response.ok) return `ok`
  const body = await response.json()
  return `${response.status} ${body.error.code}`
}

describe(`operation budget over the REST routes`, () => {
  it(`spends one budget for REST writes and /api/call commands`, async () => {
    const s = stack()
    const api = restApp(s, { userId: 1 })

    expect([
      await outcome(await api.note()),
      await outcome(await api.group()),
      await outcome(await api.call()),
      await outcome(await api.call()),
      await outcome(await api.note()),
    ]).toEqual([`ok`, `ok`, `ok`, `429 rate_limited`, `429 rate_limited`])
    expect(api.ran.notes + api.ran.groups + s.ran.command).toBe(BUDGET.commands)
  })

  it(`refuses a guest past its address's budget on note and group creates, with Retry-After`, async () => {
    const s = stack()
    const first = restApp(s, { userId: 1, guest: true, client: `192.0.2.7` })
    expect([await outcome(await first.note()), await outcome(await first.note())])
      .toEqual([`ok`, `ok`])

    const refused = await first.note()
    expect(await outcome(refused)).toBe(`429 rate_limited`)
    expect(Number(refused.headers.get(`retry-after`))).toBeGreaterThan(0)
    const another = restApp(s, { userId: 2, guest: true, client: `192.0.2.7` })
    expect(await outcome(await another.group())).toBe(`429 rate_limited`)
    expect(first.ran.notes + another.ran.groups).toBe(BUDGET.guestCommands)
  })

  it(`leaves sign-in writes and requests with no session out of the budget`, async () => {
    const s = stack()
    const api = restApp(s, { userId: 1 })
    for (let i = 0; i < BUDGET.commands; i++) await api.note()

    expect(await outcome(await api.signOut())).toBe(`ok`)
    expect(await outcome(await restApp(s, null).note())).toBe(`401 unauthorized`)
  })
})
