import { seededRandom } from "@spy4x/platform/universal/statistics"
import { BillingStatus } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import type { TagColor } from "@domain/tags"
import {
  DEVICES,
  FIRST_GROUP_NAMES,
  NAME_POOLS,
  PERSONAL_NOTES,
  SENT_ISSUES,
  SMALL_THEMES,
  type Theme,
  THEMES,
  VIDEO_NAMESAKES,
  VIDEO_PERSON,
  VIDEO_PERSON_DEVICES,
} from "./fake-content.ts"

/**
 * The fake data of the public demo and the development seed (docs/demo.md): people with months of
 * sign-ins on their own devices, groups with members, tags, notes and invitations written by
 * several people over weeks, the groups' subscriptions, the newsletter, and what an operator did.
 * Pure and deterministic: one `seed` and `now` always give the same data, so a test can pin it and
 * each night can use a new seed. Every time is in minutes before `now` (`…Ago`) or after it
 * (`…In`). Every address is on `example.com` and every IP address in a range reserved for
 * documentation, so nothing reaches a real person or machine.
 */

/** Minutes in an hour and in a day: every time here is counted in minutes. */
export const HOUR = 60
export const DAY = 24 * HOUR

/** How much the demo holds. */
export const FAKE_COUNTS = { users: 140, subscribers: 90 } as const

/** A way in besides the password, as `auth_keys.method` names it. */
export type FakeProvider = `oauth:google` | `oauth:github`

/** A fake person. Signs up with a random password nobody knows. */
export interface FakeUser {
  email: string
  firstName: string
  lastName: string
  joinedAgo: number
  /** Whether they confirmed their address. One who did not never signed in again. */
  verified: boolean
  /** Google or GitHub, linked `providerAgo` minutes ago; `null` for the password only. */
  provider: FakeProvider | null
  providerAgo: number
  /** An authenticator app as a second factor. */
  secondFactor: boolean
  /** When an operator blocked them, or `null`. */
  blockedAgo: number | null
  /** When they last changed their name, or `null`. */
  profileUpdatedAgo: number | null
  /** What they renamed their first group, "Personal", to, or `null` if they kept the name. */
  firstGroupName: string | null
  /** Notes they keep in their first group, oldest first, each `ago` minutes back. */
  ownNotes: { title: string; body: string; ago: number }[]
  /** The browsers they use: an entry of `DEVICES` and the address it signs in from. */
  devices: { userAgent: string; ip: string }[]
  /** Every sign-in after sign-up, oldest first, by its index in `devices`. */
  signIns: { ago: number; device: number }[]
  /** Sessions still signed in, by their index in `devices`. */
  sessions: { device: number; createdAgo: number; lastUsedAgo: number }[]
  /**
   * A passkey (#222) made on one of `devices`, added `addedAgo` minutes ago and last used
   * `lastUsedAgo` minutes ago (`null`: never); `null` for none.
   */
  passkey: { device: number; addedAgo: number; lastUsedAgo: number | null } | null
}

/** Who a fake group's row points at: a fake person by index, or the new account (`you`). */
export type FakeMember = number | `you`

export interface FakeNote {
  title: string
  body: string
  /** Names of the group's tags on the note. */
  tags: string[]
  author: FakeMember
  createdAgo: number
  /** Who last changed it, and when; `null` when nobody did. */
  edit: { by: FakeMember; ago: number } | null
  /** Files on the note, attached by its author when it was written. Only sample groups have any. */
  files?: { name: string; kind: `png` | `pdf` }[]
}

export interface FakeGroup {
  name: string
  owner: FakeMember
  createdAgo: number
  members: { member: FakeMember; role: GroupRole; joinedAgo: number }[]
  tags: { name: string; color: TagColor; author: FakeMember; createdAgo: number }[]
  notes: FakeNote[]
  /** Pending invitations: tied to an address, or `null` for a link anyone may use. */
  invitations: { email: string | null; role: GroupRole; author: FakeMember; createdAgo: number }[]
  /** Members the owner made admin after they joined as editors. */
  promotions: { member: FakeMember; ago: number }[]
  /** The owner made it from an export file, so the admin panel shows an "Imported" fact. */
  imported?: boolean
}

