import { expect } from "@std/expect"
import { RealtimeRequestError } from "@spy4x/realtime"
import { afterEach, describe, it } from "@std/testing/bdd"
import { type LocalReads, noLocalReads } from "../modules.ts"
import { createActivityStore } from "./activity.ts"
import { createApiTokensStore } from "./api-tokens.ts"
import { createBillingStore } from "./billing.ts"
import { createDevicesStore } from "./devices.ts"
import { createInvitationsStore } from "./invitations.ts"
import { createMembersStore } from "./members.ts"
import { memoryReads } from "./memory-reads.ts"
import { createNotificationsStore } from "./notifications.ts"
import { createProfileStore } from "./profile.ts"
import { sessionState } from "./session.ts"

/**
 * Every offline-readable list (ADR 003, level 2) keeps the same four promises. Each store is run
 * through them here, over a device in memory, so a list added without its copy fails by name.
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const signedOut = sessionState.value
const unused = () => Promise.reject(new Error("unused"))

/** A server read that a test takes down, makes refuse, or holds until released. */
function server<T>(first: T) {
  const state = { answer: first, failure: null as Error | null }
  let held: Promise<void> | null = null
  return {
    read: async (): Promise<T> => {
      if (state.failure) throw state.failure
      const answer = state.answer
      await held
      return answer
    },
    answers: (next: T) => void (state.answer = next),
    /** The network is gone: `fetch` rejects with a `TypeError`. */
    goesDown: () => void (state.failure = new TypeError("Failed to fetch")),
    /**
     * The server answers, and says no, as a socket read does. The REST readers throw `ReadRefused`
     * with the status instead; `read-refusals.test.ts` drives each of them with a real `Response`.
     */
    refuses: () => void (state.failure = new RealtimeRequestError("forbidden", "Forbidden")),
    /** The server answers with an error that says nothing about who may read: it is struggling. */
    struggles: () => void (state.failure = new RealtimeRequestError("internal", "Try again")),
    /** Holds every answer until the returned function is called. */
    holds(): () => void {
      let release!: () => void
      held = new Promise<void>((resolve) => release = resolve)
      return release
    },
  }
}

/** One list: how its store is built over a server and a device, read, and looked at. */
interface ListCase {
  name: string
  /** Two answers of the server, the second newer. */
  answers: [unknown, unknown]
  /** Builds the store, and returns how to read the list and what the screen then shows. */
  open(read: () => Promise<unknown>, device: LocalReads): {
    load(): Promise<unknown>
    shown(): unknown
  }
  /** What the screen shows of an answer. */
  expected(answer: unknown): unknown
  /** What the screen shows before anything was read. */
  empty: unknown
  /** `false` for a number the page never paints early (the bell's count). */
  paintsCopyFirst?: boolean
}

const member = (name: string) => ({ userId: 1, name, role: 1, joinedAt: "", isYou: false })
const billing = (cancelAtPeriodEnd: boolean) => ({
  ok: true,
  status: 200,
  data: {
    billing: {
      enabled: true,
      planId: "pro",
      status: 2,
      currentPeriodEnd: "2026-11-01T00:00:00.000Z",
      cancelAtPeriodEnd,
      trialEnd: null,
      notice: null,
      canManage: true,
      subscribed: true,
      hasCustomer: true,
      seatPrice: { seats: 3, amount: 900, currency: "EUR" },
    },
  },
})
const json = (read: () => Promise<unknown>) => async () =>
  new Response(JSON.stringify(await read()))

