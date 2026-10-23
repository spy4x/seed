/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { deviceName } from "@spy4x/net/user-agent"
import { BillingStatus } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import {
  DAY,
  FAKE_COUNTS,
  FAKE_PASSKEYS,
  fakeDemoData,
  type FakeGroup,
  fakePeople,
  fakeWorkspace,
  VIDEO_PERSON_INDEX,
} from "./fake-data.ts"

/** A Tuesday noon: the weekdays below count back from it. */
const NOW = new Date("2026-10-20T12:00:00Z")

/** The UTC weekday `ago` minutes before {@link NOW}: 0 is Sunday. */
const weekdayOf = (ago: number) => new Date(NOW.getTime() - ago * 60_000).getUTCDay()

Deno.test("fake demo data is the same for the same seed and moment, and differs for another seed", () => {
  expect(fakeDemoData(42, NOW)).toEqual(fakeDemoData(42, NOW))
  expect(fakeDemoData(42, NOW)).not.toEqual(fakeDemoData(43, NOW))
})

Deno.test("the fake people's names and addresses depend on the seed alone", () => {
  const later = new Date(NOW.getTime() + 9 * 60 * 60_000)
  for (const now of [NOW, later]) {
    const people = fakeDemoData(7, now).users.map(({ firstName, lastName, email }) => ({
      firstName,
      lastName,
      email,
    }))
    expect(people).toEqual(fakePeople(7))
  }
})

Deno.test("fake demo data has unique names and addresses, all on example.com", () => {
  const data = fakeDemoData(1, NOW)
  expect(data.users).toHaveLength(FAKE_COUNTS.users)
  expect(data.subscribers).toHaveLength(FAKE_COUNTS.subscribers)
  const invitees = data.groups.flatMap((group) => group.invitations.map((i) => i.email))
  const users = data.users.map((user) => user.email)
  expect(new Set(users).size).toBe(users.length)
  const names = data.users.map((user) => `${user.firstName} ${user.lastName}`)
  expect(new Set(names).size).toBe(names.length)
  const listed = data.subscribers.map((s) => s.email)
  const left = data.unsubscribed.map((s) => s.email)
  expect(new Set([...listed, ...left]).size).toBe(listed.length + left.length)
  for (const address of [...users, ...invitees.filter(Boolean), ...listed, ...left]) {
    expect(address).toMatch(/^[a-z0-9.]+@example\.com$/)
  }
})

Deno.test("every fake IP address is in a range reserved for documentation", () => {
  const ips = fakeDemoData(1, NOW).users.flatMap((user) => user.devices.map((d) => d.ip))
  for (const ip of ips) {
    expect(ip).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$|^2001:db8:/)
  }
})

Deno.test("sign-ups spread over the last 30 days and grow towards now", () => {
  const { users } = fakeDemoData(1, NOW)
  const perDay = Array.from({ length: 30 }, () => 0)
  for (const user of users) {
    const day = Math.floor(user.joinedAgo / DAY)
    if (day < 30) perDay[day]++
  }
  expect(perDay.filter((count) => count > 0).length).toBeGreaterThanOrEqual(18)
  const sum = (from: number, to: number) => perDay.slice(from, to).reduce((a, b) => a + b, 0)
  expect(sum(0, 15)).toBeGreaterThan(sum(15, 30))
  // A third or so joined before the window, so the dashboard's total is more than its chart.
  expect(users.filter((user) => user.joinedAgo >= 60 * DAY).length).toBeGreaterThan(20)
})

Deno.test("someone signs in every day of the last 30, fewer at weekends", () => {
  const { users } = fakeDemoData(1, NOW)
  const active = Array.from({ length: 30 }, () => new Set<number>())
  const weekend = new Set<number>()
  for (const [i, user] of users.entries()) {
    for (const signIn of user.signIns) {
      const day = Math.floor(signIn.ago / DAY)
      if (day >= 30) continue
      active[day].add(i)
      if ([0, 6].includes(weekdayOf(day * DAY))) weekend.add(day)
    }
  }
  expect(active.every((people) => people.size > 0)).toBe(true)
  const average = (days: number[]) =>
    days.reduce((sum, day) => sum + active[day].size, 0) / days.length
  const days = active.map((_, day) => day)
  expect(average(days.filter((day) => weekend.has(day)))).toBeLessThan(
    average(days.filter((day) => !weekend.has(day))),
  )
})

