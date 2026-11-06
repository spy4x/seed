import { type } from "arktype"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import type { FieldError, FieldErrors } from "@spy4x/validation"
import { isLanguage, type Language, LANGUAGES } from "../identity/preferences.ts"

/**
 * Sharing channels: the places an operator shares posts in (a subreddit, a Telegram channel, a
 * newsletter), what happened to each live post on each of them, and the numbers each copy got.
 * `docs/blog.md` ("Sharing channels") walks through it; the SQL is
 * `libs/server/blog/postgres-sharing-repository.ts`.
 *
 * @module
 */

// #region Kinds and limits

/** What a channel is, which decides what it can do by itself and which text it gets. */
export type BlogChannelKind =
  | `devto`
  | `telegram`
  | `mastodon`
  | `bluesky`
  | `hashnode`
  | `linkedin`
  | `x`
  | `reddit`
  | `hackernews`
  | `newsletter`
  | `other`

/** Every kind, in the order the channel form lists them. */
export const BLOG_CHANNEL_KINDS: readonly BlogChannelKind[] = [
  `devto`,
  `telegram`,
  `mastodon`,
  `bluesky`,
  `hashnode`,
  `linkedin`,
  `x`,
  `reddit`,
  `hackernews`,
  `newsletter`,
  `other`,
]

/** The kinds whose address is a link, so it must start with `https://`. */
const LINK_KINDS: ReadonlySet<BlogChannelKind> = new Set([
  `devto`,
  `telegram`,
  `hashnode`,
  `linkedin`,
  `x`,
  `newsletter`,
  `other`,
])

/**
 * The kinds Seed can post to by itself, each by a job of its own, when the channel's "Post
 * automatically" is on (docs/blog.md). The others are posted by hand.
 */
export const BLOG_AUTOMATIC_KINDS: ReadonlySet<BlogChannelKind> = new Set([
  `devto`,
  `telegram`,
  `mastodon`,
  `bluesky`,
  `hashnode`,
  `linkedin`,
])

/** The env key an automatic kind waits for, named on its rows while it is unset. */
export const BLOG_AUTO_POST_KEYS: Readonly<Partial<Record<BlogChannelKind, string>>> = {
  devto: `DEVTO_API_KEY`,
  telegram: `TELEGRAM_BOT_TOKEN`,
  mastodon: `MASTODON_ACCESS_TOKEN`,
  bluesky: `BLUESKY_APP_PASSWORD`,
  hashnode: `HASHNODE_TOKEN`,
  linkedin: `LINKEDIN_ACCESS_TOKEN`,
}

/** The `error` an automatic row keeps while its kind's key is not set in the env. */
export const BLOG_AUTO_POST_KEY_MISSING = `key-missing`

/** The `error` a LinkedIn row keeps once the LinkedIn sign-in has expired. */
export const BLOG_AUTO_POST_SIGN_IN_EXPIRED = `sign-in-expired`

/** How many days before the LinkedIn sign-in expires the admin warns about it. */
export const LINKEDIN_RENEW_DAYS = 14

/** The kinds whose numbers the `blog.share-results` job reads by itself (docs/blog.md). */
export const BLOG_READ_KINDS: ReadonlySet<BlogChannelKind> = new Set([
  `devto`,
  `reddit`,
  `hackernews`,
  `mastodon`,
  `bluesky`,
  `hashnode`,
])

/** What happened to one post on one channel. No row is the same as `todo`. */
export type BlogShareStatus = `todo` | `suggested` | `posted` | `skipped`

export const BLOG_SHARE_STATUSES: readonly BlogShareStatus[] = [
  `todo`,
  `suggested`,
  `posted`,
  `skipped`,
]

/**
 * Where a channel stands for one post on its checklist: a share status, or `covered` for a
 * translation whose original was already posted or suggested there.
 */
export type BlogShareState = BlogShareStatus | `covered`

/** The numbers a shared copy can show. */
export type BlogShareResultField = `views` | `reactions` | `comments` | `score`

