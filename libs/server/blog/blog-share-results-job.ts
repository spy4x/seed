import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { ONE_DAY_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import type { ShareResults } from "@spy4x/integrations/share-results"
import { findDevtoArticleByCanonical, readDevtoArticleResults } from "@spy4x/integrations/devto"
import { readRedditPostResults } from "@spy4x/integrations/reddit"
import { readHackerNewsItemResults } from "@spy4x/integrations/hackernews"
import { readMastodonStatusResults } from "@spy4x/integrations/mastodon"
import { readBlueskyPostResults } from "@spy4x/integrations/bluesky"
import { readHashnodePostResults } from "@spy4x/integrations/hashnode"
import { safeFetch } from "@spy4x/net/safe-fetch"
import {
  BLOG_READ_KINDS,
  BLOG_SHARE_RESULT_MAX,
  type BlogChannelKind,
  blogPostPath,
} from "@domain/blog"
import type { Language } from "@domain/identity"
import type { JobHandler } from "../jobs/jobs.ts"
import { readSiteUrl } from "../subscribers/subscribers.ts"

/**
 * The `blog.share-results` job: once an hour it reads how each posted copy of a blog post did on
 * the channels that report it (Dev.to, Reddit, Hacker News, Mastodon, Bluesky, Hashnode), and
 * stores each reading as a `blog_share_results` row with `source = 'job'`. docs/blog.md says how
 * it runs.
 *
 * @module
 */

/** What one reader answers: the copy's numbers, `null` when the channel has no such copy. */
export type ShareRead =
  | { success: true; output: ShareResults | null; error: `` }
  | { success: false; output: null; error: string }

/** The id or address of one copy, taken from its stored link, in the shape its reader needs. */
export type ShareTarget =
  | { kind: `devto` }
  | { kind: `reddit`; id: string }
  | { kind: `hackernews`; id: number }
  | { kind: `mastodon`; instanceUrl: string; statusId: string }
  | { kind: `bluesky`; uri: string }
  | { kind: `hashnode`; host: string; slug: string }

/**
 * One reader per kind, each holding its key itself, so the job never sees a token. A kind left
 * out has no reader in this setup, such as Dev.to without `DEVTO_API_KEY`: its copies are skipped.
 */
export interface ShareReaders {
  /** Reads the account's article whose `canonical_url` is the post's own address. */
  devto?: (canonicalUrl: string) => Promise<ShareRead>
  reddit?: (target: Extract<ShareTarget, { kind: `reddit` }>) => Promise<ShareRead>
  hackernews?: (target: Extract<ShareTarget, { kind: `hackernews` }>) => Promise<ShareRead>
  mastodon?: (target: Extract<ShareTarget, { kind: `mastodon` }>) => Promise<ShareRead>
  bluesky?: (target: Extract<ShareTarget, { kind: `bluesky` }>) => Promise<ShareRead>
  hashnode?: (target: Extract<ShareTarget, { kind: `hashnode` }>) => Promise<ShareRead>
}

/** What the job needs: the website's origin, for Dev.to's canonical address, and the readers. */
export interface ShareResultsSetup {
  siteUrl: string | null
  readers: ShareReaders
  /** Why each kind without a reader has none, such as `DEVTO_API_KEY is unset`. */
  missing: Partial<Record<BlogChannelKind, string>>
}

// #region Due rule

/** A copy is read for its first 90 days, and never after. */
export const SHARE_READ_DAYS = 90
/** While a copy is under 14 days old it is read daily, then weekly. */
export const SHARE_READ_DAILY_DAYS = 14
/**
 * How much earlier than a full day or week a copy counts as due. The job runs hourly and a run
 * takes some seconds, so a copy read at 10:17:05 would otherwise wait for 11:17 the next day and
 * drift an hour later every day.
 */
export const SHARE_READ_SLACK_MS = 60 * 60_000

/**
 * Whether a copy shared at `sharedAt` and last read (or last failed to read) by the job at
 * `lastReadAt` is due at `now`: never read; or read at least a day ago while under 14 days old,
 * or at least a week ago after that, each less {@link SHARE_READ_SLACK_MS}. A copy 90 days old or
 * older is never due again.
 */
export function shareReadDue(sharedAt: Date, lastReadAt: Date | null, now: Date): boolean {
  const age = now.getTime() - sharedAt.getTime()
  if (age >= SHARE_READ_DAYS * ONE_DAY_IN_MILLISECONDS) return false
  if (lastReadAt === null) return true
  const every = age < SHARE_READ_DAILY_DAYS * ONE_DAY_IN_MILLISECONDS
    ? ONE_DAY_IN_MILLISECONDS
    : 7 * ONE_DAY_IN_MILLISECONDS
  return now.getTime() - lastReadAt.getTime() >= every - SHARE_READ_SLACK_MS
}

// #endregion

// #region Links

const REDDIT_HOSTS = new Set([`reddit.com`, `www.reddit.com`, `old.reddit.com`, `new.reddit.com`])
/** A host name with a dot and a letter-only top level: no IP address, no single-label name. */
const PUBLIC_HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const MASTODON_ACCOUNT = /^@?[A-Za-z0-9_]+@([a-z0-9.-]+)$/i

/** `input` as a plain `https` link on the default port, without a user name, or `undefined`. */
function httpsLink(input: string): URL | undefined {
  if (!URL.canParse(input)) return undefined
  const url = new URL(input)
  if (url.protocol !== `https:` || url.port !== `` || url.username !== `` || url.password !== ``) {
    return undefined
  }
  return url
}

const segments = (url: URL) => url.pathname.split(`/`).filter((part) => part !== ``)

/**
 * What a copy's reader needs, from its stored link `url` and, for Mastodon, the channel's
 * `address` (`@you@instance`), or why the link does not fit its kind. Strict on purpose: the
 * request goes to a fixed API for every kind but Mastodon, whose instance must be the channel's
 * own, so a stored link never points the worker at a host the operator did not name as the
 * channel.
 */
export function shareTarget(
  kind: BlogChannelKind,
  url: string,
  address: string,
): ShareTarget | { error: string } {
  const link = httpsLink(url)
  const wrong = (shape: string) => ({ error: `The link is not ${shape}.` })
  if (!link) return { error: `The link is not a plain https address.` }
  const parts = segments(link)
  switch (kind) {
    case `devto`:
      return link.hostname === `dev.to` && parts.length === 2
        ? { kind }
        : wrong(`a Dev.to article (https://dev.to/you/post)`)
    case `reddit`: {
      const at = parts[0] === `r` ? 2 : 0
      const id = link.hostname === `redd.it` && parts.length === 1
        ? parts[0]
        : REDDIT_HOSTS.has(link.hostname) && parts[at] === `comments`
        ? parts[at + 1]
        : undefined
      return id !== undefined && /^[a-z0-9]{1,16}$/i.test(id)
        ? { kind, id: id.toLowerCase() }
        : wrong(`a Reddit post (https://www.reddit.com/r/name/comments/id/…)`)
    }
    case `hackernews`: {
      const id = link.searchParams.get(`id`) ?? ``
      return link.hostname === `news.ycombinator.com` && link.pathname === `/item` &&
          /^[1-9][0-9]{0,11}$/.test(id)
        ? { kind, id: Number(id) }
        : wrong(`a Hacker News item (https://news.ycombinator.com/item?id=123)`)
    }
    case `mastodon`: {
      const instance = MASTODON_ACCOUNT.exec(address.trim())?.[1]?.toLowerCase()
      if (!instance || !PUBLIC_HOST.test(instance)) {
        return { error: `The channel's address is not a Mastodon account (@you@instance).` }
      }
      const statusId = parts.length === 2 && parts[0].startsWith(`@`) ? parts[1] : ``
      if (link.hostname !== instance) return wrong(`a status on ${instance}`)
      return /^[A-Za-z0-9_-]{1,64}$/.test(statusId)
        ? { kind, instanceUrl: `https://${instance}`, statusId }
        : wrong(`a Mastodon status (https://${instance}/@you/123)`)
    }
    case `bluesky`: {
      const [profile, did, post, rkey] = parts
      if (link.hostname !== `bsky.app` || profile !== `profile` || post !== `post`) {
        return wrong(`a Bluesky post (https://bsky.app/profile/did:plc:…/post/…)`)
      }
      if (parts.length !== 4 || !/^[A-Za-z0-9._:~-]{1,512}$/.test(rkey)) {
        return wrong(`a Bluesky post (https://bsky.app/profile/did:plc:…/post/…)`)
      }
      // A handle would need a lookup the reader does not do; the copy Seed posts names the did.
      return /^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(decodeURIComponent(did))
        ? { kind, uri: `at://${decodeURIComponent(did)}/app.bsky.feed.post/${rkey}` }
        : wrong(`a Bluesky post link that names the account's did:, not its handle`)
    }
    case `hashnode`:
      return PUBLIC_HOST.test(link.hostname) && parts.length === 1 &&
          /^[\x21-\x7E]{1,250}$/.test(parts[0])
        ? { kind, host: link.hostname, slug: parts[0] }
        : wrong(`a Hashnode post (https://blog.example.com/post)`)
    default:
      return { error: `Seed reads no numbers from this kind of channel.` }
  }
}

// #endregion

// #region Setup

/**
 * `fetch` for a host taken from an operator's link (a Mastodon instance): it refuses private,
 * loopback and link-local addresses, also after DNS, and follows no redirect.
 */
const publicFetch: typeof fetch = async (input, init) =>
  (await safeFetch(input instanceof Request ? input.url : String(input), {
    method: init?.method,
    headers: init?.headers,
    body: init?.body ?? undefined,
    maxRedirects: 0,
  })).response

/**
 * The readers from the env. Hacker News, Mastodon, Bluesky and Hashnode read public numbers with
 * no key. Dev.to reads with `DEVTO_API_KEY`, the cross-post's key, and needs `MPA_DOMAIN` for the
 * post's canonical address. Reddit needs `MPA_DOMAIN` too: Reddit refuses a request without a
 * descriptive `User-Agent`, which names the website.
 *
 * @throws Error when `MPA_DOMAIN` carries a scheme.
 */
export function readShareResultsSetup(
  env: { get(name: string): string | undefined },
  mode: `dev` | `prod`,
): ShareResultsSetup {
  const siteUrl = readSiteUrl(env, mode)
  const apiKey = env.get(`DEVTO_API_KEY`)?.trim() ?? ``
  const readers: ShareReaders = {
    hackernews: ({ id }) => readHackerNewsItemResults({ id }),
    mastodon: ({ instanceUrl, statusId }) =>
      readMastodonStatusResults({ instanceUrl, statusId, fetch: publicFetch }),
    bluesky: ({ uri }) => readBlueskyPostResults({ uri }),
    hashnode: ({ host, slug }) => readHashnodePostResults({ host, slug }),
  }
  const missing: ShareResultsSetup[`missing`] = {}
  if (siteUrl === null) {
    missing.reddit = `MPA_DOMAIN is unset`
  } else {
    const userAgent = `web:${new URL(siteUrl).hostname}:1.0 (blog share results)`
    readers.reddit = ({ id }) => readRedditPostResults({ id, userAgent })
  }
  if (apiKey === `` || siteUrl === null) {
    missing.devto = apiKey === `` ? `DEVTO_API_KEY is unset` : `MPA_DOMAIN is unset`
  } else {
    readers.devto = async (canonicalUrl) => {
      const found = await findDevtoArticleByCanonical({ apiKey, canonicalUrl })
      if (!found.success) return found
      if (found.output === null) return { success: true, output: null, error: `` }
      return await readDevtoArticleResults({ apiKey, id: found.output.id })
    }
  }
  return { siteUrl, readers, missing }
}

// #endregion

// #region Job

/** At most this many copies are read in one run; the rest wait for the next hour. */
export const SHARE_READS_PER_RUN = 50

/** A posted copy the job may read, with what its reader and its due rule need. */
export interface ShareToRead {
  id: string
  kind: BlogChannelKind
  address: string
  url: string
  sharedAt: Date
  /** The later of the last job reading and the last failed read; `null` for neither. */
  lastReadAt: Date | null
  slug: string
  language: Language
}

/**
 * The copies due at `now`, those read longest ago first, at most {@link SHARE_READS_PER_RUN}:
 * posted, with a link, on an active channel of a kind Seed reads, shared within the last 90 days,
 * and due by {@link shareReadDue}.
 */
export async function sharesToRead(sql: postgres.Sql, now: Date): Promise<ShareToRead[]> {
  const since = new Date(now.getTime() - SHARE_READ_DAYS * ONE_DAY_IN_MILLISECONDS)
  const rows = await sql<ShareToRead[]>`
    SELECT share.id, channel.kind, channel.address, share.url, share.shared_at, post.slug,
      post.language,
      GREATEST(share.read_failed_at, (
        SELECT max(read_at) FROM blog_share_results
        WHERE share_id = share.id AND source = 'job'
      )) AS last_read_at
    FROM blog_post_shares share
    JOIN blog_channels channel ON channel.id = share.channel_id
    JOIN blog_posts post ON post.id = share.post_id
    WHERE share.status = 'posted' AND share.url IS NOT NULL AND share.shared_at > ${since}
      AND channel.archived_at IS NULL AND channel.kind IN ${sql([...BLOG_READ_KINDS])}
    ORDER BY last_read_at NULLS FIRST, share.id
  `
  return rows
    .filter((row) => shareReadDue(row.sharedAt, row.lastReadAt, now))
    .slice(0, SHARE_READS_PER_RUN)
}

/** What the `blog.share-results` job needs. */
export interface BlogShareResultsJobDeps {
  sql: postgres.Sql
  /** `null` while reading is off, as in tests that run other jobs: the job reads nothing. */
  setup: ShareResultsSetup | null
  /** Told when a kind is skipped or a read fails. Gets no key. */
  log: (line: string) => void
  /** The clock; tests pass their own. */
  now?: () => Date
}

/** A count as the table takes it: whole, 0 or more, at most a Postgres `integer`. */
const stored = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.min(BLOG_SHARE_RESULT_MAX, Math.max(0, Math.trunc(value)))

async function read(setup: ShareResultsSetup, share: ShareToRead): Promise<ShareRead> {
  const target = shareTarget(share.kind, share.url, share.address)
  if (`error` in target) return { success: false, output: null, error: target.error }
  const { readers } = setup
  switch (target.kind) {
    case `devto`:
      return await readers.devto!(`${setup.siteUrl}${blogPostPath(share)}`)
    case `reddit`:
      return await readers.reddit!(target)
    case `hackernews`:
      return await readers.hackernews!(target)
    case `mastodon`:
      return await readers.mastodon!(target)
    case `bluesky`:
      return await readers.bluesky!(target)
    case `hashnode`:
      return await readers.hashnode!(target)
  }
}

/**
 * The `blog.share-results` job, repeated hourly. Each run reads the copies {@link sharesToRead}
 * picks. A good read inserts one `blog_share_results` row with `source = 'job'` and clears the
 * copy's failure; a number the channel does not report stays `null`. A failed read (a link that
 * does not fit its kind, a channel that refuses, such as Reddit's `403`, or no such copy) is kept
 * on the copy as `read_error` and `read_failed_at`, and the copy waits as long as after a good
 * read, so a refusal is never retried every hour. One copy's failure never stops the others. A
 * kind with no reader in this setup is skipped with one log line per run.
 *
 * A row is written only while the copy still has the link that was read, so an operator who
 * corrects the link meanwhile does not get the old link's numbers or failure.
 */
export function blogShareResultsJob(deps: BlogShareResultsJobDeps): JobHandler {
  return async () => {
    const { sql, setup, log } = deps
    if (setup === null) return
    const now = deps.now?.() ?? new Date()
    const shares = await sharesToRead(sql, now)
    const skipped = new Set<BlogChannelKind>()
    for (const share of shares) {
      if (setup.readers[share.kind as keyof ShareReaders] === undefined) {
        if (!skipped.has(share.kind)) {
          skipped.add(share.kind)
          log(
            `blog share results: ${share.kind} skipped: ${
              setup.missing[share.kind] ?? `no reader`
            }`,
          )
        }
        continue
      }
      let outcome: ShareRead
      try {
        outcome = await read(setup, share)
      } catch (error) {
        outcome = { success: false, output: null, error: `the reader failed: ${String(error)}` }
      }
      const numbers = outcome.output
      const counts = numbers && {
        views: stored(numbers.views),
        reactions: stored(numbers.reactions),
        comments: stored(numbers.comments),
        score: stored(numbers.score),
      }
      const problem = !outcome.success
        ? outcome.error
        : counts === null
        ? `The channel has no such post; it may have been deleted.`
        : Object.values(counts).every((value) => value === null)
        ? `The channel reported no numbers.`
        : null
      if (problem !== null || counts === null) {
        log(`blog share results: share ${share.id} on ${share.kind} not read: ${problem}`)
        await sql`
          UPDATE blog_post_shares SET read_error = ${String(problem).slice(0, 500)},
            read_failed_at = ${now}
          WHERE id = ${share.id} AND url = ${share.url}
        `
        continue
      }
      await sql.begin(async (tx) => {
        const [current] = await tx`
          UPDATE blog_post_shares SET read_error = NULL, read_failed_at = NULL
          WHERE id = ${share.id} AND url = ${share.url} AND status = 'posted'
          RETURNING id
        `
        if (!current) return
        await tx`
          INSERT INTO blog_share_results
            (id, share_id, source, read_at, views, reactions, comments, score)
          VALUES (
            ${uuidV7()}, ${share.id}, 'job', ${now}, ${counts.views}, ${counts.reactions},
            ${counts.comments}, ${counts.score}
          )
        `
      })
    }
  }
}

// #endregion
