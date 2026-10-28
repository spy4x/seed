import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import { createMemoryReadCache } from "@spy4x/realtime/testing"
import { createLocalReads, type LocalReads } from "../modules.ts"
import { activityHttp, createActivityStore } from "./activity.ts"
import { apiTokensHttp, createApiTokensStore } from "./api-tokens.ts"
import { apiFetch } from "./api.ts"
import { createBillingStore } from "./billing.ts"
import { createDevicesStore } from "./devices.ts"
import { createGroupsStore, groupsOnDevice, onlineGroups } from "./groups.ts"
import { createInvitationsStore } from "./invitations.ts"
import { createMembersStore, membersHttp } from "./members.ts"
import { memoryReads } from "./memory-reads.ts"
import { ReadRefused } from "@spy4x/realtime/read-cache"
import { createNotificationsStore, notificationsHttp } from "./notifications.ts"
import { sessionState } from "./session.ts"

/**
 * What a list does with its saved copy when the server answers it with an error (ADR 003). The
 * stores are the production ones, over their own readers; only the network is replaced, by a
 * `fetch` that answers with a real `Response`. A refusal (401, 403, 404) deletes the copy, so it is
 * not shown offline later; a struggling server (500) keeps it. Those carry the API's error body. An
 * answer without an error code is taken for the proxy's in front of the API (a 502, a bare 404, and
 * also a 429 or a 500 without a code): the copy answers it, as it does with no network. A 401 or a
 * 403 deletes the copy with or without a code.
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const signedOut = sessionState.value

const billing = {
  billing: {
    enabled: true,
    planId: "pro",
    status: 2,
    currentPeriodEnd: "2026-11-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    trialEnd: null,
    notice: null,
    canManage: true,
    subscribed: true,
    hasCustomer: true,
    seatPrice: { seats: 3, amount: 900, currency: "EUR" },
  },
}

interface Case {
  name: string
  /** What the server answers to a read that works. */
  body: unknown
  open(device: LocalReads): { load(): Promise<unknown>; shown(): Promise<unknown> | unknown }
  /** What the screen shows after a read that works: `body`'s list, as the store paints it. */
  painted: unknown
  /** What the screen shows when the device holds nothing. */
  empty: unknown
}

const CASES: Case[] = [
  {
    name: "the members of a group",
    body: {
      members: [{ userId: 1, name: "Ann", role: 1, joinedAt: "", isYou: false }],
      memberCount: 1,
    },
    open(device) {
      const store = createMembersStore(membersHttp, device)
      return { load: () => store.open(groupId), shown: () => store.members.value }
    },
    painted: [{ userId: 1, name: "Ann", role: 1, joinedAt: "", isYou: false }],
    empty: null,
  },
  {
    name: "the invitations of a group",
    body: { invitations: [{ id: "i-1" }] },
    open(device) {
      const store = createInvitationsStore({ device })
      return { load: () => store.open(groupId), shown: () => store.invitations.value }
    },
    painted: [{ id: "i-1" }],
    empty: null,
  },
  {
    name: "the invitations sent to the person",
    body: { invitations: [{ id: "i-1" }] },
    open(device) {
      const store = createInvitationsStore({ device })
      return { load: () => store.loadMine(), shown: () => store.mine.value }
    },
    painted: [{ id: "i-1" }],
    empty: [],
  },
  {
    name: "the notifications",
    body: { notifications: [{ id: "1" }], nextCursor: null, unreadCount: 1 },
    open(device) {
      const store = createNotificationsStore(notificationsHttp, device)
      return { load: () => store.open(), shown: () => store.notifications.value }
    },
    painted: [{ id: "1" }],
    empty: [],
  },
  {
    name: "the number on the bell",
    body: { unreadCount: 3 },
    open(device) {
      const store = createNotificationsStore(notificationsHttp, device)
      return { load: () => store.refresh(), shown: () => store.unreadCount.value }
    },
    painted: 3,
    empty: 0,
  },
  {
    name: "the activity of a group",
    body: { events: [{ id: "1" }], nextCursor: null },
    open(device) {
      const store = createActivityStore(activityHttp, device)
      return { load: () => store.open(groupId), shown: () => store.events.value }
    },
    painted: [{ id: "1" }],
    empty: [],
  },
  {
    name: "the groups",
    body: { groups: [{ id: groupId, changeSequence: "1" }], nextCursor: null },
    open(device) {
      const dependencies = groupsOnDevice(onlineGroups, device)
      const store = createGroupsStore(dependencies)
      let copy: unknown = null
      return {
        load: async () => {
          await store.refresh().catch(() => {})
          copy = await dependencies.readLocal?.()
        },
        shown: () => copy,
      }
    },
    painted: [{ id: groupId, changeSequence: "1" }],
    empty: [],
  },
  {
    name: "the plan of a group",
    body: billing,
    open(device) {
      const store = createBillingStore(apiFetch, () => {}, device)
      return {
        load: () => store.load(groupId),
        shown: () => store.current.value?.billing.planId ?? null,
      }
    },
    painted: "pro",
    empty: null,
  },
  {
    name: "the API tokens",
    body: { tokens: [{ id: "t-1" }] },
    open(device) {
      const store = createApiTokensStore(apiTokensHttp, device)
      return { load: () => store.load(), shown: () => store.tokens.value }
    },
    painted: [{ id: "t-1" }],
    empty: null,
  },
  {
    name: "the signed-in devices",
    body: { sessions: [{ id: 1 }] },
    open(device) {
      const store = createDevicesStore(undefined, device)
      return { load: () => store.load(), shown: () => store.sessions.value }
    },
    painted: [{ id: 1 }],
    empty: null,
  },
]

