import { seededRandom } from "@spy4x/platform/universal/statistics"
import { GroupRole } from "@domain/groups"
import type { TagColor } from "@domain/tags"

/**
 * The fake data of the public demo (docs/demo.md): people, groups with members, tags and notes,
 * pending invitations and newsletter subscribers, and the sample groups of a new account. Pure and
 * deterministic: one `seed` always gives the same data, so a test can pin it and each night can use
 * a new seed. Every address is on `example.com`, a domain reserved for examples, so no mail reaches
 * a real person.
 */

/** A fake person. Signs up with a random password nobody knows. */
export interface FakeUser {
  email: string
  firstName: string
  lastName: string
}

/** Who a fake group's row points at: a fake person by index, or the new account (`you`). */
export type FakeMember = number | `you`

export interface FakeNote {
  title: string
  body: string
  /** Names of the group's tags on the note. */
  tags: string[]
}

export interface FakeGroup {
  name: string
  owner: FakeMember
  members: { member: FakeMember; role: GroupRole }[]
  tags: { name: string; color: TagColor }[]
  notes: FakeNote[]
  /** Pending invitations: tied to an address, or `null` for a link anyone may use. */
  invitations: { email: string | null; role: GroupRole }[]
}

export interface FakeDemoData {
  users: FakeUser[]
  groups: FakeGroup[]
  /** Addresses on the newsletter list. */
  subscribers: string[]
}

/** How much the demo holds. */
export const FAKE_COUNTS = { users: 25, subscribers: 40 } as const

const FIRST_NAMES = [
  `Ava`,
  `Ben`,
  `Chloe`,
  `Daniel`,
  `Elena`,
  `Felix`,
  `Grace`,
  `Hugo`,
  `Iris`,
  `Jonas`,
  `Kira`,
  `Leo`,
  `Maya`,
  `Noah`,
  `Olivia`,
  `Priya`,
  `Quinn`,
  `Rafael`,
  `Sofia`,
  `Theo`,
  `Uma`,
  `Victor`,
  `Wen`,
  `Yusuf`,
  `Zoe`,
]

const LAST_NAMES = [
  `Anderson`,
  `Becker`,
  `Costa`,
  `Dubois`,
  `Eriksen`,
  `Fischer`,
  `Garcia`,
  `Hansen`,
  `Ivanova`,
  `Jensen`,
  `Kowalski`,
  `Lee`,
  `Martin`,
  `Nakamura`,
  `Okafor`,
  `Patel`,
  `Rossi`,
  `Silva`,
  `Tanaka`,
  `Novak`,
  `Walsh`,
  `Young`,
]

/** One theme per group: its name, tags and the note titles its notes draw from. */
interface Theme {
  name: string
  tags: { name: string; color: TagColor }[]
  titles: string[]
}

const THEMES: Theme[] = [
  {
    name: `Product team`,
    tags: [
      { name: `roadmap`, color: `blue` },
      { name: `bug`, color: `red` },
      { name: `idea`, color: `purple` },
      { name: `done`, color: `green` },
    ],
    titles: [
      `Q3 roadmap draft`,
      `Onboarding drop-off: what we know`,
      `Pricing page feedback`,
      `Release notes for 2.4`,
      `Customer interview: Acme Corp`,
      `Search is slow on large accounts`,
      `Dark mode polish list`,
      `Weekly product sync`,
      `Ideas for the referral program`,
      `Mobile app beta checklist`,
    ],
  },
  {
    name: `Marketing`,
    tags: [
      { name: `blog`, color: `orange` },
      { name: `social`, color: `blue` },
      { name: `launch`, color: `purple` },
    ],
    titles: [
      `Launch post outline`,
      `Newsletter topics for next month`,
      `Landing page headline tests`,
      `Conference talk proposal`,
      `Case study: Northwind`,
      `SEO keywords to target`,
      `Social calendar, week 32`,
      `Podcast guest list`,
    ],
  },
  {
    name: `Engineering`,
    tags: [
      { name: `infra`, color: `gray` },
      { name: `incident`, color: `red` },
      { name: `rfc`, color: `blue` },
      { name: `tech-debt`, color: `orange` },
    ],
    titles: [
      `RFC: move jobs to the outbox`,
      `Postgres upgrade plan`,
      `Incident review: login outage`,
      `On-call handbook`,
      `Flaky tests to fix`,
      `Backup restore drill`,
      `API rate limits`,
      `Dependency updates, August`,
      `Code review guidelines`,
    ],
  },
  {
    name: `Book club`,
    tags: [
      { name: `to-read`, color: `blue` },
      { name: `finished`, color: `green` },
      { name: `favourite`, color: `purple` },
    ],
    titles: [
      `Next month's pick`,
      `Notes on "The Left Hand of Darkness"`,
      `Meeting schedule`,
      `Books everyone suggested`,
      `Questions for Thursday`,
      `Favourite quotes so far`,
    ],
  },
  {
    name: `Home renovation`,
    tags: [
      { name: `kitchen`, color: `orange` },
      { name: `budget`, color: `red` },
      { name: `done`, color: `green` },
    ],
    titles: [
      `Kitchen layout options`,
      `Quotes from contractors`,
      `Paint colours shortlist`,
      `Budget tracker`,
      `Things to buy this weekend`,
      `Bathroom tiles`,
      `Permit paperwork`,
    ],
  },
  {
    name: `Trip to Japan`,
    tags: [
      { name: `booking`, color: `blue` },
      { name: `food`, color: `orange` },
      { name: `must-see`, color: `purple` },
    ],
    titles: [
      `Itinerary, two weeks`,
      `Ryokan options in Kyoto`,
      `Rail pass: worth it?`,
      `Restaurants to try in Osaka`,
      `Packing list`,
      `Phrases to learn`,
      `Day trip to Nara`,
    ],
  },
  {
    name: `Design studio`,
    tags: [
      { name: `client`, color: `blue` },
      { name: `review`, color: `orange` },
      { name: `approved`, color: `green` },
    ],
    titles: [
      `Brand refresh brief`,
      `Feedback on the logo concepts`,
      `Icon set inventory`,
      `Type scale proposal`,
      `Client workshop agenda`,
      `Accessibility audit notes`,
    ],
  },
  {
    name: `Running club`,
    tags: [
      { name: `race`, color: `red` },
      { name: `training`, color: `blue` },
    ],
    titles: [
      `Autumn half marathon plan`,
      `Sunday long run routes`,
      `Interval sessions`,
      `Shoe recommendations`,
      `Race day checklist`,
    ],
  },
]