/** A group's subscription to the paid plan, as the provider's webhooks would have left it. */
export interface FakeSubscription {
  /** The group, by its index in `groups`. */
  group: number
  status: BillingStatus
  seats: number
  customerSinceAgo: number
  /** Minutes until the paid period ends; negative once it has. */
  periodEndIn: number
  trialEndIn: number | null
  pastDueSinceAgo: number | null
  cancelAtPeriodEnd: boolean
  everActive: boolean
  /** Every payment the provider reported, oldest first. */
  paymentsAgo: number[]
}

/** Something an operator did in the admin app. Written only when an operator exists. */
export type FakeOperatorAction =
  | { kind: `blocked` | `password-reset` | `sessions-ended`; user: number; ago: number }
  | { kind: `refund` | `time-given`; subscription: number; ago: number; note: string }
  | { kind: `users-exported` | `subscribers-exported`; ago: number }

export interface FakeDemoData {
  users: FakeUser[]
  groups: FakeGroup[]
  subscriptions: FakeSubscription[]
  /** Addresses on the newsletter list, and when each confirmed. */
  subscribers: { email: string; ago: number }[]
  /** Addresses that left the list, and when. */
  unsubscribed: { email: string; ago: number }[]
  /** Issues sent to the list, newest first. */
  issues: { issue: string; subject: string; sentAgo: number; failed: number }[]
  /** The operator's own sign-ins and actions, for the development seed. */
  operator: { joinedAgo: number; signIns: number[]; actions: FakeOperatorAction[] }
}

/** How recent the people are who start {@link SMALL_THEMES} groups, in days. */
const SMALL_GROUPS_DAYS = 12

/** The index of the video's person in `users`; the first person stays the day's marker. */
export const VIDEO_PERSON_INDEX = 1

/** A new account's sample groups: by theme, the role the account has in it. */
const YOUR_ROLES: readonly [number, GroupRole][] = [
  [0, GroupRole.OWNER],
  [1, GroupRole.EDITOR],
  [3, GroupRole.VIEWER],
]

/** The order subscriptions are handed out in, oldest group first. */
const PLAN_ROTA: readonly (`active` | `canceled` | `ending` | `past_due` | `trial`)[] = [
  `active`,
  `active`,
  `canceled`,
  `ending`,
  `active`,
  `past_due`,
  `active`,
  `active`,
  `trial`,
  `trial`,
]

/** The seeded helpers every builder draws from. */
function randomTools(seed: number) {
  const random = seededRandom(seed)
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]
  const chance = (p: number) => random() < p
  const sample = <T>(items: readonly T[], count: number): T[] => {
    const copy = [...items]
    const out: T[] = []
    while (out.length < count && copy.length > 0) {
      out.push(copy.splice(int(0, copy.length - 1), 1)[0])
    }
    return out
  }
  /**
   * A time between `from` and `to` minutes ago (`from >= to`), nearer `from` with `early`. Never
   * in the future: with `from < 0` it is now, or the row would sort after rows written later.
   */
  const between = (from: number, to: number, early = false) => {
    const share = early ? random() ** 2 : random()
    return Math.max(0, Math.round(from - Math.max(0, from - to) * share))
  }
  return { random, int, pick, chance, sample, between }
}

type Tools = ReturnType<typeof randomTools>

/** How busy a day is: weekends are quiet, Fridays a little. `now` gives the weekday. */
function dayWeight(now: Date, daysAgo: number): number {
  const weekday = new Date(now.getTime() - daysAgo * DAY * 60_000).getUTCDay()
  if (weekday === 0 || weekday === 6) return 0.45
  return weekday === 5 ? 0.85 : 1
}

/** A day within the last `days`, more often a recent one and a weekday. */
function recentDay(tools: Tools, now: Date, days: number): number {
  for (;;) {
    const day = tools.int(0, days - 1)
    const growth = (1 + 4 * (1 - day / days) ** 2) / 5
    if (tools.random() < growth * dayWeight(now, day)) return day
  }
}

/** A minute inside day `day` before now, never in the last ten minutes. */
function minuteOf(tools: Tools, day: number): number {
  return Math.max(10, day * DAY + tools.int(0, DAY - 1))
}

