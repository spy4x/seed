import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { signal } from "@preact/signals"
import { userChangeGroupId } from "@domain/identity"
import { createChangeCheck, createPull } from "./pull.ts"

const USER = 7

/**
 * A pull over fakes. `groupsAfterRead` is the list the server answers when the groups are read;
 * `calls` records every read in order, so a read of a group that is gone shows up.
 */
function harness(
  options: { open: string | null; groupsAfterRead: string[]; settings?: string | null },
) {
  const calls: string[] = []
  const inbox: string[] = []
  const groups = signal<readonly { id: string }[]>([{ id: "home" }, { id: "team" }])
  const pull = createPull({
    userId: USER,
    flushOutbox: () => Promise.resolve(void calls.push("flush")),
    profile: { refresh: () => Promise.resolve(void calls.push("profile")) },
    selection: { refresh: () => Promise.resolve(void calls.push("selection")) },
    groups: {
      groups,
      refresh: () => {
        calls.push("groups")
        groups.value = options.groupsAfterRead.map((id) => ({ id }))
        return Promise.resolve()
      },
    },
    notes: {
      groupId: signal(options.open),
      refresh: () => Promise.resolve(void calls.push("notes")),
    },
    members: {
      groupId: signal(options.settings ?? null),
      refresh: () => Promise.resolve(void calls.push("members")),
    },
    notifications: { refresh: () => Promise.resolve(void inbox.push("notifications")) },
  })
  return { pull, calls, inbox }
}

describe("the pull after a hint", () => {
  it("never reads the notes of the open group once that group is deleted", async () => {
    const { pull, calls } = harness({ open: "team", groupsAfterRead: ["home"] })

    await pull({ groupId: "team" })

    expect(calls).toContain("groups")
    expect(calls).not.toContain("notes")
  })

  it("reads the notes of the open group after the groups, while the group is still there", async () => {
    const { pull, calls } = harness({ open: "team", groupsAfterRead: ["home", "team"] })

    await pull({ groupId: "team" })

    expect(calls).toEqual(["flush", "selection", "groups", "notes"])
  })

  it("leaves the notes alone for another group's hint, and reads them with no hint at all", async () => {
    const other = harness({ open: "team", groupsAfterRead: ["home", "team"] })
    await other.pull({ groupId: "home" })
    expect(other.calls).not.toContain("notes")

    const all = harness({ open: "team", groupsAfterRead: ["home", "team"] })
    await all.pull()
    expect(all.calls).toContain("notes")
  })

  it("reads no notes when none is open", async () => {
    const { pull, calls } = harness({ open: null, groupsAfterRead: ["home"] })

    await pull()

    expect(calls).toEqual(["flush", "selection", "groups"])
  })

  it("answers this person's own hint with the profile and the selection only", async () => {
    const { pull, calls } = harness({ open: "team", groupsAfterRead: ["home", "team"] })

    await pull({ groupId: userChangeGroupId(USER) })

    expect([...calls].sort()).toEqual(["profile", "selection"])
  })

  it("reads the members of the open settings page for its group's hint, and never once the person was removed", async () => {
    const kept = harness({ open: null, settings: "team", groupsAfterRead: ["home", "team"] })
    await kept.pull({ groupId: "team" })
    expect(kept.calls).toEqual(["flush", "selection", "groups", "members"])

    const other = harness({ open: null, settings: "team", groupsAfterRead: ["home", "team"] })
    await other.pull({ groupId: "home" })
    expect(other.calls).not.toContain("members")

    const removed = harness({ open: null, settings: "team", groupsAfterRead: ["home"] })
    await removed.pull({ groupId: "team" })
    expect(removed.calls).not.toContain("members")
  })
  it("reads the unread count again for this person's own hint, for a start-up and a reconnect", async () => {
    const own = harness({ open: null, groupsAfterRead: ["home"] })
    await own.pull({ groupId: userChangeGroupId(USER) })
    expect(own.inbox).toEqual(["notifications"])

    const start = harness({ open: null, groupsAfterRead: ["home"] })
    await start.pull()
    expect(start.inbox).toEqual(["notifications"])
  })

  it("leaves the inbox alone for a group's hint", async () => {
    const { pull, inbox } = harness({ open: null, groupsAfterRead: ["home", "team"] })

    await pull({ groupId: "team" })

    expect(inbox).toEqual([])
  })
})

/** A change check over fakes; `sequences` is what the next read of the groups list answers. */
function checkHarness(open: string | null, settings: string | null = null) {
  const calls: string[] = []
  const sequences: Record<string, string> = { home: "1", team: "5" }
  const groups = signal<readonly { id: string; changeSequence: string }[]>([])
  const check = createChangeCheck({
    userId: USER,
    flushOutbox: () => Promise.resolve(void calls.push("flush")),
    profile: { refresh: () => Promise.resolve(void calls.push("profile")) },
    selection: { refresh: () => Promise.resolve(void calls.push("selection")) },
    groups: {
      groups,
      refresh: () => {
        calls.push("groups")
        groups.value = Object.entries(sequences).map(([id, changeSequence]) => ({
          id,
          changeSequence,
        }))
        return Promise.resolve()
      },
    },
    notes: { groupId: signal(open), refresh: () => Promise.resolve(void calls.push("notes")) },
    members: {
      groupId: signal(settings),
      refresh: () => Promise.resolve(void calls.push("members")),
    },
    notifications: { refresh: () => Promise.resolve(void calls.push("notifications")) },
  })
  /** Runs one check and returns only what that check read. */
  const run = async (full: boolean) => {
    calls.length = 0
    await check(full)
    return [...calls]
  }
  return { run, sequences }
}

describe("the change check of a page with no socket", () => {
  it("runs the whole pull when it is a full one", async () => {
    const { run } = checkHarness("team")

    const read = await run(true)

    expect(read).toEqual(["flush", "notifications", "selection", "groups", "notes"])
  })

  it("reads only the groups list while the open group's sequence has not moved", async () => {
    const { run } = checkHarness("team", "team")
    await run(true)

    const read = await run(false)

    expect(read).toEqual(["flush", "groups"])
  })

  it("reads the open group's notes and members again once its sequence moved, and once only", async () => {
    const { run, sequences } = checkHarness("team", "team")
    await run(true)
    sequences.team = "6"

    const moved = await run(false)
    const settled = await run(false)

    expect(moved).toEqual(["flush", "groups", "notes", "members"])
    expect(settled).toEqual(["flush", "groups"])
  })

  it("leaves the notes alone when another group's sequence moved", async () => {
    const { run, sequences } = checkHarness("team")
    await run(true)
    sequences.home = "2"

    expect(await run(false)).toEqual(["flush", "groups"])
  })

  it("never asks for the notes of a group that is gone from the list", async () => {
    const { run, sequences } = checkHarness("team")
    await run(true)
    delete sequences.team

    expect(await run(false)).toEqual(["flush", "groups"])
  })

  it("reads the notes on the first check when no full pull came before it", async () => {
    const { run } = checkHarness("team")

    expect(await run(false)).toEqual(["flush", "groups", "notes"])
  })
})