const SENTENCES = [
  `Let's decide this by Friday.`,
  `I added a few options below, comment on the ones you like.`,
  `Most of this came out of last week's call.`,
  `The numbers are rough, but the direction is clear.`,
  `Open question: who owns the follow-up?`,
  `We tried this once before and it worked well.`,
  `Keep it short, we can always add more later.`,
  `See the linked doc for the full context.`,
  `Two people raised the same concern, worth a look.`,
  `Next step is a quick prototype.`,
  `Nothing here is final yet.`,
  `Ping me if anything is unclear.`,
]

const BULLETS = [
  `Check with the team`,
  `Write a first draft`,
  `Compare three options`,
  `Ask for a quote`,
  `Book a time`,
  `Share the summary`,
  `Collect feedback`,
  `Update the budget`,
]

/** A new account's sample groups: by theme, the role the account has in it. */
const YOUR_ROLES: readonly [number, GroupRole][] = [
  [0, GroupRole.OWNER],
  [1, GroupRole.EDITOR],
  [3, GroupRole.VIEWER],
]

/** The seeded helpers both builders draw from. */
function randomTools(seed: number) {
  const random = seededRandom(seed)
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]
  const sample = <T>(items: readonly T[], count: number): T[] => {
    const copy = [...items]
    const out: T[] = []
    while (out.length < count && copy.length > 0) {
      out.push(copy.splice(int(0, copy.length - 1), 1)[0])
    }
    return out
  }
  return { random, int, pick, sample }
}

/**
 * One themed group of fake people, with its tags, notes and pending invitations. With `yourRole`,
 * the new account is in it with that role; as the owner, the first fake person becomes an admin.
 */
function fakeGroup(
  tools: ReturnType<typeof randomTools>,
  index: number,
  yourRole: GroupRole | null,
): FakeGroup {
  const { random, int, pick, sample } = tools
  const theme = THEMES[index]
  const people = Array.from({ length: FAKE_COUNTS.users }, (_, person) => person)
  const [ownerIndex, ...memberIndexes] = sample(people, int(4, 8))
  const roles = [GroupRole.ADMIN, GroupRole.EDITOR, GroupRole.EDITOR, GroupRole.VIEWER]
  const members: FakeGroup["members"] = memberIndexes.map((member) => ({
    member,
    role: pick(roles),
  }))
  let owner: FakeMember = ownerIndex
  if (yourRole === GroupRole.OWNER) {
    owner = `you`
    members.push({ member: ownerIndex, role: GroupRole.ADMIN })
  } else if (yourRole !== null) {
    members.push({ member: `you`, role: yourRole })
  }
  const notes = sample(theme.titles, theme.titles.length).map((title): FakeNote => {
    const lines = sample(SENTENCES, int(1, 3))
    if (random() < 0.5) lines.push(``, ...sample(BULLETS, int(2, 4)).map((item) => `- ${item}`))
    return {
      title,
      body: lines.join(`\n`),
      tags: sample(theme.tags, int(0, 2)).map((tag) => tag.name),
    }
  })
  const invitations: FakeGroup["invitations"] = [
    { email: `invitee${index + 1}@example.com`, role: GroupRole.EDITOR },
  ]
  if (random() < 0.5) invitations.push({ email: null, role: GroupRole.VIEWER })
  return { name: theme.name, owner, members, tags: theme.tags, notes, invitations }
}

/**
 * Builds the demo's population from `seed`: the fake people, one group of theirs per theme, and
 * the newsletter list. The same seed always gives the same data.
 */
export function fakeDemoData(seed: number): FakeDemoData {
  const tools = randomTools(seed)
  const { pick, sample } = tools

  const users: FakeUser[] = []
  // One person per full name, so the address follows from the name and never repeats.
  const names = new Set<string>()
  while (users.length < FAKE_COUNTS.users) {
    const firstName = pick(FIRST_NAMES)
    const lastName = pick(LAST_NAMES)
    const base = `${firstName}.${lastName}`.toLowerCase()
    if (names.has(base)) continue
    names.add(base)
    users.push({ email: `${base}@example.com`, firstName, lastName })
  }

  const groups = THEMES.map((_, index) => fakeGroup(tools, index, null))

  const subscribers = new Set<string>()
  for (const user of sample(users, 12)) subscribers.add(user.email)
  for (let n = 1; subscribers.size < FAKE_COUNTS.subscribers; n++) {
    subscribers.add(`reader${n}@example.com`)
  }

  return { users, groups, subscribers: [...subscribers] }
}

/**
 * The sample groups of a new account (`you`), built from `seed`: one it owns and two of fake
 * people's where it is an editor and a viewer, so every role shows somewhere. Members are fake
 * people by index into the population of {@link fakeDemoData}.
 */
export function fakeWorkspace(seed: number): FakeGroup[] {
  const tools = randomTools(seed)
  return YOUR_ROLES.map(([index, role]) => fakeGroup(tools, index, role))
}
