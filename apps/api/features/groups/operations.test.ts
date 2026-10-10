import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupCreateCommand, GroupError, GroupRole } from "@domain/groups"
import type {
  GroupGetQuery,
  GroupListQuery,
  GroupRepository,
  GroupSelectCommand,
  GroupSelectedQuery,
} from "@domain/groups"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { createGroupOperations } from "./operations.ts"
import { createGroupGetHandler } from "./handlers.ts"
import { toRequestError } from "../../services/realtime.ts"
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, parseListPayload } from "./list.ts"

const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const actor = {
  userId: 7,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
}

const signal = new AbortController().signal

/** The rename, delete, restore and member requests, which these tests never call. */
const UNUSED_GROUP_CHANGES = {
  rename: () => Promise.reject(new Error("not used")),
  updateDetails: () => Promise.reject(new Error("not used")),
  delete: () => Promise.reject(new Error("not used")),
  restore: () => Promise.reject(new Error("not used")),
  deleted: () => Promise.reject(new Error("not used")),
  members: () => Promise.reject(new Error("not used")),
  setRole: () => Promise.reject(new Error("not used")),
  removeMember: () => Promise.reject(new Error("not used")),
  leave: () => Promise.reject(new Error("not used")),
  moveAll: () => Promise.reject(new Error("not used")),
}

function harness() {
  const seen: {
    command: GroupCreateCommand | null
    query: GroupListQuery | null
    get: GroupGetQuery | null
    select: GroupSelectCommand | null
    selected: GroupSelectedQuery | null
  } = {
    command: null,
    query: null,
    get: null,
    select: null,
    selected: null,
  }
  const requests = createGroupOperations({
    create(command) {
      seen.command = command
      return Promise.resolve({
        created: true,
        group: {
          id,
          name: command.data.name,
          description: "",
          color: null,
          emoji: null,
          role: GroupRole.OWNER,
          authorizationRevision: "1",
          changeSequence: "1",
          updatedAt: new Date(0),
        },
      })
    },
    get(query) {
      seen.get = query
      return Promise.resolve({
        group: {
          id: query.data.groupId,
          name: "Team",
          description: "",
          color: null,
          emoji: null,
          role: GroupRole.VIEWER,
          authorizationRevision: "1",
          changeSequence: "1",
          updatedAt: new Date(0),
        },
      })
    },
    select(command) {
      seen.select = command
      return Promise.resolve({ groupId: command.data.groupId, version: 2 })
    },
    selected(query) {
      seen.selected = query
      return Promise.resolve({ groupId: id, version: 2 })
    },
    ...UNUSED_GROUP_CHANGES,
    list(query) {
      seen.query = query
      return Promise.resolve({ groups: [], nextPageKey: { updatedAt: new Date(0), id } })
    },
    cursor: {
      encode: (userId) => Promise.resolve(`cursor-for-${userId}`),
      decode: (cursor) => Promise.resolve({ updatedAt: new Date(0), id: cursor }),
    },
  })
  return { requests, seen }
}

