import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import { type LocalReads } from "../modules.ts"
import { activityHttp, createActivityStore } from "./activity.ts"
import { apiTokensHttp, createApiTokensStore } from "./api-tokens.ts"
import { apiFetch } from "./api.ts"
import { createBillingStore } from "./billing.ts"
import { createDevicesStore } from "./devices.ts"
import { createGroupsStore, groupsOnDevice, onlineGroups } from "./groups.ts"
import { createInvitationsStore } from "./invitations.ts"
import { createMembersStore, membersHttp } from "./members.ts"
import { memoryReads } from "./memory-reads.ts"
import { createNotificationsStore, notificationsHttp } from "./notifications.ts"
import { sessionState } from "./session.ts"

/**
 * What a list does with its saved copy when the server answers it with an error (ADR 003). The
 * stores are the production ones, over their own readers; only the network is replaced, by a
 * `fetch` that answers with a real `Response`. A refusal (401, 403, 404) deletes the copy, so it is
 * not shown offline later; a struggling server (500) keeps it.
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
    empty: null,
  },
  {
    name: "the invitations of a group",
    body: { invitations: [{ id: "i-1" }] },
    open(device) {
      const store = createInvitationsStore({ device })
      return { load: () => store.open(groupId), shown: () => store.invitations.value }
    },
    empty: null,
  },
  {
    name: "the invitations sent to the person",
    body: { invitations: [{ id: "i-1" }] },
    open(device) {
      const store = createInvitationsStore({ device })
      return { load: () => store.loadMine(), shown: () => store.mine.value }
    },
    empty: [],
  },
  {
    name: "the notifications",
    body: { notifications: [{ id: "1" }], nextCursor: null, unreadCount: 1 },
    open(device) {
      const store = createNotificationsStore(notificationsHttp, device)
      return { load: () => store.open(), shown: () => store.notifications.value }
    },
    empty: [],
  },
  {
    name: "the number on the bell",
    body: { unreadCount: 3 },
    open(device) {
      const store = createNotificationsStore(notificationsHttp, device)
      return { load: () => store.refresh(), shown: () => store.unreadCount.value }
    },
    empty: 0,
  },
  {
    name: "the activity of a group",
    body: { events: [{ id: "1" }], nextCursor: null },
    open(device) {
      const store = createActivityStore(activityHttp, device)
      return { load: () => store.open(groupId), shown: () => store.events.value }
    },
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
    empty: null,
  },
  {
    name: "the API tokens",
    body: { tokens: [{ id: "t-1" }] },
    open(device) {
      const store = createApiTokensStore(apiTokensHttp, device)
      return { load: () => store.load(), shown: () => store.tokens.value }
    },
    empty: null,
  },
  {
    name: "the signed-in devices",
    body: { sessions: [{ id: 1 }] },
    open(device) {
      const store = createDevicesStore(undefined, device)
      return { load: () => store.load(), shown: () => store.sessions.value }
    },
    empty: null,
  },
]

type Answer = number | "offline"

describe("a saved copy and the answer of the server", () => {
  const realFetch = globalThis.fetch
  let answer: Answer = 200
  let body: unknown = null

  beforeEach(() => {
    globalThis.fetch = (() => {
      if (answer === "offline") return Promise.reject(new TypeError("Failed to fetch"))
      return Promise.resolve(
        answer === 200
          ? Response.json(body)
          : Response.json({ error: { message: "No" } }, { status: answer }),
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
      async function afterAnswer(status: number) {
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
        await quietly(list.open(device))
        answer = "offline"
        const offline = list.open(device)
        await quietly(offline)
        return { shownOnline, shownOffline: await offline.shown() }
      }

      for (const status of [401, 403, 404]) {
        it(`are deleted when the server answers ${status}, so they are not shown offline later`, async () => {
          const { shownOnline, shownOffline } = await afterAnswer(status)
          expect(shownOnline).not.toEqual(list.empty)
          expect(shownOffline).toEqual(list.empty)
        })
      }

      it("are kept when the server answers 500", async () => {
        const { shownOnline, shownOffline } = await afterAnswer(500)
        expect(shownOnline).not.toEqual(list.empty)
        expect(shownOffline).toEqual(shownOnline)
      })
    })
  }
})
