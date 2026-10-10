import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { CommandBus } from "@spy4x/platform/cqrs"
import {
  type GroupDataMover,
  GroupMoveAllCommand,
  type GroupMoveAllInput,
  type GroupRepository,
  GroupRole,
} from "@domain/groups"
import { FREE_PLAN_ID, PlanError, PRO_PLAN_ID } from "@domain/billing"
import { createSessionGate } from "../../cqrs/session-gate.ts"
import { createEntitlementGate } from "../../cqrs/entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "../../cqrs/entitlement-needs.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import type { APIContext } from "../../_types.ts"
import { createGroupsRoute, type GroupsRouteDependencies } from "../../routes/groups.ts"
import { Realtime } from "../../services/realtime.ts"
import { createGroupMoveAllHandler } from "./handlers.ts"
import { createGroupOperations } from "./operations.ts"

/**
 * Moving all of a group's data over both transports, on the bus as the API wires it (session gate,
 * entitlement gate, the real handler). The mover is a fake that records what it was asked, so a
 * handler that skipped a role check, or a transport that dropped a field, shows.
 */

const FROM = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const TO = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"
const EDITOR = 3
const VIEWER_OF_SOURCE = 4
const VIEWER_OF_TARGET = 5
const STRANGER_TO_TARGET = 6

/** Who holds which role where. A person absent from a group is a stranger to it. */
const ROLES: Record<string, Record<number, GroupRole>> = {
  [FROM]: {
    [EDITOR]: GroupRole.EDITOR,
    [VIEWER_OF_SOURCE]: GroupRole.VIEWER,
    [VIEWER_OF_TARGET]: GroupRole.EDITOR,
    [STRANGER_TO_TARGET]: GroupRole.OWNER,
  },
  [TO]: {
    [EDITOR]: GroupRole.ADMIN,
    [VIEWER_OF_SOURCE]: GroupRole.EDITOR,
    [VIEWER_OF_TARGET]: GroupRole.VIEWER,
  },
}

function stack(plans: Record<string, string> = { [FROM]: PRO_PLAN_ID, [TO]: PRO_PLAN_ID }) {
  const repository = {
    getForMember: (groupId: string, userId: number) => {
      const role = ROLES[groupId]?.[userId]
      return Promise.resolve(role === undefined ? null : { role })
    },
  } as unknown as GroupRepository
  const calls: { input: GroupMoveAllInput; actorId: number; allowances: unknown }[] = []
  const mover: GroupDataMover = {
    moveAll: (input, actorId, allowances) => {
      calls.push({ input, actorId, allowances })
      return Promise.resolve({ moved: 3, counts: { notes: 3 } })
    },
  }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.use(createEntitlementGate({
    billingEnabled: true,
    planOf: (groupId) => Promise.resolve(plans[groupId]),
    roleOf: (groupId, userId) => Promise.resolve(ROLES[groupId]?.[userId] ?? null),
    usage: {
      maxNotes: () => Promise.reject(new Error("the move counts in its own transaction")),
      maxMembers: () => Promise.reject(new Error("not part of this test")),
    },
  }, ENTITLEMENT_NEEDS))
  commands.register(GroupMoveAllCommand, createGroupMoveAllHandler(repository, mover))
  const unused = () => Promise.reject(new Error("not part of this test"))
  const buses = {
    create: unused,
    list: unused,
    get: unused,
    select: unused,
    selected: unused,
    cursor: { encode: unused, decode: unused },
    rename: unused,
    updateDetails: unused,
    delete: unused,
    restore: unused,
    deleted: unused,
    members: unused,
    setRole: unused,
    removeMember: unused,
    leave: unused,
    transfer: unused,
    moveAll: (command: GroupMoveAllCommand) => commands.execute(command),
    passwordLimit: async (_c, next) => await next(),
  } satisfies GroupsRouteDependencies
  return { buses, calls, mover }
}

