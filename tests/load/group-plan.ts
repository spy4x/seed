/**
 * What `deno task load:group` builds for each tier of one large group (spy4x/seed#440), and how
 * it reads its command line. No database here: `group-db.ts` writes what this plans, and
 * docs/capacity.md ("One large group") explains the proportions.
 *
 * @module
 */

/** The sizes the generator builds. */
export type Tier = "S" | "M" | "L" | "XL"

export const TIERS: readonly Tier[] = [`S`, `M`, `L`, `XL`]

/** Everything one tier's group holds. */
export interface TierPlan {
  tier: Tier
  /** The group's fixed id, so a second run finds the first run's group. */
  groupId: string
  /** The group's name, as the groups list shows it. */
  name: string
  notes: number
  /** At most `TAG_MAX_PER_GROUP` (100), the cap every group has. */
  tags: number
  /** Generated people, the owner included. Accounts added with `--member` come on top. */
  members: number
  /** Rows in the group's activity log: one "added the note" per newest note. */
  activity: number
  /** Notifications in one inbox: the generated owner's, and each `--member` account's. */
  notifications: number
  /** How far back the notes go: the first note is this many days old, the last one minutes. */
  spanDays: number
  /** How many notes one insert statement writes. */
  batch: number
}

/**
 * The fixed group id of each tier. Version 7 UUIDs written as literals (docs/ids.md): the tier is
 * the last digit, so a person reading the database sees which tier a row belongs to.
 */
const GROUP_IDS: Record<Tier, string> = {
  S: `019a3a40-0000-7440-8000-000000000001`,
  M: `019a3a40-0000-7440-8000-000000000002`,
  L: `019a3a40-0000-7440-8000-000000000003`,
  XL: `019a3a40-0000-7440-8000-000000000004`,
}

/** The sizes of each tier; docs/capacity.md has the same table. */
const SIZES: Record<Tier, Omit<TierPlan, `tier` | `groupId` | `name`>> = {
  S: {
    notes: 1_000,
    tags: 20,
    members: 10,
    activity: 1_000,
    notifications: 1_000,
    spanDays: 365,
    batch: 1_000,
  },
  M: {
    notes: 10_000,
    tags: 50,
    members: 100,
    activity: 10_000,
    notifications: 10_000,
    spanDays: 365,
    batch: 5_000,
  },
  L: {
    notes: 100_000,
    tags: 100,
    members: 1_000,
    activity: 100_000,
    notifications: 100_000,
    spanDays: 730,
    batch: 10_000,
  },
  XL: {
    notes: 1_000_000,
    tags: 100,
    members: 1_000,
    activity: 100_000,
    notifications: 100_000,
    spanDays: 1_460,
    batch: 20_000,
  },
}

/** The plan of `tier`. */
export function planTier(tier: Tier): TierPlan {
  const sizes = SIZES[tier]
  return {
    tier,
    groupId: GROUP_IDS[tier],
    name: `Load test ${tier}: ${sizes.notes.toLocaleString(`en-US`)} notes`,
    ...sizes,
  }
}

/**
 * The description a group gets once every row of its plan is written. A group with any other
 * description is unfinished (a run stopped half way) and the next run builds it again.
 */
export function finishedDescription(plan: TierPlan): string {
  return `Built by deno task load:group ${plan.tier}: ${plan.notes} notes, ${plan.tags} tags, ` +
    `${plan.members} members.`
}

/** The ranges `[from, to]` (1-based, inclusive) that write `total` rows `size` at a time. */
export function batches(total: number, size: number): Array<{ from: number; to: number }> {
  const ranges = []
  for (let from = 1; from <= total; from += size) {
    ranges.push({ from, to: Math.min(total, from + size - 1) })
  }
  return ranges
}

/** A member's role in the group, as `group_members.role` stores it. */
export enum MemberRole {
  Viewer = 1,
  Editor = 2,
  Admin = 3,
  Owner = 4,
}

/**
 * The role of each generated member, in order: the owner first, then 2 % admins (at least one when
 * there is room), then editors up to 40 % of the group, and viewers for the rest. Notes are written
 * by everyone who may write: the owner, the admins and the editors.
 */
export function memberRoles(count: number): MemberRole[] {
  const admins = Math.max(count > 1 ? 1 : 0, Math.floor(count * 0.02))
  const editors = Math.max(0, Math.floor(count * 0.4) - admins)
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return MemberRole.Owner
    if (i <= admins) return MemberRole.Admin
    if (i <= admins + editors) return MemberRole.Editor
    return MemberRole.Viewer
  })
}