Deno.test("the video's search for the person's surname finds exactly three people", () => {
  for (const seed of [1, 7, 42, 20261020]) {
    const search = fakeDemoData(seed, NOW).users[VIDEO_PERSON_INDEX].lastName.toLowerCase()
    const found = fakePeople(seed).filter((person) =>
      [person.firstName, person.lastName, person.email].some((text) =>
        text.toLowerCase().includes(search)
      )
    )
    expect(found).toHaveLength(3)
  }
})

Deno.test("the video's person signs in on Firefox on Windows and Safari on iPhone", () => {
  for (const seed of [1, 20261020]) {
    const claire = fakeDemoData(seed, NOW).users[VIDEO_PERSON_INDEX]
    expect(`${claire.firstName} ${claire.lastName} ${claire.email}`)
      .toBe(`Claire Hartley claire.hartley@example.com`)
    const devices = claire.sessions.map((session) =>
      deviceName(claire.devices[session.device].userAgent)
    )
    expect(devices).toEqual([`Firefox on Windows`, `Safari on iPhone`])
    expect(claire.verified && claire.blockedAgo === null).toBe(true)
  }
})

Deno.test("a few people are unverified, blocked, on Google or GitHub, or use a second factor", () => {
  const { users } = fakeDemoData(1, NOW)
  expect(users.filter((user) => !user.verified)).toHaveLength(4)
  const blocked = users.filter((user) => user.blockedAgo !== null)
  expect(blocked).toHaveLength(2)
  // A blocked person signs in no more and has no session left.
  for (const user of blocked) {
    expect(user.sessions).toHaveLength(0)
    expect(user.signIns.every((signIn) => signIn.ago > user.blockedAgo!)).toBe(true)
  }
  expect(users.filter((user) => user.provider === `oauth:google`)).toHaveLength(10)
  expect(users.filter((user) => user.provider === `oauth:github`)).toHaveLength(5)
  expect(users.filter((user) => user.secondFactor)).toHaveLength(8)
})

Deno.test("a dozen confirmed, unblocked people added a passkey after they joined", () => {
  const { users } = fakeDemoData(1, NOW)
  const holders = users.filter((user) => user.passkey !== null)
  expect(holders).toHaveLength(FAKE_PASSKEYS)
  for (const user of holders) {
    const { device, addedAgo, lastUsedAgo } = user.passkey!
    expect(user.verified).toBe(true)
    expect(user.blockedAgo).toBeNull()
    expect(device).toBeLessThan(user.devices.length)
    expect(addedAgo).toBeLessThan(user.joinedAgo)
    if (lastUsedAgo !== null) expect(lastUsedAgo).toBeLessThan(addedAgo)
  }
})

Deno.test("some people renamed their first group, and nobody who never confirmed", () => {
  const { users } = fakeDemoData(1, NOW)
  const renamed = users.filter((user) => user.firstGroupName !== null)
  expect(renamed.length).toBeGreaterThan(users.length / 5)
  expect(renamed.length).toBeLessThan(users.length * 3 / 5)
  expect(new Set(renamed.map((user) => user.firstGroupName)).size).toBeGreaterThan(5)
  expect(renamed.every((user) => user.verified)).toBe(true)
})

Deno.test("about half the people keep notes of their own, written after they joined", () => {
  const { users } = fakeDemoData(1, NOW)
  const writers = users.filter((user) => user.ownNotes.length > 0)
  expect(writers.length).toBeGreaterThan(users.length * 0.4)
  expect(writers.length).toBeLessThan(users.length * 0.7)
  for (const user of writers) {
    expect(user.verified).toBe(true)
    for (const note of user.ownNotes) expect(note.ago).toBeLessThanOrEqual(user.joinedAgo)
  }
})

Deno.test("recent sign-ups share small groups, and the video's person edits in one", () => {
  const { users, groups } = fakeDemoData(1, NOW)
  const small = groups.filter((group) => group.createdAgo < 12 * DAY)
  expect(small.length).toBeGreaterThanOrEqual(16)
  for (const group of small) {
    expect(group.members.length).toBeGreaterThan(0)
    expect(users[group.owner as number].joinedAgo).toBeLessThan(12 * DAY)
  }
  const claire = groups.filter((group) =>
    group.members.some((m) => m.member === VIDEO_PERSON_INDEX && m.role === GroupRole.EDITOR)
  )
  expect(claire).toHaveLength(1)
})

Deno.test("Product team, which the admin video opens from the top of Groups, is the largest group", () => {
  for (const seed of [1, 7, 42, 20261020, 20261023]) {
    const sizes = fakeDemoData(seed, NOW).groups.map((group) => [group.name, group.members.length])
    const largest = Math.max(...sizes.map(([, size]) => size as number))
    expect(sizes.filter(([, size]) => size === largest).map(([name]) => name)).toEqual([
      `Product team`,
    ])
  }
})