/** The numbers each kind shows, in the order the results dialog asks for them. */
export const BLOG_RESULT_FIELDS: Record<BlogChannelKind, readonly BlogShareResultField[]> = {
  devto: [`views`, `reactions`, `comments`],
  telegram: [`views`, `reactions`, `comments`],
  mastodon: [`reactions`, `comments`],
  bluesky: [`reactions`, `comments`],
  hashnode: [`views`, `reactions`, `comments`],
  linkedin: [`views`, `reactions`, `comments`],
  x: [`views`, `reactions`, `comments`],
  reddit: [`score`, `comments`],
  hackernews: [`score`, `comments`],
  newsletter: [`views`],
  other: [`views`, `reactions`, `comments`],
}

// Each matches its column in migration `2026_12_15_0002_blog_sharing_channels.sql`, in characters.
export const BLOG_CHANNEL_NAME_MAX_LENGTH = 100
export const BLOG_CHANNEL_ADDRESS_MAX_LENGTH = 2000
export const BLOG_CHANNEL_UTM_SOURCE_MAX_LENGTH = 60
export const BLOG_SHARE_URL_MAX_LENGTH = 2000
export const BLOG_SHARE_SKIP_REASON_MAX_LENGTH = 200
/** The most channels the operator area keeps, so every checklist stays one short page. */
export const BLOG_CHANNELS_MAX = 100

/** The reason "Skip the rest" gives every row it skips. */
export const BLOG_SKIP_REST_REASON = `Done sharing`

/** A `utm_source`: lowercase letters, digits and single hyphens, as the database checks. */
export const BLOG_UTM_SOURCE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// #endregion

// #region Records

/** One sharing channel as the admin app reads it. */
export interface BlogChannel {
  id: string
  name: string
  kind: BlogChannelKind
  address: string
  utmSource: string
  addUtm: boolean
  languages: Language[]
  /** Only posts that went live on or after it list the channel; `null` lists every post. */
  startsAt: string | null
  archivedAt: string | null
  /** Seed posts each post here by itself; only for a kind in {@link BLOG_AUTOMATIC_KINDS}. */
  autoPost: boolean
  createdAt: string
  updatedAt: string
  version: number
}

/** What happened to one post on one channel. */
export interface BlogShare {
  id: string
  postId: string
  channelId: string
  status: BlogShareStatus
  url: string | null
  sharedAt: string | null
  skipReason: string | null
  automatic: boolean
  /** Why the last automatic post failed, such as `key-missing`; `null` when it did not. */
  error: string | null
  /** Why the results job's last read failed; `null` after a good read or before any. */
  readError: string | null
  /** When that read failed; set exactly when {@link readError} is. */
  readFailedAt: string | null
  updatedAt: string
}

/** The numbers one shared copy got, as read at {@link readAt}. `null` is a number not shown. */
export interface BlogShareResult {
  readAt: string
  source: `job` | `hand`
  views: number | null
  reactions: number | null
  comments: number | null
  score: number | null
}

/** One row of the channels screen: the channel, how many live posts still list it as to do. */
export interface AdminBlogChannelRow extends BlogChannel {
  shares: number
  toDo: number
  /** The last automatic post's error, such as `key-missing`. */
  lastError: string | null
}

/** The answer of `GET /api/admin/blog/channels`. */
export interface AdminBlogChannelsResponse {
  channels: AdminBlogChannelRow[]
  /** Every live post's language and time, so the form says how many posts a choice lists it on. */
  livePosts: { language: Language; publishedAt: string }[]
  /** When the LinkedIn sign-in in the server's env expires, `null` when none is set. */
  linkedinExpiresAt: string | null
}

/** One channel on a post's checklist. */
export interface AdminBlogShareRow {
  channel: BlogChannel
  share: BlogShare | null
  state: BlogShareState
  /** The text to paste, with the tagged link; `null` for a kind with no ready-made text. */
  text: string | null
  /** The post's address, with `utm_source` when the channel adds it. */
  link: string
  /** The channel's submit form with the title and the link filled in, for Reddit and HN. */
  submitUrl: string | null
  result: BlogShareResult | null
  /** Visits Umami counted under the channel's `utm_source`; `null` when it was not read. */
  visits: number | null
  /** A job that posts this row by itself is waiting or running. */
  posting: boolean
}