/** The address a name signs up with: mostly first.last, sometimes shorter. */
function addressOf(tools: Tools, firstName: string, lastName: string): string {
  const plain = (text: string) => text.normalize(`NFD`).replace(/[^A-Za-z]/g, ``).toLowerCase()
  const first = plain(firstName)
  const last = plain(lastName)
  const style = tools.int(1, 10)
  const local = style <= 7
    ? `${first}.${last}`
    : style <= 9
    ? `${first}${last}`
    : `${first[0]}.${last}`
  return `${local}@example.com`
}

/** A random name from one culture's pool. */
function randomName(tools: Tools): { firstName: string; lastName: string } {
  const pool = tools.pick(NAME_POOLS)
  return { firstName: tools.pick(pool.first), lastName: tools.pick(pool.last) }
}

/** A name and address that are in neither `names` nor `addresses`; both sets get it. */
function uniquePerson(
  tools: Tools,
  names: Set<string>,
  addresses: Set<string>,
): { firstName: string; lastName: string; email: string } {
  for (;;) {
    const { firstName, lastName } = randomName(tools)
    const email = addressOf(tools, firstName, lastName)
    const name = `${firstName} ${lastName}`
    if (names.has(name) || addresses.has(email)) continue
    names.add(name)
    addresses.add(email)
    return { firstName, lastName, email }
  }
}

/** An address in a range reserved for documentation (RFC 5737, RFC 3849). */
function fakeIp(tools: Tools): string {
  if (tools.chance(0.15)) {
    return `2001:db8:${tools.int(1, 0xffff).toString(16)}::${tools.int(1, 255)}`
  }
  const net = tools.pick([`192.0.2`, `198.51.100`, `203.0.113`])
  return `${net}.${tools.int(1, 254)}`
}

/** How often each kind of person signs in, per day: the share and the chance a day. */
const HABITS = [
  { share: 0.25, perDay: 0.75, days: Infinity },
  { share: 0.4, perDay: 0.3, days: Infinity },
  { share: 0.25, perDay: 0.1, days: Infinity },
  // Tried it for a week or two and stopped.
  { share: 0.1, perDay: 0.5, days: 12 },
]

/** One person's sign-ins, from the day after `joinedAgo` until now, at most 75 days back. */
function signInsOf(
  tools: Tools,
  now: Date,
  joinedAgo: number,
  deviceCount: number,
): FakeUser["signIns"] {
  let roll = tools.random()
  const habit = HABITS.find((h) => (roll -= h.share) < 0) ?? HABITS[1]
  const joinDay = Math.floor(joinedAgo / DAY)
  const out: FakeUser["signIns"] = []
  for (let day = Math.min(joinDay - 1, 75); day >= 0; day--) {
    if (joinDay - day > habit.days) break
    if (!tools.chance(habit.perDay * dayWeight(now, day))) continue
    // The first device is the one they use most.
    const device = tools.chance(0.6) ? 0 : tools.int(0, deviceCount - 1)
    out.push({ ago: minuteOf(tools, day), device })
  }
  return out
}

/** The sessions still open: one per device used in the last two weeks, at most two. */
function sessionsOf(tools: Tools, signIns: FakeUser["signIns"]): FakeUser["sessions"] {
  const latest = new Map<number, number>()
  for (const signIn of signIns) {
    if (signIn.ago > 14 * DAY) continue
    latest.set(signIn.device, Math.min(latest.get(signIn.device) ?? Infinity, signIn.ago))
  }
  return [...latest].sort((a, b) => a[1] - b[1]).slice(0, 2).map(([device, createdAgo]) => ({
    device,
    createdAgo,
    // Last used within a day of opening it: the next sign-in opens a new one.
    lastUsedAgo: tools.int(Math.max(Math.min(5, createdAgo), createdAgo - DAY), createdAgo),
  }))
}

/** The video person's address. */
const VIDEO_PERSON_EMAIL = `claire.hartley@example.com`

/** The indexes in `users` of the people who share the video person's surname. */
const VIDEO_NAMESAKE_INDEXES: readonly number[] = [2, 3]

