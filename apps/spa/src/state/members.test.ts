import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { GroupRole } from "@domain/groups"
import {
  createMembersStore,
  type MemberItem,
  type MembersDependencies,
  membersHttp,
  TransferRefused,
} from "./members.ts"

function member(userId: number, role = GroupRole.VIEWER): MemberItem {
  return {
    userId,
    name: `Member ${userId}`,
    email: null,
    role,
    joinedAt: "2026-01-01T00:00:00.000Z",
    isYou: false,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const UNUSED: MembersDependencies = {
  list: () => Promise.resolve({ members: [member(1, GroupRole.OWNER), member(2)], memberCount: 2 }),
  setRole: () => Promise.reject(new Error("unused")),
  removeMember: () => Promise.reject(new Error("unused")),
  leave: () => Promise.reject(new Error("unused")),
  transfer: () => Promise.reject(new Error("unused")),
}

function refused(message: string) {
  return new RealtimeRequestError("forbidden", message)
}

describe("members store", () => {
  it("reads the members of the group it opens, and drops a read answered after the page moved on", async () => {
    const first = deferred<{ members: MemberItem[]; memberCount: number }>()
    const asked: string[] = []
    const store = createMembersStore({
      ...UNUSED,
      list: ({ groupId }) => {
        asked.push(groupId)
        return groupId === "a"
          ? first.promise
          : Promise.resolve({ members: [member(9)], memberCount: 1 })
      },
    })

    const late = store.open("a")
    await store.open("b")
    first.resolve({ members: [member(1)], memberCount: 1 })
    await late

    expect(asked).toEqual(["a", "b"])
    expect(store.groupId.value).toBe("b")
    expect(store.members.value?.map((m) => m.userId)).toEqual([9])
  })

  it("keeps the group's true member count past the listed rows, one less after a removal", async () => {
    const store = createMembersStore({
      ...UNUSED,
      list: () =>
        Promise.resolve({ members: [member(1, GroupRole.OWNER), member(2)], memberCount: 1500 }),
      removeMember: () => Promise.resolve({ removed: true }),
    })
    await store.open("g")
    expect(store.memberCount.value).toBe(1500)

    expect(await store.remove(2)).toBe(true)

    expect(store.memberCount.value).toBe(1499)
    store.reset()
    expect(store.memberCount.value).toBeNull()
  })

  it("changes a role and shows the member as the server answered", async () => {
    const sent: unknown[] = []
    const store = createMembersStore({
      ...UNUSED,
      setRole: (input) => {
        sent.push(input)
        return Promise.resolve({ member: member(2, GroupRole.EDITOR) })
      },
    })
    await store.open("g")

    expect(await store.changeRole(2, GroupRole.EDITOR)).toBe(true)

    expect(sent).toEqual([{ groupId: "g", userId: 2, role: GroupRole.EDITOR }])
    expect(store.members.value?.find((m) => m.userId === 2)?.role).toBe(GroupRole.EDITOR)
    expect(store.pendingUserId.value).toBeNull()
  })

  it("shows a refused change under its member and refuses a second change while one runs", async () => {
    const answer = deferred<void>()
    const roleChanges: number[] = []
    const store = createMembersStore({
      ...UNUSED,
      setRole: ({ userId, role }) => {
        roleChanges.push(userId)
        return Promise.resolve({ member: member(userId, role) })
      },
      removeMember: async () => {
        await answer.promise
        throw refused("Only an admin can remove a member")
      },
    })
    await store.open("g")

    const removing = store.remove(2)
    expect(store.pendingUserId.value).toBe(2)
    expect(await store.changeRole(2, GroupRole.EDITOR)).toBe(false)
    expect(roleChanges).toEqual([])
    answer.resolve()

    expect(await removing).toBe(false)
    expect(store.memberError.value).toEqual({
      userId: 2,
      message: "Only an admin can remove a member",
      plan: null,
    })
    expect(store.members.value?.map((m) => m.userId)).toEqual([1, 2])
  })

  it("hands the screen the plan's refusal of a role change, read from the socket's details", async () => {
    const refusal = {
      code: "PLAN_FEATURE_MISSING",
      entitlement: "memberRoles",
      limit: null,
      canUpgrade: true,
    }
    const store = createMembersStore({
      ...UNUSED,
      setRole: () =>
        Promise.reject(new RealtimeRequestError("forbidden", "Upgrade to change roles", refusal)),
    })
    await store.open("g")

    expect(await store.changeRole(2, GroupRole.EDITOR)).toBe(false)

    expect(store.memberError.value).toEqual({
      userId: 2,
      message: "Upgrade to change roles",
      plan: refusal,
    })
  })

  it("drops a removed member from the list", async () => {
    const store = createMembersStore({
      ...UNUSED,
      removeMember: () => Promise.resolve({ removed: true }),
    })
    await store.open("g")

    expect(await store.remove(2)).toBe(true)

    expect(store.members.value?.map((m) => m.userId)).toEqual([1])
  })

  it("leaves the open group, and keeps the reason a leave was refused", async () => {
    const left: unknown[] = []
    let refuse = true
    const store = createMembersStore({
      ...UNUSED,
      leave: (input) => {
        if (refuse) return Promise.reject(refused("You cannot leave your only group"))
        left.push(input)
        return Promise.resolve({ left: true })
      },
    })
    await store.open("g")

    expect(await store.leave()).toBe(false)
    expect(store.leaveError.value).toBe("You cannot leave your only group")

    refuse = false
    expect(await store.leave()).toBe(true)
    expect(left).toEqual([{ groupId: "g" }])
    expect(store.leaveError.value).toBeNull()
  })

  it("transfers to the drafted member, forgets the password and reads the members again", async () => {
    const sent: unknown[] = []
    let reads = 0
    const store = createMembersStore({
      ...UNUSED,
      list: () => (reads++, UNUSED.list({ groupId: "g" })),
      transfer: (input) => (sent.push(input), Promise.resolve()),
    })
    await store.open("g")
    store.transferDraft.value = { userId: 2, name: "Team", password: "secret" }

    expect(await store.transfer()).toBe(true)

    expect(sent).toEqual([{ groupId: "g", userId: 2, name: "Team", password: "secret" }])
    expect(store.transferDraft.value).toEqual({ userId: null, name: "", password: "" })
    expect(reads).toBe(2)
  })

  it("shows a refused transfer under the field it names, and drops the password", async () => {
    const store = createMembersStore({
      ...UNUSED,
      transfer: () =>
        Promise.reject(new TransferRefused("The password is incorrect", "PASSWORD_INVALID")),
    })
    await store.open("g")
    store.transferDraft.value = { userId: 2, name: "Team", password: "wrong" }

    expect(await store.transfer()).toBe(false)

    expect(store.transferError.value).toEqual({
      field: "password",
      message: "The password is incorrect",
    })
    expect(store.transferDraft.value).toEqual({ userId: 2, name: "Team", password: "" })
    expect(store.transferring.value).toBe(false)
  })

  it("sends nothing while no member is drafted", async () => {
    const sent: unknown[] = []
    const store = createMembersStore({
      ...UNUSED,
      transfer: (input) => (sent.push(input), Promise.resolve()),
    })
    await store.open("g")

    expect(await store.transfer()).toBe(false)
    expect(sent).toEqual([])
  })

  it("keeps a transfer draft and its refusal while the same group is read again, and drops both for another group", async () => {
    const store = createMembersStore(UNUSED)
    await store.open("a")
    const draft = { userId: 2, name: "Team", password: "" }
    const error = { field: "name" as const, message: "Type it exactly" }
    store.transferDraft.value = draft
    store.transferError.value = error

    await store.open("a")
    expect([store.transferDraft.value, store.transferError.value]).toEqual([draft, error])

    await store.open("b")
    expect(store.transferDraft.value).toEqual({ userId: null, name: "", password: "" })
    expect(store.transferError.value).toBe(null)
  })
})

describe("handing a group over by REST", () => {
  /** Runs one transfer against a `fetch` that answers `status` with `body`, and returns its refusal. */
  async function refusalOf(status: number, body: unknown): Promise<TransferRefused> {
    const realFetch = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(Response.json(body, { status }))
    try {
      await membersHttp.transfer({ groupId: "g-1", userId: 2, name: "Team", password: "pw" })
      throw new Error("the transfer was not refused")
    } catch (cause) {
      if (!(cause instanceof TransferRefused)) throw cause
      return cause
    } finally {
      globalThis.fetch = realFetch
    }
  }

  it("keeps the API's sentence and reason, and words a guard's refusal in its own", async () => {
    const named = await refusalOf(400, {
      error: { code: "bad_request", message: "Type the name", reason: "NAME_MISMATCH" },
    })
    const limited = await refusalOf(429, {
      error: { code: "rate_limited", message: "Too many requests" },
    })

    expect([named.message, named.code]).toEqual(["Type the name", "NAME_MISMATCH"])
    expect([limited.message, limited.code]).toEqual([
      "Too many attempts. Wait a few minutes, then try again.",
      undefined,
    ])
  })
})