/** What the checklist knows of the website's visits. */
export interface AdminBlogVisits {
  /** `false` when Umami's settings are missing; the names of the missing ones. */
  setup: boolean
  missing: string[]
  /** When the visits were read, `null` without a read. */
  readAt: string | null
  /** The read failed, so the numbers are from {@link readAt}. */
  stale: boolean
}

/** The answer of `GET /api/admin/blog/posts/:id/sharing`. */
export interface AdminBlogSharingResponse {
  post: {
    id: string
    title: string
    language: Language
    status: `draft` | `scheduled` | `published`
    translationOf: string | null
    publishedAt: string | null
  }
  /** Whether any channel exists, archived ones included. */
  hasChannels: boolean
  rows: AdminBlogShareRow[]
  visits: AdminBlogVisits
  /** When the LinkedIn sign-in in the server's env expires, `null` when none is set. */
  linkedinExpiresAt: string | null
}

/** What the blog list shows of sharing: how many channels are active and each post's to-dos. */
export interface AdminBlogSharingSummary {
  activeChannels: number
  /** How many live posts list at least one channel as to do. */
  needsSharing: number
  /** Each post with something to do, by id: how many channels it still lists as to do. */
  toDo: Record<string, number>
}

// #endregion

// #region The gap rule

/** What the gap rule needs of a post. */
export interface SharingPost {
  id: string
  language: Language
  translationOf: string | null
  status: `draft` | `scheduled` | `published`
  publishedAt: string | null
}

/** What the gap rule needs of a channel. */
export type SharingChannel = Pick<BlogChannel, `id` | `languages` | `startsAt` | `archivedAt`>

/**
 * Whether `channel` lists `post` on its checklist: the post is live, the channel is active, takes
 * the post's language, and has no start or the post went live on or after it.
 */
export function channelListsPost(channel: SharingChannel, post: SharingPost): boolean {
  if (post.status !== `published` || post.publishedAt === null) return false
  if (channel.archivedAt !== null) return false
  if (!channel.languages.includes(post.language)) return false
  return channel.startsAt === null || Date.parse(post.publishedAt) >= Date.parse(channel.startsAt)
}

/**
 * Where `channel` stands for `post`, or `null` when it does not list the post. `own` is the post's
 * row on the channel; `original` is the original's row when the post is a translation. A
 * translation with no row of its own is covered when the original was posted or suggested there.
 */
export function blogShareState(
  channel: SharingChannel,
  post: SharingPost,
  own: Pick<BlogShare, `status`> | null | undefined,
  original: Pick<BlogShare, `status`> | null | undefined,
): BlogShareState | null {
  if (!channelListsPost(channel, post)) return null
  if (own) return own.status
  if (post.translationOf !== null && original) {
    if (original.status === `posted` || original.status === `suggested`) return `covered`
  }
  return `todo`
}

/**
 * How many channels still list `post` as to do. `shares` holds the rows of the post and, for a
 * translation, of its original, looked up by post and channel.
 */
export function blogSharingToDo(
  post: SharingPost,
  channels: readonly SharingChannel[],
  shares: (postId: string, channelId: string) => Pick<BlogShare, `status`> | undefined,
): number {
  return channels.filter((channel) => {
    const original = post.translationOf === null
      ? undefined
      : shares(post.translationOf, channel.id)
    return blogShareState(channel, post, shares(post.id, channel.id), original) === `todo`
  }).length
}

/** How many of `posts` that are live a channel taking `languages` from `startsAt` lists. */
export function channelPostCount(
  livePosts: readonly { language: Language; publishedAt: string }[],
  languages: readonly Language[],
  startsAt: string | null,
): number {
  const from = startsAt === null ? null : Date.parse(startsAt)
  return livePosts.filter((post) =>
    languages.includes(post.language) && (from === null || Date.parse(post.publishedAt) >= from)
  ).length
}

/**
 * Whether `channel` posts by itself: "Post automatically" on, of a kind Seed can post to, and not
 * Dev.to for a translation, which Dev.to never takes.
 */
export function channelPostsAutomatically(
  channel: Pick<BlogChannel, `kind` | `autoPost`>,
  translation: boolean,
): boolean {
  if (!channel.autoPost || !BLOG_AUTOMATIC_KINDS.has(channel.kind)) return false
  return !(channel.kind === `devto` && translation)
}