/**
 * The fake people's names and addresses, drawn before anything else from `tools`, so they depend
 * on the seed alone: the sample groups find people by address at any time of the day. Exactly
 * three carry the video person's surname, which no pool has, so the video's search finds three.
 */
function drawPeople(tools: Tools): { firstName: string; lastName: string; email: string }[] {
  const names = new Set<string>([`${VIDEO_PERSON.firstName} ${VIDEO_PERSON.lastName}`])
  const addresses = new Set<string>([VIDEO_PERSON_EMAIL])
  return Array.from({ length: FAKE_COUNTS.users }, (_, i) => {
    if (i === VIDEO_PERSON_INDEX) return { ...VIDEO_PERSON, email: VIDEO_PERSON_EMAIL }
    const namesake = VIDEO_NAMESAKE_INDEXES.indexOf(i)
    if (namesake < 0) return uniquePerson(tools, names, addresses)
    const firstName = VIDEO_NAMESAKES[namesake]
    const lastName = VIDEO_PERSON.lastName
    const email = addressOf(tools, firstName, lastName)
    names.add(`${firstName} ${lastName}`)
    addresses.add(email)
    return { firstName, lastName, email }
  })
}

/**
 * The fake people's names and addresses for `seed`, the same as those of
 * {@link fakeDemoData} at any `now`.
 */
export function fakePeople(seed: number): { firstName: string; lastName: string; email: string }[] {
  return drawPeople(randomTools(seed))
}

/** The fake people: sign-up times on a growing curve, devices, habits and a few special cases. */
function fakeUsers(tools: Tools, now: Date): FakeUser[] {
  const users = drawPeople(tools).map((person, i): FakeUser => {
    const video = i === VIDEO_PERSON_INDEX
    // Three in ten joined before the dashboard's window, the rest on a curve that grows to now.
    const joinedAgo = video
      ? 47 * DAY + 9 * HOUR
      : tools.chance(0.3)
      ? minuteOf(tools, tools.int(61, 240))
      : minuteOf(tools, recentDay(tools, now, 60))
    const deviceIndexes = video
      ? [...VIDEO_PERSON_DEVICES]
      : tools.sample(DEVICES.map((_, n) => n), tools.int(1, 3))
    const devices = deviceIndexes.map((n) => ({ userAgent: DEVICES[n], ip: fakeIp(tools) }))
    const signIns = signInsOf(tools, now, joinedAgo, devices.length)
    return {
      ...person,
      joinedAgo,
      verified: true,
      provider: null,
      providerAgo: 0,
      secondFactor: false,
      blockedAgo: null,
      profileUpdatedAgo: tools.chance(0.2) ? tools.between(joinedAgo - 30, 60) : null,
      firstGroupName: tools.chance(0.4) ? tools.pick(FIRST_GROUP_NAMES) : null,
      ownNotes: [],
      devices,
      signIns,
      sessions: sessionsOf(tools, signIns),
      passkey: null,
    }
  })
  const claire = users[VIDEO_PERSON_INDEX]
  // The video ends her two sessions: one on each of her browsers, both used today.
  claire.signIns = [
    ...claire.signIns.filter((s) => s.ago > 3 * DAY),
    { ago: 2 * DAY + 4 * HOUR, device: 0 },
    { ago: 6 * HOUR, device: 1 },
  ]
  claire.sessions = [
    { device: 0, createdAgo: 2 * DAY + 4 * HOUR, lastUsedAgo: 3 * HOUR },
    { device: 1, createdAgo: 6 * HOUR, lastUsedAgo: 40 },
  ]
  claire.profileUpdatedAgo = null

  const others = users.map((_, i) => i).filter((i) => i !== VIDEO_PERSON_INDEX)
  const recent = others.filter((i) => users[i].joinedAgo < 12 * DAY)
  for (const i of tools.sample(recent, 4)) {
    Object.assign(users[i], {
      verified: false,
      signIns: [],
      sessions: [],
      profileUpdatedAgo: null,
      firstGroupName: null,
    })
  }
  const verified = others.filter((i) => users[i].verified)
  const busy = verified.filter((i) => users[i].signIns.length >= 4)
  for (const i of tools.sample(busy, 2)) {
    const user = users[i]
    const blockedAgo = tools.between(user.signIns[Math.floor(user.signIns.length / 2)].ago, 2 * DAY)
    user.blockedAgo = blockedAgo
    user.signIns = user.signIns.filter((signIn) => signIn.ago > blockedAgo)
    user.sessions = []
  }
  const open = verified.filter((i) => users[i].blockedAgo === null)
  for (const [n, i] of tools.sample(open, 15).entries()) {
    const user = users[i]
    user.provider = n < 10 ? `oauth:google` : `oauth:github`
    // Half signed up with it, half linked it later.
    user.providerAgo = tools.chance(0.5) ? user.joinedAgo : tools.between(user.joinedAgo - 60, 60)
  }
  for (const i of tools.sample(open, 8)) users[i].secondFactor = true
  // About half keep a few notes of their own, written over the time since they joined.
  for (const user of users) {
    if (!user.verified || !tools.chance(0.55)) continue
    user.ownNotes = tools.sample(PERSONAL_NOTES, tools.int(1, 4))
      // Most right after they joined, fewer as time goes on.
      .map((note) => ({ ...note, ago: Math.max(0, tools.between(user.joinedAgo - 30, 20, true)) }))
      .sort((a, b) => b.ago - a.ago)
  }
  return users
}