describe("group socket requests", () => {
  it("declares create as a command and list as a query", () => {
    const { requests } = harness()

    expect(requests["group.create"].kind).toBe("command")
    expect(requests["group.list"].kind).toBe("query")
  })

  it("dispatches create with the actor, request id and idempotency key of the call", async () => {
    const { requests, seen } = harness()

    await requests["group.create"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { id, name: " Team " },
    })

    expect(seen.command?.data).toEqual({
      actor,
      id,
      name: "Team",
      requestId: "req-1",
      idempotencyKey: "key-1",
    })
  })

  it("refuses a create payload that names a user", async () => {
    const { requests, seen } = harness()

    await expect(requests["group.create"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { id, name: "Team", userId: 999 },
    })).rejects.toBeInstanceOf(GroupError)
    expect(seen.command).toBe(null)
  })

  it("reads one group by id for the actor", async () => {
    const { requests, seen } = harness()

    const result = await requests["group.get"].handle({
      actor,
      requestId: "req-3",
      signal,
      payload: { groupId: id },
    })

    expect(requests["group.get"].kind).toBe("query")
    expect(seen.get?.data).toEqual({ actor, groupId: id })
    expect(result).toMatchObject({ group: { id } })
  })

  for (
    const [name, payload] of [
      ["a missing payload", undefined],
      ["a malformed id", { groupId: "nope" }],
      ["an extra field", { groupId: id, userId: 9 }],
    ] as const
  ) {
    it(`refuses group.get with ${name}`, async () => {
      const { requests, seen } = harness()

      await expect(requests["group.get"].handle({ actor, requestId: "r", signal, payload }))
        .rejects.toBeInstanceOf(GroupError)
      expect(seen.get).toBe(null)
    })
  }

  it("answers a stranger's group id and an unknown id with the same error kind", async () => {
    const ownGroup = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111aaa"
    const handler = createGroupGetHandler({
      getSummaryForMember: (groupId: string, userId: number) =>
        Promise.resolve(
          groupId === ownGroup && userId === 19
            ? {
              id: ownGroup,
              name: "Team",
              description: "",
              color: null,
              emoji: null,
              role: GroupRole.OWNER,
              authorizationRevision: "1",
              changeSequence: "1",
              updatedAt: new Date(0),
            }
            : null,
        ),
    } as GroupRepository)
    const requests = createGroupOperations({
      create: () => Promise.reject(new Error("not used")),
      list: () => Promise.reject(new Error("not used")),
      get: handler,
      select: () => Promise.reject(new Error("not used")),
      selected: () => Promise.reject(new Error("not used")),
      ...UNUSED_GROUP_CHANGES,
      cursor: { encode: () => Promise.resolve(""), decode: () => Promise.reject(new Error("x")) },
    })
    const ask = async (groupId: string) => {
      try {
        await requests["group.get"].handle({
          actor: { ...actor, userId: 20 },
          requestId: "r",
          signal,
          payload: { groupId },
        })
      } catch (error) {
        const mapped = toRequestError(error)
        return [mapped?.code, mapped?.message]
      }
      return ["answered"]
    }

    const stranger = await ask(ownGroup)
    const unknown = await ask("7b6d8d6c-1af5-4f04-8ae4-b1ee5d111bbb")

    expect(stranger[0]).toBe("not_found")
    expect(stranger).toEqual(unknown)
  })

  it("lists the actor's groups and returns the next cursor", async () => {
    const { requests, seen } = harness()

    const page = await requests["group.list"].handle({
      actor,
      requestId: "req-2",
      signal,
      payload: { limit: 10, cursor: "abc" },
    })

    expect(seen.query?.data.actor).toEqual(actor)
    expect(seen.query?.data.page.limit).toBe(10)
    expect(seen.query?.data.page.after?.id).toBe("abc")
    expect(page).toEqual({ groups: [], nextCursor: "cursor-for-7" })
  })
})

describe("group selection over the socket", () => {
  it("declares select as a command and selected as a query", () => {
    const { requests } = harness()

    expect(requests["group.select"].kind).toBe("command")
    expect(requests["group.selected"].kind).toBe("query")
  })

  it("selects the named group for the actor and carries the idempotency key", async () => {
    const { requests, seen } = harness()

    const result = await requests["group.select"].handle({
      actor,
      requestId: "req-3",
      signal,
      payload: { groupId: id },
      idempotencyKey: "key-1",
    })

    expect(seen.select?.data).toEqual({
      actor,
      groupId: id,
      requestId: "req-3",
      idempotencyKey: "key-1",
    })
    expect(result).toEqual({ groupId: id, version: 2 })
  })

  for (
    const [name, payload] of [
      ["no payload", undefined],
      ["a group id that is not a UUID", { groupId: "nope" }],
      ["an unknown field", { groupId: id, userId: 1 }],
      ["a missing group id", {}],
    ] as const
  ) {
    it(`refuses to select with ${name}, before any command runs`, async () => {
      const { requests, seen } = harness()

      await expect(
        requests["group.select"].handle({ actor, requestId: "r", signal, payload }),
      ).rejects.toThrow(GroupError)
      expect(seen.select).toBe(null)
    })
  }

  it("reads the selection of the actor", async () => {
    const { requests, seen } = harness()

    const result = await requests["group.selected"].handle({
      actor,
      requestId: "req-4",
      signal,
      payload: undefined,
    })

    expect(seen.selected?.data).toEqual({ actor })
    expect(result).toEqual({ groupId: id, version: 2 })
  })
})