Deno.test("subscriptions include paying, past-due, cancelled, ending and trial groups", () => {
  const { subscriptions } = fakeDemoData(1, NOW)
  const statuses = subscriptions.map((s) => s.status)
  expect(statuses.filter((s) => s === BillingStatus.Active)).toHaveLength(6)
  expect(statuses.filter((s) => s === BillingStatus.PastDue)).toHaveLength(1)
  expect(statuses.filter((s) => s === BillingStatus.Canceled)).toHaveLength(1)
  expect(statuses.filter((s) => s === BillingStatus.Trialing)).toHaveLength(2)
  expect(subscriptions.filter((s) => s.cancelAtPeriodEnd)).toHaveLength(1)
  for (const subscription of subscriptions) {
    // Payments are a month apart and all after the customer started.
    const payments = subscription.paymentsAgo
    for (let i = 1; i < payments.length; i++) expect(payments[i - 1] - payments[i]).toBe(30 * DAY)
    if (payments.length > 0) expect(payments[0]).toBe(subscription.customerSinceAgo)
  }
  const active = subscriptions.find((s) => s.status === BillingStatus.Active)!
  expect(active.paymentsAgo.length).toBeGreaterThan(1)
})

Deno.test("the operator refunds a paid subscription and gives a trial more time", () => {
  const { operator, subscriptions } = fakeDemoData(1, NOW)
  const refund = operator.actions.find((action) => action.kind === `refund`)
  const time = operator.actions.find((action) => action.kind === `time-given`)
  expect(refund && `subscription` in refund).toBe(true)
  expect(time && `subscription` in time).toBe(true)
  if (refund?.kind !== `refund` || time?.kind !== `time-given`) return
  expect(subscriptions[refund.subscription].paymentsAgo.length).toBeGreaterThan(0)
  expect(subscriptions[time.subscription].status).toBe(BillingStatus.Trialing)
})

Deno.test("the newsletter grows over months and has three sent issues", () => {
  const { subscribers, issues } = fakeDemoData(1, NOW)
  expect(issues.map((issue) => issue.subject)).toHaveLength(3)
  const joined = (from: number, to: number) =>
    subscribers.filter((s) => s.ago >= from * DAY && s.ago < to * DAY).length
  // More people joined in the last month than in the month two months before.
  expect(joined(0, 30)).toBeGreaterThan(joined(60, 90) * 1.5)
})

/** Nobody is in a group twice, the owner is not also a member, and note tags are the group's. */
function expectWellFormed(groups: FakeGroup[]): void {
  for (const group of groups) {
    const ids = [group.owner, ...group.members.map((m) => m.member)]
    expect(new Set(ids).size).toBe(ids.length)
    const names = new Set(group.tags.map((tag) => tag.name))
    for (const note of group.notes) for (const tag of note.tags) expect(names.has(tag)).toBe(true)
    // Nothing happens before the group exists, and nobody writes before they joined.
    const joined = new Map(group.members.map((m) => [m.member, m.joinedAgo]))
    joined.set(group.owner, group.createdAgo)
    for (const note of group.notes) {
      expect(note.createdAgo).toBeLessThanOrEqual(joined.get(note.author)!)
      if (note.edit) expect(note.edit.ago).toBeLessThan(note.createdAgo)
    }
    for (const member of group.members) {
      expect(member.joinedAgo).toBeLessThanOrEqual(group.createdAgo)
    }
  }
}

Deno.test("the demo's population groups hold fake people only", () => {
  for (const seed of [1, 20261019, 99]) {
    const { groups } = fakeDemoData(seed, NOW)
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

Deno.test("a new account's sample notes are written by several people over days", () => {
  for (const seed of [1, 20261019, 99]) {
    const groups = fakeWorkspace(seed)
    for (const group of groups) {
      const authors = new Set(group.notes.map((note) => note.author))
      expect(authors.size).toBeGreaterThanOrEqual(2)
      expect(authors.has(`you`)).toBe(false)
      const times = group.notes.map((note) => note.createdAgo)
      expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(DAY)
    }
    // Every note body reads as its own: no body, and no line of one, repeats.
    const lines = groups.flatMap((group) =>
      group.notes.flatMap((note) => note.body.split(`\n`).filter(Boolean))
    )
    expect(new Set(lines).size).toBe(lines.length)
  }
})