/** Indexes of the people who may act in groups: not the video's person, address confirmed. */
function groupPeople(users: readonly FakeUser[]): number[] {
  return users.map((_, i) => i).filter((i) => users[i].verified && i !== VIDEO_PERSON_INDEX)
}

/**
 * One themed group, with members joining over time, tags, notes by several writers, a promotion
 * and pending invitations. `joined` says when a person joined the product (`Infinity` when it does
 * not matter) and `maxAgo` how old the group may be. With `yourRole`, the new account is in it
 * with that role; as the owner, the first fake person becomes an admin, and the content is the
 * fake people's.
 */
function fakeGroup(
  tools: Tools,
  theme: Theme,
  people: readonly number[],
  joined: (person: number) => number,
  maxAgo: number,
  yourRole: GroupRole | null,
  taken: Set<string>,
): FakeGroup {
  const { int, pick, chance, sample, between } = tools
  const picked = sample(people, int(theme.members[0], theme.members[1]) + 1)
    .sort((a, b) => joined(b) - joined(a))
  const [ownerIndex, ...memberIndexes] = picked
  const createdAgo = Math.max(
    2 * HOUR,
    Math.min(maxAgo, joined(ownerIndex) - int(30, 3 * DAY)),
  )
  const roles = [GroupRole.ADMIN, GroupRole.EDITOR, GroupRole.EDITOR, GroupRole.VIEWER]
  const members: FakeGroup["members"] = memberIndexes.map((member) => ({
    member,
    role: pick(roles),
    joinedAgo: between(Math.min(createdAgo - 5, joined(member)), 30, true),
  }))
  let owner: FakeMember = ownerIndex
  if (yourRole === GroupRole.OWNER) {
    owner = `you`
    members.unshift({ member: ownerIndex, role: GroupRole.ADMIN, joinedAgo: createdAgo - 5 })
  } else if (yourRole !== null) {
    members.push({ member: `you`, role: yourRole, joinedAgo: 0 })
  }
  const joinedAgo = (member: FakeMember) =>
    member === owner ? createdAgo : members.find((m) => m.member === member)!.joinedAgo
  // The new account writes nothing: the "Get started" checklist counts what a person made.
  const writers: FakeMember[] = [
    ...(owner === `you` ? [] : [owner]),
    ...members.filter((m) => m.member !== `you` && m.role !== GroupRole.VIEWER).map((m) =>
      m.member
    ),
  ]
  const lead = writers[0]
  const tags = theme.tags.map((tag) => ({
    ...tag,
    author: lead,
    createdAgo: Math.max(joinedAgo(lead) - int(2, 40), 20),
  }))
  const tagsReady = Math.min(...tags.map((tag) => tag.createdAgo))
  const notes = sample(theme.notes, theme.notes.length).map((note): FakeNote => {
    const author = pick(writers)
    const createdAgo = between(Math.min(tagsReady - 1, joinedAgo(author)), 15)
    const by = pick(writers)
    const edit = chance(0.35)
      ? { by, ago: between(Math.min(createdAgo - 1, joinedAgo(by)), 5) }
      : null
    return {
      ...note,
      tags: sample(theme.tags, int(0, 2)).map((tag) => tag.name),
      author,
      createdAgo,
      edit: edit && edit.ago < createdAgo ? edit : null,
    }
  }).sort((a, b) => b.createdAgo - a.createdAgo)
  const inviter =
    writers.find((w) =>
      w === owner || members.some((m) => m.member === w && m.role === GroupRole.ADMIN)
    ) ?? lead
  const inviteAgo = () => between(Math.min(joinedAgo(inviter), 6 * DAY), 20)
  const names = new Set<string>()
  const invitations: FakeGroup["invitations"] = [{
    email: uniquePerson(tools, names, taken).email,
    role: GroupRole.EDITOR,
    author: inviter,
    createdAgo: inviteAgo(),
  }]
  if (chance(0.5)) {
    invitations.push({
      email: null,
      role: GroupRole.VIEWER,
      author: inviter,
      createdAgo: inviteAgo(),
    })
  }
  const promotions = owner === `you` ? [] : members
    .filter((m) => m.role === GroupRole.ADMIN && chance(0.6))
    .map((m) => ({ member: m.member, ago: between(m.joinedAgo - 1, 30) }))
  return { name: theme.name, owner, createdAgo, members, tags, notes, invitations, promotions }
}