/** A status with the API's error body, a page with that status and no error code, or no network. */
type Answer = number | { proxy: number } | "offline"

describe("a saved copy and the answer of the server", () => {
  const realFetch = globalThis.fetch
  let answer: Answer = 200
  let body: unknown = null

  beforeEach(() => {
    globalThis.fetch = (() => {
      if (answer === "offline") return Promise.reject(new TypeError("Failed to fetch"))
      if (typeof answer === "object") {
        return Promise.resolve(new Response("<h1>Bad Gateway</h1>", { status: answer.proxy }))
      }
      return Promise.resolve(
        answer === 200 ? Response.json(body) : Response.json(
          // The API's own refusal names its reason; `code` is the one its status stands for.
          {
            error: { code: answer === 500 ? "internal" : "forbidden", message: "No", reason: "NO" },
          },
          { status: answer },
        ),
      )
    }) as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    sessionState.value = signedOut
  })

  for (const list of CASES) {
    describe(list.name, () => {
      /** One visit that worked, then one that got `status`, then the network goes. */
      async function afterAnswer(status: Exclude<Answer, "offline">) {
        // A store may let a failed read throw; the screen shows what the store holds either way.
        const quietly = async (open: ReturnType<Case["open"]>) => {
          await open.load().catch(() => {})
        }
        body = list.body
        const device = memoryReads()
        answer = 200
        const first = list.open(device)
        await quietly(first)
        const shownOnline = await first.shown()
        answer = status
        const second = list.open(device)
        await quietly(second)
        const shownThen = await second.shown()
        answer = "offline"
        const offline = list.open(device)
        await quietly(offline)
        return { shownOnline, shownThen, shownOffline: await offline.shown() }
      }

      for (const status of [401, 403, 404]) {
        it(`are deleted when the server answers ${status}, so they are not shown offline later`, async () => {
          const { shownOnline, shownOffline } = await afterAnswer(status)
          expect(shownOnline).toStrictEqual(list.painted)
          expect(shownOffline).toEqual(list.empty)
        })
      }

      it("are kept when the server answers 500", async () => {
        const { shownOnline, shownOffline } = await afterAnswer(500)
        expect(shownOnline).toStrictEqual(list.painted)
        expect(shownOffline).toStrictEqual(shownOnline)
      })

      for (const status of [401, 403]) {
        it(`are deleted on a ${status} without an error code`, async () => {
          const { shownOnline, shownOffline } = await afterAnswer({ proxy: status })
          expect(shownOnline).toStrictEqual(list.painted)
          expect(shownOffline).toEqual(list.empty)
        })
      }

      // 502 and a bare 404 are the proxy's during a deploy; the API's own rate limit (429) and
      // unhandled error (500) carry no code either, and are answered the same way.
      for (const status of [502, 404, 429, 500]) {
        it(`are shown and kept on a ${status} without an error code`, async () => {
          const { shownOnline, shownThen, shownOffline } = await afterAnswer({ proxy: status })
          expect(shownOnline).toStrictEqual(list.painted)
          expect(shownThen).toStrictEqual(shownOnline)
          expect(shownOffline).toStrictEqual(shownOnline)
        })
      }
    })
  }

  it("answer a proxy's 502 with the time they were saved at, and no error", async () => {
    body = { tokens: [{ id: "t-1" }] }
    const device = memoryReads(() => 1234)
    answer = 200
    await createApiTokensStore(apiTokensHttp, device).load()

    answer = { proxy: 502 }
    const store = createApiTokensStore(apiTokensHttp, device)
    await store.load()

    expect(store.tokens.value).toEqual([{ id: "t-1" }])
    expect(store.savedAt.value).toBe(1234)
    expect(store.errors.value.list).toBeNull()
  })

  it("show the error of a proxy's 502 when the device holds nothing", async () => {
    answer = { proxy: 502 }
    const store = createApiTokensStore(apiTokensHttp, memoryReads())
    await store.load()

    expect(store.tokens.value).toBeNull()
    expect(store.errors.value.list).toBe("Request failed")
  })
})

describe("a saved copy the device cannot read just now", () => {
  /** A device that holds a copy, fails to read it, and counts what it is asked to delete. */
  async function unreadable() {
    const cache = createMemoryReadCache(() => 0)
    await cache.set("list", ["saved"])
    const deleted: string[] = []
    const reads = createLocalReads(() => ({
      ...cache,
      get: () => Promise.reject(new Error("the device cannot read")),
      delete: (key) => (deleted.push(key), cache.delete(key)),
    }))
    const answered = (status: number, code?: string) =>
      reads.through("list", () => Promise.reject(new ReadRefused("No", status, code))).catch(
        (error) => error,
      )
    return { answered, deleted }
  }

  it("is not deleted by a 404 without the API's error code", async () => {
    const { answered, deleted } = await unreadable()

    expect(await answered(404)).toBeInstanceOf(ReadRefused)
    expect(deleted).toEqual([])
  })

  it("is deleted by a 404 with the API's error code", async () => {
    const { answered, deleted } = await unreadable()

    expect(await answered(404, "GROUP_NOT_FOUND")).toBeInstanceOf(ReadRefused)
    expect(deleted).toEqual(["list"])
  })
})