const CASES: ListCase[] = [
  {
    name: "the members of a group",
    answers: [
      { members: [member("Ann")], memberCount: 1 },
      { members: [member("Ann"), member("Bob")], memberCount: 2 },
    ],
    open(read, device) {
      const store = createMembersStore({
        list: read as never,
        setRole: unused,
        removeMember: unused,
        leave: unused,
        transfer: unused,
      }, device)
      return { load: () => store.open(groupId), shown: () => store.members.value }
    },
    expected: (answer) => (answer as { members: unknown }).members,
    empty: null,
  },
  {
    name: "the invitations of a group",
    answers: [{ invitations: [{ id: "i-1" }] }, { invitations: [{ id: "i-1" }, { id: "i-2" }] }],
    open(read, device) {
      const store = createInvitationsStore({ fetch: json(read), origin: () => "", device })
      return { load: () => store.open(groupId), shown: () => store.invitations.value }
    },
    expected: (answer) => (answer as { invitations: unknown }).invitations,
    empty: null,
  },
  {
    name: "the invitations sent to the person",
    answers: [{ invitations: [{ id: "i-1" }] }, { invitations: [{ id: "i-2" }] }],
    open(read, device) {
      const store = createInvitationsStore({ fetch: json(read), origin: () => "", device })
      return { load: () => store.loadMine(), shown: () => store.mine.value }
    },
    expected: (answer) => (answer as { invitations: unknown }).invitations,
    empty: [],
  },
  {
    name: "the notifications",
    answers: [
      { notifications: [{ id: "1" }], nextCursor: null, unreadCount: 1 },
      { notifications: [{ id: "2" }, { id: "1" }], nextCursor: null, unreadCount: 2 },
    ],
    open(read, device) {
      const store = createNotificationsStore({
        list: read as never,
        unreadCount: unused,
        markRead: unused,
        markAllRead: unused,
      }, device)
      return { load: () => store.open(), shown: () => store.notifications.value }
    },
    expected: (answer) => (answer as { notifications: unknown }).notifications,
    empty: [],
  },
  {
    name: "the number on the bell",
    answers: [3, 5],
    open(read, device) {
      const store = createNotificationsStore({
        list: unused,
        unreadCount: read as never,
        markRead: unused,
        markAllRead: unused,
      }, device)
      return { load: () => store.refresh(), shown: () => store.unreadCount.value }
    },
    expected: (answer) => answer,
    empty: 0,
    paintsCopyFirst: false,
  },
  {
    name: "the activity of a group",
    answers: [
      { events: [{ id: "1" }], nextCursor: null },
      { events: [{ id: "2" }, { id: "1" }], nextCursor: null },
    ],
    open(read, device) {
      const store = createActivityStore({ list: read as never }, device)
      return { load: () => store.open(groupId), shown: () => store.events.value }
    },
    expected: (answer) => (answer as { events: unknown }).events,
    empty: [],
  },
  {
    name: "the push devices of the profile",
    answers: [
      { user: { id: 7, firstName: "Ada" }, devices: [{ deviceId: "phone" }] },
      { user: { id: 7, firstName: "Ada" }, devices: [{ deviceId: "phone" }, { deviceId: "pc" }] },
    ],
    open(read, device) {
      const store = createProfileStore({
        query: async <T>() => await read() as T,
        command: unused,
      }, device)
      return {
        load: () => store.refresh().catch(() => {}),
        shown: () => store.pushDevices.value,
      }
    },
    expected: (answer) => (answer as { devices: unknown }).devices,
    empty: [],
  },
  {
    name: "the plan of a group",
    answers: [billing(false), billing(true)],
    open(read, device) {
      const store = createBillingStore(read as never, () => {}, device)
      return {
        load: () => store.load(groupId),
        shown: () => store.current.value?.billing.cancelAtPeriodEnd ?? null,
      }
    },
    expected: (answer) => (answer as ReturnType<typeof billing>).data.billing.cancelAtPeriodEnd,
    empty: null,
  },
  {
    name: "the API tokens",
    answers: [
      { ok: true, data: { tokens: [{ id: "t-1" }] } },
      { ok: true, data: { tokens: [{ id: "t-2" }, { id: "t-1" }] } },
    ],
    open(read, device) {
      const store = createApiTokensStore(
        { list: read as never, create: unused, revoke: unused },
        device,
      )
      return { load: () => store.load().catch(() => {}), shown: () => store.tokens.value }
    },
    expected: (answer) => (answer as { data: { tokens: unknown } }).data.tokens,
    empty: null,
  },
  {
    name: "the signed-in devices",
    answers: [
      { ok: true, sessions: [{ id: 1 }] },
      { ok: true, sessions: [{ id: 1 }, { id: 2 }] },
    ],
    open(read, device) {
      const store = createDevicesStore(read as never, device)
      return { load: () => store.load(), shown: () => store.sessions.value }
    },
    expected: (answer) => (answer as { sessions: unknown }).sessions,
    empty: null,
  },
]

/** Lets the device answer: its reads resolve within a few turns. */
async function deviceAnswered(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  sessionState.value = signedOut
})