/** What the automatic posts need of a channel. */
export type AutoPostChannel = SharingChannel & Pick<BlogChannel, `kind` | `autoPost`>

/**
 * The channels a post that just went live is posted to by itself: each active channel with "Post
 * automatically" on, of a kind Seed can post to, that lists the post and still has it to do. A row
 * the operator moved on from (posted, suggested or skipped, also before the post went live) stops
 * it, and so does a translation's original posted or suggested there. Dev.to never takes a
 * translation: it gets the original once.
 */
export function blogAutoPostTargets<C extends AutoPostChannel>(
  post: SharingPost,
  channels: readonly C[],
  shares: (postId: string, channelId: string) => Pick<BlogShare, `status`> | undefined,
): C[] {
  return channels.filter((channel) => {
    if (!channelPostsAutomatically(channel, post.translationOf !== null)) return false
    const original = post.translationOf === null
      ? undefined
      : shares(post.translationOf, channel.id)
    return blogShareState(channel, post, shares(post.id, channel.id), original) === `todo`
  })
}

/** Where the LinkedIn sign-in stands: none set, fine, due for renewal, or expired. */
export type LinkedinSignInState =
  | { state: `none` }
  | { state: `ok` | `soon` | `expired`; expiresAt: string; daysLeft: number }

/**
 * The LinkedIn sign-in's state at `now`: `soon` from {@link LINKEDIN_RENEW_DAYS} days before it
 * expires, `expired` from its expiry on. `daysLeft` counts whole days, rounded up.
 */
export function linkedinSignInState(expiresAt: string | null, now: number): LinkedinSignInState {
  if (expiresAt === null) return { state: `none` }
  const left = Date.parse(expiresAt) - now
  const daysLeft = Math.max(0, Math.ceil(left / 86_400_000))
  if (left <= 0) return { state: `expired`, expiresAt, daysLeft }
  return { state: daysLeft <= LINKEDIN_RENEW_DAYS ? `soon` : `ok`, expiresAt, daysLeft }
}

// #endregion

/** A checklist's tally, for the sharing page's subtitle and the editor's summary. */
export interface BlogSharingCounts {
  /** Every row the checklist shows, an archived channel's handled row included. */
  total: number
  /** Of those, the ones posted, or covered by the original. */
  done: number
  toDo: number
  suggested: number
}

/**
 * Counts a checklist's rows, every one it shows, so the subtitle agrees with the groups. An
 * archived channel's row is shown only once it was handled, so it never adds a to-do.
 */
export function blogSharingCounts(rows: readonly { state: BlogShareState }[]): BlogSharingCounts {
  const count = (...states: BlogShareState[]) =>
    rows.filter((row) => states.includes(row.state)).length
  return {
    total: rows.length,
    done: count(`posted`, `covered`),
    toDo: count(`todo`),
    suggested: count(`suggested`),
  }
}

// #region Links

/**
 * `url` with `utm_source` set to `source`, or `url` as it is when `source` is `null`. The canonical
 * address and the `canonical_url` sent to Dev.to and Hashnode never carry it.
 */
export function withUtmSource(url: string, source: string | null): string {
  if (source === null) return url
  const tagged = new URL(url)
  tagged.searchParams.set(`utm_source`, source)
  return tagged.href
}

/** The `utm_source` a channel adds to its links, or `null` when it adds none. */
export function channelUtmSource(
  channel: Pick<BlogChannel, `addUtm` | `utmSource`>,
): string | null {
  return channel.addUtm ? channel.utmSource : null
}

/**
 * The submit form of a Reddit or Hacker News channel with the title and `link` filled in, or
 * `null` for any other kind. Reddit's address is the subreddit, such as `r/selfhosted`.
 */
export function blogSubmitUrl(
  channel: Pick<BlogChannel, `kind` | `address`>,
  title: string,
  link: string,
): string | null {
  if (channel.kind === `hackernews`) {
    const url = new URL(`https://news.ycombinator.com/submitlink`)
    url.searchParams.set(`u`, link)
    url.searchParams.set(`t`, title)
    return url.href
  }
  if (channel.kind === `reddit`) {
    const name = subreddit(channel.address)
    if (name === null) return null
    const url = new URL(`https://www.reddit.com/r/${name}/submit`)
    url.searchParams.set(`url`, link)
    url.searchParams.set(`title`, title)
    return url.href
  }
  return null
}