/** Subscriptions for the oldest groups, in the order of {@link PLAN_ROTA}. */
function fakeSubscriptions(tools: Tools, groups: readonly FakeGroup[]): FakeSubscription[] {
  const { int } = tools
  const MONTH = 30 * DAY
  const byAge = groups.map((_, i) => i).sort((a, b) => groups[b].createdAgo - groups[a].createdAgo)
  return PLAN_ROTA.map((kind, rank): FakeSubscription => {
    const group = byAge[rank]
    const { createdAgo, members } = groups[group]
    const seats = members.length + 1
    if (kind === `trial`) {
      const since = Math.max(HOUR, Math.min(createdAgo - HOUR, int(3, 12) * DAY + int(0, DAY)))
      return {
        group,
        status: BillingStatus.Trialing,
        seats,
        customerSinceAgo: since,
        periodEndIn: 14 * DAY - since,
        trialEndIn: 14 * DAY - since,
        pastDueSinceAgo: null,
        cancelAtPeriodEnd: false,
        everActive: false,
        paymentsAgo: [],
      }
    }
    const since = Math.max(2 * DAY, createdAgo - int(1, 10) * DAY)
    const endedAgo = kind === `canceled` ? int(8, 20) * DAY : 0
    const paymentsAgo: number[] = []
    for (let at = since; at > endedAgo; at -= MONTH) paymentsAgo.push(at)
    const nextIn = MONTH - (since % MONTH)
    const pastDueSinceAgo = kind === `past_due` ? 3 * DAY + int(0, 10 * HOUR) : null
    if (pastDueSinceAgo !== null) {
      // The renewal failed: the period moved on, but its payment never came.
      while (paymentsAgo.length > 1 && paymentsAgo[paymentsAgo.length - 1] < pastDueSinceAgo) {
        paymentsAgo.pop()
      }
    }
    return {
      group,
      status: {
        active: BillingStatus.Active,
        ending: BillingStatus.Active,
        canceled: BillingStatus.Canceled,
        past_due: BillingStatus.PastDue,
      }[kind],
      seats,
      customerSinceAgo: since,
      periodEndIn: kind === `canceled`
        ? -endedAgo
        : pastDueSinceAgo !== null
        ? MONTH - pastDueSinceAgo
        : nextIn,
      trialEndIn: null,
      pastDueSinceAgo,
      cancelAtPeriodEnd: kind === `ending`,
      everActive: true,
      paymentsAgo,
    }
  })
}