const FIRST_NAMES = [
  `Ava`,
  `Ben`,
  `Chloe`,
  `Daniel`,
  `Emma`,
  `Felix`,
  `Grace`,
  `Henry`,
  `Isla`,
  `Jack`,
  `Kate`,
  `Liam`,
  `Mia`,
  `Noah`,
  `Olivia`,
  `Paul`,
]

const LAST_NAMES = [
  `Adams`,
  `Baker`,
  `Carter`,
  `Dawson`,
  `Ellis`,
  `Foster`,
  `Gray`,
  `Hughes`,
  `Irving`,
  `Jensen`,
  `Keller`,
  `Lowe`,
  `Morgan`,
]

/** The name of the generated member at `index` (0-based); 208 different pairs, then repeats. */
export function memberName(index: number): { firstName: string; lastName: string } {
  return {
    firstName: FIRST_NAMES[index % FIRST_NAMES.length],
    lastName: LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length],
  }
}

const TAG_WORDS = [
  `Groceries`,
  `Rent`,
  `Travel`,
  `Health`,
  `Work`,
  `Family`,
  `Ideas`,
  `Books`,
  `Taxes`,
  `Car`,
  `Garden`,
  `Gifts`,
  `School`,
  `Sport`,
  `Music`,
  `Home`,
  `Bills`,
  `Savings`,
  `Pets`,
  `Recipes`,
]

/**
 * The names of a group's `count` tags, unique without regard to case as `tags` requires: the
 * words above, then the same words numbered ("Travel 2").
 */
export function tagNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const word = TAG_WORDS[i % TAG_WORDS.length]
    const round = Math.floor(i / TAG_WORDS.length)
    return round === 0 ? word : `${word} ${round + 1}`
  })
}

/** Tag colours, from the palette the SPA offers. */
export const TAG_COLOURS = [
  `#4b5563`,
  `#dc2626`,
  `#ea580c`,
  `#ca8a04`,
  `#16a34a`,
  `#0891b2`,
  `#2563eb`,
  `#7c3aed`,
  `#db2777`,
]

/**
 * The words titles and bodies are made of. Each body takes 10 to 99 of them at random, so a single
 * word is in about a quarter of the notes: the "common" search below.
 */
export const WORDS = [
  `account`,
  `amount`,
  `answer`,
  `apartment`,
  `appointment`,
  `article`,
  `bakery`,
  `balance`,
  `bank`,
  `basket`,
  `bicycle`,
  `birthday`,
  `blanket`,
  `breakfast`,
  `bridge`,
  `budget`,
  `cabinet`,
  `calendar`,
  `camera`,
  `candle`,
  `card`,
  `carpet`,
  `chair`,
  `charge`,
  `check`,
  `chicken`,
  `class`,
  `client`,
  `coffee`,
  `colleague`,
  `concert`,
  `contract`,
  `cooking`,
  `cottage`,
  `course`,
  `cousin`,
  `dentist`,
  `deposit`,
  `dinner`,
  `doctor`,
  `document`,
  `draft`,
  `driver`,
  `electricity`,
  `email`,
  `evening`,
  `exercise`,
  `family`,
  `ferry`,
  `festival`,
  `field`,
  `flight`,
  `flower`,
  `friend`,
  `fruit`,
  `fuel`,
  `furniture`,
  `garage`,
  `garden`,
  `gift`,
  `glasses`,
  `grocery`,
  `gym`,
  `haircut`,
  `harbour`,
  `heating`,
  `holiday`,
  `hotel`,
  `house`,
  `idea`,
  `insurance`,
  `internet`,
  `invoice`,
  `jacket`,
  `journey`,
  `kitchen`,
  `ladder`,
  `lamp`,
  `laptop`,
  `lawyer`,
  `lesson`,
  `letter`,
  `library`,
  `list`,
  `loan`,
  `lunch`,
  `market`,
  `meeting`,
  `message`,
  `morning`,
  `mortgage`,
  `movie`,
  `museum`,
  `neighbour`,
  `notebook`,
  `office`,
  `order`,
  `package`,
  `painting`,
  `parcel`,
  `parking`,
  `party`,
  `passport`,
  `payment`,
  `pension`,
  `pharmacy`,
  `phone`,
  `picnic`,
  `plan`,
  `plumber`,
  `pocket`,
  `printer`,
  `project`,
  `receipt`,
  `recipe`,
  `refund`,
  `renovation`,
  `rent`,
  `repair`,
  `report`,
  `reservation`,
  `restaurant`,
  `river`,
  `salary`,
  `sandwich`,
  `savings`,
  `school`,
  `shelf`,
  `shoes`,
  `shopping`,
  `station`,
  `subscription`,
  `suitcase`,
  `supper`,
  `table`,
  `taxi`,
  `teacher`,
  `ticket`,
  `train`,
  `transfer`,
  `trip`,
  `umbrella`,
  `vacation`,
  `vet`,
  `visit`,
  `wallet`,
  `water`,
  `weekend`,
  `window`,
  `winter`,
  `workshop`,
]