/** The subreddit `address` names (`r/selfhosted`, `/r/x`, a reddit.com link), or `null`. */
function subreddit(address: string): string | null {
  const match = /(?:^|\/)r\/([A-Za-z0-9_]{2,21})(?:\/|$)/.exec(address.trim())
  return match?.[1] ?? null
}

/** The page a channel's "Open channel" link goes to, or `null` when its address is no link. */
export function blogChannelHref(channel: Pick<BlogChannel, `kind` | `address`>): string | null {
  const address = channel.address.trim()
  if (channel.kind === `hackernews`) return `https://news.ycombinator.com/`
  if (channel.kind === `reddit`) {
    const name = subreddit(address)
    return name === null ? null : `https://www.reddit.com/r/${name}/`
  }
  if (channel.kind === `bluesky`) {
    const handle = address.replace(/^@/, ``)
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(handle) ? `https://bsky.app/profile/${handle}` : null
  }
  if (channel.kind === `mastodon`) {
    const match = /^@?([A-Za-z0-9_]+)@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(address)
    return match ? `https://${match[2]}/@${match[1]}` : null
  }
  return URL.canParse(address) && new URL(address).protocol === `https:` ? address : null
}

// #endregion

// #region Errors

export type BlogSharingErrorCode =
  | `CHANNEL_NOT_FOUND`
  | `SHARE_NOT_FOUND`
  | `POST_NOT_FOUND`
  | `NOT_PUBLISHED`
  | `INVALID_REQUEST`
  | `ID_ALREADY_EXISTS`
  | `NAME_TAKEN`
  | `UTM_SOURCE_TAKEN`
  | `HAS_SHARES`
  | `TOO_MANY_CHANNELS`
  | `VERSION_CONFLICT`
  | `NOT_AUTOMATIC`

/** The fields of the channel form and of a share, as the request bodies name them. */
export type BlogSharingField =
  | `name`
  | `kind`
  | `address`
  | `utmSource`
  | `languages`
  | `startsAt`
  | `url`
  | `skipReason`

/** A refused sharing request, with the field it is about when there is one. */
export class BlogSharingError extends Error {
  constructor(
    public readonly code: BlogSharingErrorCode,
    message: string,
    public readonly field: BlogSharingField | null = null,
    /** Why it failed, by code, so a screen says it in the person's language. */
    failed?: FieldError,
  ) {
    super(message)
    this.name = `BlogSharingError`
    if (failed && field) this.fields = { [field]: failed }
  }

  readonly fields?: FieldErrors
}

/** A channel write named a version the channel has moved past. */
export class BlogChannelVersionConflictError extends BlogSharingError {
  constructor(public readonly currentVersion: number) {
    super(`VERSION_CONFLICT`, `Someone else changed this channel. Reload it to see their changes.`)
    this.name = `BlogChannelVersionConflictError`
  }
}

// #endregion

// #region Request schemas

const channelFields = {
  name: `string`,
  kind: `string`,
  address: `string`,
  utmSource: `string`,
  addUtm: `boolean`,
  languages: type.enumerated(...LANGUAGES).array().atMostLength(20),
  startsAt: `string | null`,
  /** Left out, a channel of a kind that can post does. */
  "autoPost?": `boolean`,
} as const

/** `POST /api/admin/blog/channels`: a new channel, with the id the admin app made for it. */
export const blogChannelCreateSchema = type({ id: UUID_PATTERN, ...channelFields, "+": `reject` })
export type BlogChannelCreateRequest = typeof blogChannelCreateSchema.infer

/** `POST /api/admin/blog/channels/:id`: the channel's fields and the version they edit. */
export const blogChannelUpdateSchema = type({
  ...channelFields,
  version: `number.integer >= 1`,
  "+": `reject`,
})
export type BlogChannelUpdateRequest = typeof blogChannelUpdateSchema.infer

