/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { GroupRole } from "@domain/groups"
import { FAKE_COUNTS, fakeDemoData } from "./fake-data.ts"

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

Deno.test("the demo user owns one fake group and is an editor and a viewer in two more", () => {
  for (const seed of [1, 20261019, 99]) {
    const data = fakeDemoData(seed)
    const owned = data.groups.filter((group) => group.owner === `demo`)
    const roles = data.groups.flatMap((group) =>
      group.members.filter((m) => m.member === `demo`).map((m) => m.role)
    )
    expect(owned).toHaveLength(1)
    expect(roles.sort()).toEqual([GroupRole.VIEWER, GroupRole.EDITOR])
    for (const group of data.groups) {
      // Nobody is in a group twice, and the owner is not also a member.
      const ids = [group.owner, ...group.members.map((m) => m.member)]
      expect(new Set(ids).size).toBe(ids.length)
      // Every tag on a note is one of the group's tags.
      const names = new Set(group.tags.map((tag) => tag.name))
      for (const note of group.notes) for (const tag of note.tags) expect(names.has(tag)).toBe(true)
    }
  }
})
