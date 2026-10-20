/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { GroupRole } from "@domain/groups"
import { FAKE_COUNTS, fakeDemoData, type FakeGroup, fakeWorkspace } from "./fake-data.ts"

Deno.test("fake demo data is the same for the same seed and differs for another", () => {
  expect(fakeDemoData(42)).toEqual(fakeDemoData(42))
  expect(fakeDemoData(42)).not.toEqual(fakeDemoData(43))
})

Deno.test("fake demo data has unique addresses, all on example.com", () => {
  const data = fakeDemoData(1)
  expect(data.users).toHaveLength(FAKE_COUNTS.users)
  expect(data.subscribers).toHaveLength(FAKE_COUNTS.subscribers)
  const invitees = data.groups.flatMap((group) => group.invitations.map((i) => i.email))
  const addresses = [...data.users.map((user) => user.email), ...invitees.filter(Boolean)]
  expect(new Set(data.users.map((user) => user.email)).size).toBe(data.users.length)
  const names = data.users.map((user) => `${user.firstName} ${user.lastName}`)
  expect(new Set(names).size).toBe(names.length)
  expect(new Set(data.subscribers).size).toBe(data.subscribers.length)
  for (const address of [...addresses, ...data.subscribers]) {
    expect(address).toMatch(/^[a-z0-9.]+@example\.com$/)
  }
})

/** Nobody is in a group twice, the owner is not also a member, and note tags are the group's. */
function expectWellFormed(groups: FakeGroup[]): void {
  for (const group of groups) {
    const ids = [group.owner, ...group.members.map((m) => m.member)]
    expect(new Set(ids).size).toBe(ids.length)
    const names = new Set(group.tags.map((tag) => tag.name))
    for (const note of group.notes) for (const tag of note.tags) expect(names.has(tag)).toBe(true)
  }
}

Deno.test("the demo's population groups hold fake people only", () => {
  for (const seed of [1, 20261019, 99]) {
    const { groups } = fakeDemoData(seed)
    const people = groups.flatMap((group) => [group.owner, ...group.members.map((m) => m.member)])
    expect(people.every((person) => typeof person === "number")).toBe(true)
    expectWellFormed(groups)
  }
})

Deno.test("a new account owns one sample group and is an editor and a viewer in two more", () => {
  for (const seed of [1, 20261019, 99]) {
    const groups = fakeWorkspace(seed)
    const roles = groups.flatMap((group) =>
      group.members.filter((m) => m.member === "you").map((m) => m.role)
    )
    expect(groups.filter((group) => group.owner === "you")).toHaveLength(1)
    expect(roles.sort()).toEqual([GroupRole.VIEWER, GroupRole.EDITOR])
    // A busy first screen: every sample group has notes, tags and made-up members.
    for (const group of groups) {
      expect(group.notes.length).toBeGreaterThan(0)
      expect(group.tags.length).toBeGreaterThan(0)
      expect(group.members.filter((m) => m.member !== "you").length).toBeGreaterThan(0)
    }
    expectWellFormed(groups)
  }
})