/** `POST /api/admin/blog/channels/:id/{archive,restore,delete}`. */
export const blogChannelVersionSchema = type({ version: `number.integer >= 1`, "+": `reject` })

/**
 * `POST /api/admin/blog/posts/:id/shares`: set `status` on the post's rows of `channelIds`. Serves
 * one row's change, its Undo (which sends the row back as it was) and "Skip the rest". `none`
 * removes a row that has no results, which is how Undo takes back a row the change made.
 */
export const blogShareSetSchema = type({
  channelIds: type(UUID_PATTERN).array().atLeastLength(1).atMostLength(BLOG_CHANNELS_MAX),
  status: `'todo' | 'suggested' | 'posted' | 'skipped' | 'none'`,
  "url?": `string | null`,
  "skipReason?": `string | null`,
  "sharedAt?": `string | null`,
  /** Sent only by Undo, with `error`: the row comes back automatic or not, with its error. */
  "automatic?": `boolean`,
  "error?": `string <= 500 | null`,
  "+": `reject`,
})
export type BlogShareSetRequest = typeof blogShareSetSchema.infer

/** The largest count a result holds: the top of a Postgres `integer`. */
export const BLOG_SHARE_RESULT_MAX = 2147483647

const count = `0 <= number.integer <= ${BLOG_SHARE_RESULT_MAX} | null` as const

/** `POST /api/admin/blog/posts/:id/shares/:channelId/results`: numbers typed by hand. */
export const blogShareResultsSchema = type({
  views: count,
  reactions: count,
  comments: count,
  score: count,
  "+": `reject`,
})
export type BlogShareResultsRequest = typeof blogShareResultsSchema.infer

// #endregion

// #region Validation

/** A channel's fields, trimmed and checked, as the repository stores them. */
export interface BlogChannelFields {
  name: string
  kind: BlogChannelKind
  address: string
  utmSource: string
  addUtm: boolean
  languages: Language[]
  startsAt: string | null
  autoPost: boolean
}

const characters = (text: string) => Array.from(text).length

function isKind(kind: string): kind is BlogChannelKind {
  return (BLOG_CHANNEL_KINDS as readonly string[]).includes(kind)
}

/** Whether `url` is an absolute `https:` address with a host and no credentials. */
function isHttps(url: string): boolean {
  if (!URL.canParse(url)) return false
  const parsed = new URL(url)
  return parsed.protocol === `https:` && parsed.hostname !== `` && parsed.username === `` &&
    parsed.password === ``
}

/**
 * Trims and checks a channel's fields. Throws {@link BlogSharingError} with the field it is about:
 * a missing name, address or source tag, an address that must be a link and is not, a source tag
 * that is not lowercase letters, digits and hyphens, no language, a text past its column, or a
 * broken character.
 */