for (const list of CASES) {
  describe(`${list.name}, on the device`, () => {
    const [older, newer] = list.answers

    /** A device that one visit left its copy on, and the server that visit read. */
    async function visited(device: LocalReads) {
      const api = server(older)
      await list.open(api.read, device).load()
      return api
    }

    it("are what the screen shows when the server is unreachable", async () => {
      const device = memoryReads()
      const api = await visited(device)
      api.goesDown()

      const page = list.open(api.read, device)
      await page.load()

      expect(page.shown()).toEqual(list.expected(older))
    })

    it("are replaced by every answer of the server", async () => {
      const device = memoryReads()
      const api = await visited(device)
      api.answers(newer)
      await list.open(api.read, device).load()
      api.goesDown()

      const page = list.open(api.read, device)
      await page.load()

      expect(page.shown()).toEqual(list.expected(newer))
    })

    it("do not stand in for a server that refuses the read", async () => {
      const device = memoryReads()
      const api = await visited(device)
      api.refuses()

      const page = list.open(api.read, device)
      await page.load()

      expect(page.shown()).toEqual(list.empty)
    })

    it("are deleted when the server refuses the read, so they are not shown offline later", async () => {
      const device = memoryReads()
      const api = await visited(device)
      api.refuses()
      await list.open(api.read, device).load()
      api.goesDown()

      const page = list.open(api.read, device)
      await page.load()

      expect(page.shown()).toEqual(list.empty)
    })

    it("are kept when the server fails without refusing the read", async () => {
      const device = memoryReads()
      const api = await visited(device)
      api.struggles()
      await list.open(api.read, device).load()
      api.goesDown()

      const page = list.open(api.read, device)
      await page.load()

      expect(page.shown()).toEqual(list.expected(older))
    })

    it("are not kept while the local-data module is off", async () => {
      const api = await visited(noLocalReads)
      api.goesDown()

      const page = list.open(api.read, noLocalReads)
      await page.load()

      expect(page.shown()).toEqual(list.empty)
    })

    if (list.paintsCopyFirst !== false) {
      it("show before the server has answered, and give way to its answer", async () => {
        const device = memoryReads()
        const api = await visited(device)
        api.answers(newer)
        const release = api.holds()

        const page = list.open(api.read, device)
        const loading = page.load()
        await deviceAnswered()
        const early = page.shown()
        release()
        await loading

        expect([early, page.shown()]).toEqual([list.expected(older), list.expected(newer)])
      })
    }
  })
}

describe("a list that may mislead when it is old", () => {
  const TAKEN_AT = Date.UTC(2026, 9, 10, 8, 30)
  const stores = {
    "the API tokens": (read: () => Promise<unknown>, device: LocalReads) => {
      const store = createApiTokensStore(
        { list: read as never, create: unused, revoke: unused },
        device,
      )
      return { load: () => store.load(), savedAt: store.savedAt }
    },
    "the signed-in devices": (read: () => Promise<unknown>, device: LocalReads) => {
      const store = createDevicesStore(read as never, device)
      return { load: () => store.load(), savedAt: store.savedAt }
    },
  }
  const answer = { ok: true, data: { tokens: [] }, sessions: [] }

  for (const [name, open] of Object.entries(stores)) {
    it(`${name} carry the time of the copy when they come from the device, and none when the server answered`, async () => {
      const device = memoryReads(() => TAKEN_AT)
      const api = server<unknown>(answer)
      const online = open(api.read, device)
      await online.load()
      api.goesDown()
      const offline = open(api.read, device)
      await offline.load()

      expect([online.savedAt.value, offline.savedAt.value]).toEqual([null, TAKEN_AT])
    })
  }
})

describe("the profile, read from the device", () => {
  it("does not replace the name the session holds with the copy's older one", async () => {
    const device = memoryReads()
    const api = server<unknown>({ user: { id: 7, firstName: "Ada" }, devices: [] })
    const open = () =>
      createProfileStore({ query: async <T>() => await api.read() as T, command: unused }, device)
    await open().refresh()
    // The person renamed themselves; the session (and what the device remembers) has the new name.
    sessionState.value = { ...sessionState.value, user: { id: 7, firstName: "Augusta" } as never }
    api.goesDown()

    await open().refresh()

    expect(sessionState.value.user?.firstName).toBe("Augusta")
  })
})