/** A word no body holds; the generator puts it in the title of one note in a thousand. */
export const RARE_WORD = `zeppelin`

/**
 * The searches the measurements run: one common word (about a quarter of the notes), two words
 * that must both match, and the rare word (0.1 % of the notes).
 */
export const SEARCHES = {
  common: `budget`,
  pair: `budget invoice`,
  rare: RARE_WORD,
} as const

/** What the command line asks for. */
export type GroupCommand =
  | { action: `build`; tier: Tier; members: string[]; envFile: string; port: number | null }
  | { action: `remove`; tiers: Tier[]; envFile: string; port: number | null }
  | { action: `explain`; tier: Tier; envFile: string; port: number | null }

/** The usage line every refusal of {@link parseGroupArgs} ends with. */
export const USAGE = `Usage: deno task load:group <S|M|L|XL> [--member <email>]... ` +
  `| --remove [S|M|L|XL]... | --explain <S|M|L|XL>; options: --env-file <path> --port <port>`

/**
 * Reads the command line of `deno task load:group`. Throws with {@link USAGE} on anything it does
 * not know, so a typo never builds or removes the wrong thing.
 */
export function parseGroupArgs(args: readonly string[]): GroupCommand {
  let envFile = `infra/envs/.env`
  let port: number | null = null
  let mode: `build` | `remove` | `explain` = `build`
  const tiers: Tier[] = []
  const members: string[] = []
  const fail = (message: string): never => {
    throw new Error(`${message}\n${USAGE}`)
  }
  const value = (i: number, flag: string): string => {
    const next = args[i + 1]
    if (next === undefined || next.startsWith(`--`)) fail(`${flag} needs a value`)
    return next
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === `--remove`) mode = mode === `build` ? `remove` : fail(`Choose one action`)
    else if (arg === `--explain`) mode = mode === `build` ? `explain` : fail(`Choose one action`)
    else if (arg === `--member`) members.push(value(i++, arg).trim().toLowerCase())
    else if (arg === `--env-file`) envFile = value(i++, arg)
    else if (arg === `--port`) {
      const parsed = Number(value(i++, arg))
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) fail(`--port is 1 to 65535`)
      port = parsed
    } else if ((TIERS as readonly string[]).includes(arg.toUpperCase())) {
      tiers.push(arg.toUpperCase() as Tier)
    } else fail(`Unknown argument ${arg}`)
  }
  if (members.some((email) => !/^[^\s@]+@[^\s@]+$/.test(email))) fail(`--member takes an e-mail`)
  if (mode === `remove`) {
    if (members.length > 0) fail(`--member builds; it does not go with --remove`)
    return {
      action: `remove`,
      tiers: tiers.length > 0 ? [...new Set(tiers)] : [...TIERS],
      envFile,
      port,
    }
  }
  if (tiers.length !== 1) fail(`Name one tier`)
  if (mode === `explain`) {
    if (members.length > 0) fail(`--member builds; it does not go with --explain`)
    return { action: `explain`, tier: tiers[0], envFile, port }
  }
  return { action: `build`, tier: tiers[0], members: [...new Set(members)], envFile, port }
}

/**
 * Refuses a database that is not meant to hold load data. The env file must describe a development
 * stack (`ENV=dev`) or the public demo (`DEMO_MODE=true`), the two places the demo seed's fake
 * people may live too (`apps/worker/demo/options.ts`); a product's production env file has
 * neither. Answers the port on 127.0.0.1 to connect to: `--port` (a tunnel to the demo server),
 * else the host port the stack publishes Postgres on.
 */
export function connectionTarget(
  env: Readonly<Record<string, string>>,
  port: number | null,
): { port: number; database: string; user: string; password: string } {
  if (env.ENV !== `dev` && env.DEMO_MODE !== `true`) {
    throw new Error(
      `The env file has ENV=${env.ENV ?? `(unset)`} and DEMO_MODE=${env.DEMO_MODE ?? `(unset)`}: ` +
        `load data goes only into a development stack or the public demo`,
    )
  }
  for (const key of [`DB_NAME`, `DB_USER`, `DB_PASS`]) {
    if (!env[key]) throw new Error(`The env file has no ${key}`)
  }
  const published = (env.DB_HOST_PORT ?? ``).split(`:`).at(-1) || env.DB_PORT
  const chosen = port ?? Number(published)
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > 65535) {
    throw new Error(`No Postgres port: set DB_HOST_PORT or DB_PORT in the env file, or pass --port`)
  }
  return { port: chosen, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASS }
}