export function parseBlogChannelFields(
  input: Omit<BlogChannelCreateRequest, `id`>,
): BlogChannelFields {
  const fail = (field: BlogSharingField, message: string, failed: FieldError): never => {
    throw new BlogSharingError(`INVALID_REQUEST`, message, field, failed)
  }
  const tooLong = (rule: number): FieldError => ({ code: `maxLength`, values: { rule } })
  if (!isKind(input.kind)) fail(`kind`, `Pick one of the types.`, { code: `unit` })
  const kind = input.kind as BlogChannelKind
  const fields: BlogChannelFields = {
    name: input.name.trim(),
    kind,
    address: kind === `hackernews` ? `news.ycombinator.com` : input.address.trim(),
    utmSource: input.utmSource.trim(),
    addUtm: input.addUtm,
    languages: [...new Set(input.languages)] as Language[],
    startsAt: input.startsAt,
    autoPost: BLOG_AUTOMATIC_KINDS.has(kind) && (input.autoPost ?? true),
  }
  for (const field of [`name`, `address`, `utmSource`] as const) {
    if (hasUnstorableTextCharacters(fields[field])) {
      fail(field, `Remove the broken or invisible character.`, { code: `unstorableCharacters` })
    }
  }
  if (fields.name === ``) fail(`name`, `Add a name.`, { code: `channelName` })
  if (characters(fields.name) > BLOG_CHANNEL_NAME_MAX_LENGTH) {
    fail(`name`, `Keep the name shorter.`, tooLong(BLOG_CHANNEL_NAME_MAX_LENGTH))
  }
  if (fields.address === ``) fail(`address`, `Add an address.`, { code: `channelAddress` })
  if (LINK_KINDS.has(kind)) {
    if (!isHttps(fields.address)) {
      fail(`address`, `Start the link with https://.`, { code: `channelHttps` })
    }
    fields.address = new URL(fields.address).href
  }
  if (characters(fields.address) > BLOG_CHANNEL_ADDRESS_MAX_LENGTH) {
    fail(`address`, `Keep the address shorter.`, tooLong(BLOG_CHANNEL_ADDRESS_MAX_LENGTH))
  }
  if (fields.utmSource === ``) fail(`utmSource`, `Add a source tag.`, { code: `channelSource` })
  if (!BLOG_UTM_SOURCE_PATTERN.test(fields.utmSource)) {
    fail(`utmSource`, `Use lowercase letters, digits and hyphens only.`, { code: `slug` })
  }
  if (characters(fields.utmSource) > BLOG_CHANNEL_UTM_SOURCE_MAX_LENGTH) {
    fail(`utmSource`, `Keep the source tag shorter.`, tooLong(BLOG_CHANNEL_UTM_SOURCE_MAX_LENGTH))
  }
  if (fields.languages.length === 0 || !fields.languages.every(isLanguage)) {
    fail(`languages`, `Pick at least one language.`, { code: `channelLanguages` })
  }
  if (fields.startsAt !== null) {
    const at = Date.parse(fields.startsAt)
    if (Number.isNaN(at)) fail(`startsAt`, `Pick a date.`, { code: `invalid` })
    fields.startsAt = new Date(at).toISOString()
  }
  return fields
}

/** A share's link and reason, trimmed and checked. */
export interface BlogShareFields {
  url: string | null
  skipReason: string | null
}

/**
 * Trims and checks the link and the skip reason of a share change. A link must be `https://`; a
 * reason is kept only on a skip.
 */
export function parseBlogShareFields(
  input: Pick<BlogShareSetRequest, `status` | `url` | `skipReason`>,
): BlogShareFields {
  const fail = (field: BlogSharingField, message: string, failed: FieldError): never => {
    throw new BlogSharingError(`INVALID_REQUEST`, message, field, failed)
  }
  let url = input.url?.trim() || null
  if (url !== null) {
    if (!isHttps(url)) fail(`url`, `Start the link with https://.`, { code: `channelHttps` })
    url = new URL(url).href
    if (characters(url) > BLOG_SHARE_URL_MAX_LENGTH) {
      fail(`url`, `Keep the link shorter.`, { code: `maxLength`, values: { rule: 2000 } })
    }
  }
  const reason = input.status === `skipped` ? input.skipReason?.trim() || null : null
  if (reason !== null) {
    if (hasUnstorableTextCharacters(reason)) {
      fail(`skipReason`, `Remove the broken or invisible character.`, {
        code: `unstorableCharacters`,
      })
    }
    if (characters(reason) > BLOG_SHARE_SKIP_REASON_MAX_LENGTH) {
      fail(`skipReason`, `Keep the reason shorter.`, {
        code: `maxLength`,
        values: { rule: BLOG_SHARE_SKIP_REASON_MAX_LENGTH },
      })
    }
  }
  return { url, skipReason: reason }
}

// #endregion

// #region Audit

/** The `audit_events.entity_type` of a channel. A share's events name the post. */
export const BLOG_CHANNEL_ENTITY = `blog_channel`

/** The `audit_events.event_kind` of each operator action on channels and shares. */
export const BLOG_SHARING_AUDIT_KINDS = {
  channelCreated: `blog.channel_created`,
  channelUpdated: `blog.channel_updated`,
  channelArchived: `blog.channel_archived`,
  channelRestored: `blog.channel_restored`,
  channelDeleted: `blog.channel_deleted`,
  shareChanged: `blog.share_changed`,
  resultsEntered: `blog.share_results_entered`,
  shareRetried: `blog.share_retried`,
} as const

// #endregion