/** The newsletter: members and readers joining over four months, sends, a few who left. */
function fakeNewsletter(
  tools: Tools,
  now: Date,
  users: readonly FakeUser[],
  taken: Set<string>,
): Pick<FakeDemoData, `subscribers` | `unsubscribed` | `issues`> {
  const { int, chance, pick, sample, between } = tools
  const issues = SENT_ISSUES.map((sent, n) => ({
    issue: sent.issue,
    subject: sent.subject,
    sentAgo: sent.daysAgo * DAY + int(0, 5 * HOUR),
    failed: n === 1 ? 1 : 0,
  }))
  const readerDay = () =>
    chance(0.25) ? Math.max(0, pick(SENT_ISSUES).daysAgo - int(0, 2)) : recentDay(tools, now, 120)
  const members = sample(groupPeople(users).filter((i) => users[i].blockedAgo === null), 28)
  const subscribers = members.map((i) => ({
    email: users[i].email,
    ago: between(users[i].joinedAgo - 10, 30),
  }))
  const names = new Set<string>()
  while (subscribers.length < FAKE_COUNTS.subscribers) {
    subscribers.push({
      email: uniquePerson(tools, names, taken).email,
      ago: minuteOf(tools, readerDay()),
    })
  }
  const unsubscribed = Array.from({ length: 5 }, () => ({
    email: uniquePerson(tools, names, taken).email,
    ago: minuteOf(tools, Math.max(0, pick(SENT_ISSUES).daysAgo - int(0, 3))),
  }))
  return { subscribers, unsubscribed, issues }
}

/** What the operator did: blocked people, a reset, a refund, time given, two exports. */
function fakeOperator(
  tools: Tools,
  now: Date,
  users: readonly FakeUser[],
  subscriptions: readonly FakeSubscription[],
): FakeDemoData["operator"] {
  const { int, sample } = tools
  const signIns: number[] = []
  for (let day = 60; day >= 0; day--) {
    if (dayWeight(now, day) === 1 || tools.chance(0.2)) signIns.push(minuteOf(tools, day))
  }
  const actions: FakeOperatorAction[] = users.flatMap((user, i) =>
    user.blockedAgo === null ? [] : [{ kind: `blocked` as const, user: i, ago: user.blockedAgo }]
  )
  const open = groupPeople(users).filter((i) => users[i].blockedAgo === null)
  const [reset, ended] = sample(open, 2)
  actions.push({ kind: `password-reset`, user: reset, ago: int(1, 6) * DAY + int(0, DAY) })
  actions.push({ kind: `sessions-ended`, user: ended, ago: int(5, 15) * DAY + int(0, DAY) })
  const refunded = subscriptions.findIndex((s) => s.status === BillingStatus.Active)
  const lastPayment = subscriptions[refunded].paymentsAgo.at(-1)!
  actions.push({
    kind: `refund`,
    subscription: refunded,
    ago: Math.max(30, lastPayment - int(2 * HOUR, 2 * DAY)),
    note: `Charged twice after a card retry; refunded the second payment.`,
  })
  const trial = subscriptions.findLastIndex((s) => s.status === BillingStatus.Trialing)
  actions.push({
    kind: `time-given`,
    subscription: trial,
    ago: Math.min(subscriptions[trial].customerSinceAgo - 30, int(1, 3) * DAY),
    note: `An extra week while they move their notes over from a shared drive.`,
  })
  actions.push({ kind: `users-exported`, ago: int(3, 9) * DAY + int(0, DAY) })
  actions.push({ kind: `subscribers-exported`, ago: int(10, 25) * DAY + int(0, DAY) })
  return { joinedAgo: 210 * DAY, signIns, actions }
}

/**
 * Builds the demo's population from `seed`, with every time counted back from `now`: the fake
 * people, one group of theirs per theme, the subscriptions, the newsletter and what an operator
 * did. The same seed and `now` always give the same data; the names depend on `seed` alone.
 */