describe("group.list payload", () => {
  it("defaults to the first page of the default size", () => {
    expect(parseListPayload(undefined)).toEqual({ limit: DEFAULT_LIST_LIMIT })
    expect(parseListPayload(null)).toEqual({ limit: DEFAULT_LIST_LIMIT })
  })

  it("accepts a limit up to the maximum", () => {
    expect(parseListPayload({ limit: MAX_LIST_LIMIT }).limit).toBe(MAX_LIST_LIMIT)
  })

  for (
    const [name, payload] of [
      ["a limit of zero", { limit: 0 }],
      ["a limit above the maximum", { limit: MAX_LIST_LIMIT + 1 }],
      ["a fractional limit", { limit: 1.5 }],
      ["an empty cursor", { cursor: "" }],
      ["a numeric cursor", { cursor: 5 }],
      ["an unknown field", { userId: 1 }],
      ["an array", []],
      ["a string", "x"],
    ] as const
  ) {
    it(`rejects ${name}`, () => {
      expect(() => parseListPayload(payload)).toThrow(GroupError)
    })
  }
})

describe("group changes over the socket", () => {
  /** The three commands, each recording what the socket dispatched to it. */
  function changes() {
    const seen: { name: string; data: object }[] = []
    const record = (name: string) => (command: { data: object }) => {
      seen.push({ name, data: command.data })
      return Promise.resolve({
        group: {
          id,
          name: "Team",
          description: "",
          color: null,
          emoji: null,
          role: GroupRole.OWNER,
          authorizationRevision: "1",
          changeSequence: "1",
          updatedAt: new Date(0),
          deletedAt: new Date(0),
        },
      })
    }
    const requests = createGroupOperations({
      create: () => Promise.reject(new Error("not used")),
      list: () => Promise.reject(new Error("not used")),
      get: () => Promise.reject(new Error("not used")),
      select: () => Promise.reject(new Error("not used")),
      selected: () => Promise.reject(new Error("not used")),
      cursor: {
        encode: () => Promise.reject(new Error("not used")),
        decode: () => Promise.reject(),
      },
      rename: record("rename"),
      updateDetails: record("updateDetails"),
      delete: record("delete"),
      restore: record("restore"),
      deleted: () => Promise.resolve({ groups: [] }),
      members: () => Promise.reject(new Error("not used")),
      setRole: () => Promise.reject(new Error("not used")),
      removeMember: () => Promise.reject(new Error("not used")),
      leave: () => Promise.reject(new Error("not used")),
      moveAll: () => Promise.reject(new Error("not used")),
    })
    return { requests, seen }
  }

  const call = { actor, requestId: "req-1", signal, idempotencyKey: "key-1" }

  it("declares rename, delete and restore as commands and the deleted list as a query", () => {
    const { requests } = changes()

    expect(requests["group.rename"].kind).toBe("command")
    expect(requests["group.delete"].kind).toBe("command")
    expect(requests["group.restore"].kind).toBe("command")
    expect(requests["group.deleted"].kind).toBe("query")
  })

  it("dispatches each command with the actor, group, request id and idempotency key", async () => {
    const { requests, seen } = changes()

    await requests["group.rename"].handle({ ...call, payload: { groupId: id, name: " Trip " } })
    await requests["group.delete"].handle({ ...call, payload: { groupId: id } })
    await requests["group.restore"].handle({ ...call, payload: { groupId: id } })

    const common = { actor, groupId: id, requestId: "req-1", idempotencyKey: "key-1" }
    expect(seen).toEqual([
      { name: "rename", data: { ...common, name: "Trip" } },
      { name: "delete", data: common },
      { name: "restore", data: common },
    ])
  })

  it("refuses a payload with fields it does not know, before any command runs", async () => {
    const { requests, seen } = changes()

    for (
      const [name, payload] of [
        ["group.rename", { groupId: id, name: "Trip", userId: 999 }],
        ["group.rename", { groupId: id }],
        ["group.delete", { groupId: id, force: true }],
        ["group.restore", {}],
      ] as const
    ) {
      await expect(requests[name].handle({ ...call, payload })).rejects.toBeInstanceOf(GroupError)
    }
    expect(seen).toEqual([])
  })
})