function rest(buses: GroupsRouteDependencies, userId: number) {
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-move-all")
    c.set("auth", buildAuthData({ user: { id: userId }, session: { userId } }))
    await next()
  })
  app.route("/groups", createGroupsRoute(buses))
  return (path: string, body?: unknown) =>
    app.request(`http://local/groups${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: "http://local",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(body),
    })
}

function socket(buses: GroupsRouteDependencies, userId: number) {
  const auth = buildAuthData({ user: { id: userId }, session: { id: userId * 10, userId } })
  const realtime = new Realtime({
    clock: new FakeClock(),
    entitledSession: () => Promise.resolve(auth),
    memberUserIds: () => Promise.resolve([]),
    operations: createGroupOperations(buses),
    log: () => {},
  })
  const ws = new FakeSocket("wss://app.example.com/api/ws")
  ws.openFromPeer()
  realtime.attach(ws, auth)
  return {
    command: async (payload: unknown) => {
      ws.receive(JSON.stringify({
        kind: "client.command",
        id: "frame-1",
        name: "group.moveAll",
        payload,
        idempotencyKey: "key-1",
      }))
      await drainMicrotasks(64)
      return ws.frames().find((frame) => (frame as { requestId?: string }).requestId === "frame-1")
    },
    shutdown: () => realtime.shutdown(),
  }
}

describe("moving all of a group's data over REST", () => {
  it("moves it for an editor of both groups and returns what moved", async () => {
    const { buses, calls } = stack()

    const response = await rest(buses, EDITOR)(`/${FROM}/move-all`, { toGroupId: TO })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ moved: 3, counts: { notes: 3 } })
    expect(calls).toEqual([{
      input: { fromGroupId: FROM, toGroupId: TO, requestId: "req-move-all" },
      actorId: EDITOR,
      allowances: { maxNotes: null },
    }])
  })

  it("refuses a viewer of the source group and moves nothing", async () => {
    const { buses, calls } = stack()

    const response = await rest(buses, VIEWER_OF_SOURCE)(`/${FROM}/move-all`, { toGroupId: TO })

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
    expect(calls).toEqual([])
  })

  it("refuses a viewer of the target group and moves nothing", async () => {
    const { buses, calls } = stack()

    const response = await rest(buses, VIEWER_OF_TARGET)(`/${FROM}/move-all`, { toGroupId: TO })

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
    expect(calls).toEqual([])
  })

  it("tells a stranger to the target that the group does not exist", async () => {
    const { buses, calls } = stack()

    const response = await rest(buses, STRANGER_TO_TARGET)(`/${FROM}/move-all`, { toGroupId: TO })

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe("GROUP_NOT_FOUND")
    expect(calls).toEqual([])
  })

  it("refuses a move into the same group", async () => {
    const { buses, calls } = stack()

    const response = await rest(buses, EDITOR)(`/${FROM}/move-all`, { toGroupId: FROM })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe("SAME_GROUP")
    expect(calls).toEqual([])
  })

  it("refuses a body that names anything but the target group", async () => {
    const { buses, calls } = stack()

    const response = await rest(buses, EDITOR)(`/${FROM}/move-all`, {
      toGroupId: TO,
      groupId: FROM,
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe("INVALID_REQUEST")
    expect(calls).toEqual([])
  })

  it("hands the mover the cap of the target group's plan, not the source's", async () => {
    const intoFree = stack({ [FROM]: PRO_PLAN_ID, [TO]: FREE_PLAN_ID })
    const fromFree = stack({ [FROM]: FREE_PLAN_ID, [TO]: PRO_PLAN_ID })

    await rest(intoFree.buses, EDITOR)(`/${FROM}/move-all`, { toGroupId: TO })
    await rest(fromFree.buses, EDITOR)(`/${FROM}/move-all`, { toGroupId: TO })

    expect(intoFree.calls[0].allowances).toEqual({ maxNotes: 10 })
    expect(fromFree.calls[0].allowances).toEqual({ maxNotes: null })
  })

  it("answers 402 with the cap when the move would pass the target's plan", async () => {
    const { buses } = stack({ [FROM]: PRO_PLAN_ID, [TO]: FREE_PLAN_ID })
    buses.moveAll = () =>
      Promise.reject(
        new PlanError(
          "PLAN_LIMIT_REACHED",
          "maxNotes",
          10,
          true,
          "The group has reached its limit",
        ),
      )

    const response = await rest(buses, EDITOR)(`/${FROM}/move-all`, { toGroupId: TO })

    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      error: { code: "PLAN_LIMIT_REACHED", entitlement: "maxNotes", limit: 10, canUpgrade: true },
    })
  })

  it("does not run without the entitlement gate", async () => {
    const { mover } = stack()
    const handler = createGroupMoveAllHandler(
      {
        getForMember: () => Promise.resolve({ role: GroupRole.OWNER }),
      } as unknown as GroupRepository,
      mover,
    )

    await expect(
      Promise.resolve(handler(
        new GroupMoveAllCommand({
          actor: { userId: EDITOR } as never,
          groupId: FROM,
          toGroupId: TO,
        }),
      )),
    ).rejects.toThrow("without the entitlement gate")
  })
})

describe("moving all of a group's data over the socket", () => {
  it("moves it for an editor of both groups with the same answer as REST", async () => {
    const { buses, calls } = stack()
    const ws = socket(buses, EDITOR)

    const frame = await ws.command({ groupId: FROM, toGroupId: TO })

    expect(frame).toMatchObject({
      kind: "server.result",
      payload: { moved: 3, counts: { notes: 3 } },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toEqual({
      fromGroupId: FROM,
      toGroupId: TO,
      requestId: "frame-1",
    })
    ws.shutdown()
  })

  it("refuses a viewer of the target and moves nothing", async () => {
    const { buses, calls } = stack()
    const ws = socket(buses, VIEWER_OF_TARGET)

    const frame = await ws.command({ groupId: FROM, toGroupId: TO })

    expect(frame).toMatchObject({
      kind: "server.error",
      code: "forbidden",
      details: { code: "ROLE_INSUFFICIENT" },
    })
    expect(calls).toEqual([])
    ws.shutdown()
  })

  it("refuses a payload without the source group", async () => {
    const { buses, calls } = stack()
    const ws = socket(buses, EDITOR)

    const frame = await ws.command({ toGroupId: TO })

    expect(frame).toMatchObject({ kind: "server.error", code: "bad_request" })
    expect(calls).toEqual([])
    ws.shutdown()
  })
})