export function fakeDemoData(seed: number, now: Date): FakeDemoData {
  const tools = randomTools(seed)
  const users = fakeUsers(tools, now)
  const people = groupPeople(users)
  const taken = new Set(users.map((user) => user.email))
  const groups = THEMES.map((theme) =>
    fakeGroup(
      tools,
      theme,
      people,
      (i) => users[i].joinedAgo,
      tools.int(25, 220) * DAY,
      null,
      taken,
    )
  )
  const subscriptions = fakeSubscriptions(tools, groups)
  // Recent sign-ups start small groups of their own, so the newest groups are shared ones too.
  const recent = people.filter((i) => users[i].joinedAgo < SMALL_GROUPS_DAYS * DAY)
  const small = SMALL_THEMES.map((theme) =>
    fakeGroup(
      tools,
      theme,
      recent,
      (i) => users[i].joinedAgo,
      SMALL_GROUPS_DAYS * DAY,
      null,
      taken,
    )
  )
  // The video's person edits in one of them, so her page shows a shared group.
  const shared = small[0]
  shared.members.push({
    member: VIDEO_PERSON_INDEX,
    role: GroupRole.EDITOR,
    joinedAgo: tools.between(
      Math.min(shared.createdAgo - 5, users[VIDEO_PERSON_INDEX].joinedAgo),
      30,
      true,
    ),
  })
  // The newest small group came from an export file: its owner moved it over from elsewhere.
  small[small.length - 1].imported = true
  const newsletter = fakeNewsletter(tools, now, users, taken)
  const operator = fakeOperator(tools, now, users, subscriptions)
  addPasskeys(randomTools(seed + PASSKEY_SEED_OFFSET), users)
  return { users, groups: [...groups, ...small], subscriptions, ...newsletter, operator }
}

/** Passkeys draw from a stream of their own, so adding them moved no other fake row. */
const PASSKEY_SEED_OFFSET = 222

/** How many fake people have a passkey. */
export const FAKE_PASSKEYS = 12

/**
 * Gives {@link FAKE_PASSKEYS} confirmed, unblocked people a passkey on one of their devices, added
 * after they joined; most used it since.
 */
function addPasskeys(tools: ReturnType<typeof randomTools>, users: FakeUser[]): void {
  // Joined two days ago or more, so the passkey came later.
  const open = users.flatMap((user, i) =>
    user.verified && user.blockedAgo === null && user.joinedAgo > 2 * DAY ? [i] : []
  )
  for (const i of tools.sample(open, FAKE_PASSKEYS)) {
    const user = users[i]
    const addedAgo = tools.between(user.joinedAgo - 30, 60)
    user.passkey = {
      device: tools.int(0, user.devices.length - 1),
      addedAgo,
      lastUsedAgo: tools.chance(0.75) ? tools.between(addedAgo - 10, 5) : null,
    }
  }
}

/**
 * The sample groups of a new account (`you`), built from `seed`: one it owns and two of fake
 * people's where it is an editor and a viewer, so every role shows somewhere. Members are fake
 * people by index into the population of {@link fakeDemoData}; the groups are one to six weeks
 * old, and the account joined the two it does not own just now.
 */
export function fakeWorkspace(seed: number): FakeGroup[] {
  const tools = randomTools(seed)
  const people = Array.from({ length: FAKE_COUNTS.users }, (_, i) => i)
    .filter((i) => i !== VIDEO_PERSON_INDEX)
  const taken = new Set<string>()
  return YOUR_ROLES.map(([index, role]) =>
    withSampleFiles(fakeGroup(
      tools,
      THEMES[index],
      people,
      () => Infinity,
      tools.int(7, 40) * DAY + tools.int(0, DAY),
      role,
      taken,
    ))
  )
}

/** A photo and a PDF on the group's first note, and a photo on its second, named after them. */
function withSampleFiles(group: FakeGroup): FakeGroup {
  const slug = (title: string) =>
    title.toLowerCase().normalize(`NFKD`).replace(/[^a-z0-9]+/g, `-`).replace(/^-|-$/g, ``) ||
    `note`
  const notes = group.notes.map((note, index) => {
    if (index > 1) return note
    const files: NonNullable<FakeNote["files"]> = [{ name: `${slug(note.title)}.png`, kind: `png` }]
    if (index === 0) files.push({ name: `${slug(note.title)}.pdf`, kind: `pdf` })
    return { ...note, files }
  })
  return { ...group, notes }
}
