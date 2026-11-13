import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  createDevtoArticle,
  DEVTO_MAX_TAGS,
  type DevtoArticleInput,
  type DevtoCreateResult,
  type DevtoFindResult,
  findDevtoArticleByCanonical,
} from "@spy4x/integrations/devto"
import { blogPostPath } from "@domain/blog"
import type { JobHandler } from "../jobs/jobs.ts"
import { readSiteUrl } from "../subscribers/subscribers.ts"
import { autoPostTargets } from "./auto-post.ts"
import type { BlogPostRow } from "./postgres-blog-repository.ts"

/**
 * The Dev.to cross-post of a live post: the post's text on Dev.to, with its
 * `canonical_url` at the public website, so search engines credit the website and not the copy.
 * Off unless `DEVTO_API_KEY` is set; docs/blog.md says how it runs.
 *
 * @module
 */

/** An article as Dev.to's API takes it. */
export type DevtoArticle = DevtoArticleInput

/**
 * The two calls the job makes, which hold the API key themselves, so the job never sees it. Their
 * errors never carry the key.
 */
export interface DevtoClient {
  /** The account's article whose canonical address is `canonicalUrl`, or `null` for none. */
  find(canonicalUrl: string): Promise<DevtoFindResult>
  /** Makes the article and answers its address. */
  create(article: DevtoArticle): Promise<DevtoCreateResult>
}

/** What the cross-post needs: the public website's origin and a Dev.to client. */
export interface BlogCrosspostSetup {
  /** Such as `https://www.example.com`. */
  siteUrl: string
  client: DevtoClient
}

/** The Dev.to client of the account `apiKey` names, from `@spy4x/integrations/devto`. */
export function devtoClient(apiKey: string): DevtoClient {
  return {
    find: (canonicalUrl) => findDevtoArticleByCanonical({ apiKey, canonicalUrl }),
    create: (article) => createDevtoArticle({ apiKey, article }),
  }
}

/**
 * The cross-post's setup from `DEVTO_API_KEY` and `MPA_DOMAIN`, or `null` when either is unset:
 * then every post is settled as never cross-posted. Plain HTTP only in development.
 *
 * @throws Error when `MPA_DOMAIN` carries a scheme.
 */
export function readCrosspostSetup(
  env: { get(name: string): string | undefined },
  mode: `dev` | `prod`,
): BlogCrosspostSetup | null {
  const apiKey = env.get(`DEVTO_API_KEY`)?.trim() ?? ``
  const siteUrl = readSiteUrl(env, mode)
  return apiKey === `` || siteUrl === null ? null : { siteUrl, client: devtoClient(apiKey) }
}

/** A body line that is an interactive figure's tag alone, such as `<CostCalculator members={4} />`. */
const FIGURE_LINE = /^\s*<[A-Z][A-Za-z0-9]*\b[^\n]*\/>\s*$/gm

/** A Markdown link or image target that starts at the site's root, such as `](/features/x)`. */
const ROOT_LINK = /\]\(\/(?!\/)/g

/**
 * The Dev.to article of `post`: its intro and body, with each interactive figure replaced by a
 * link to the original (Dev.to cannot run it) and every root-relative link made absolute, then a
 * line naming the original. Its cover is the post's cover, from the website when it is a file.
 */
export function devtoArticle(
  post: Pick<
    BlogPostRow,
    | `slug`
    | `language`
    | `title`
    | `description`
    | `intro`
    | `bodyMd`
    | `topic`
    | `coverUrl`
    | `coverFile`
  >,
  siteUrl: string,
): DevtoArticle {
  const canonical = `${siteUrl}${blogPostPath(post)}`
  const body = post.bodyMd
    .replace(FIGURE_LINE, `[Try the interactive figure in the original post](${canonical})`)
    .replace(ROOT_LINK, `](${siteUrl}/`)
    .trim()
  const tag = post.topic?.toLowerCase().replace(/[^a-z0-9]/g, ``) ?? ``
  const cover = post.coverFile ? `${siteUrl}/blog/covers/${post.coverFile}` : post.coverUrl
  return {
    title: post.title,
    body_markdown: [
      ...(post.intro ? [post.intro] : []),
      body,
      `*Originally published at [${new URL(siteUrl).host}](${canonical}).*`,
    ].join(`\n\n`) + `\n`,
    canonical_url: canonical,
    description: post.description,
    ...(tag ? { tags: [tag].slice(0, DEVTO_MAX_TAGS) } : {}),
    ...(cover ? { main_image: cover } : {}),
    published: true,
  }
}

/** What the `blog.crosspost` job needs. */
export interface BlogCrosspostJobDeps {
  sql: postgres.Sql
  /** `null` while the cross-post is off: the job settles the post as never cross-posted. */
  setup: BlogCrosspostSetup | null
  /** Told when the cross-post is skipped. Gets no key. */
  log: (line: string) => void
}

/** The cross-post failed; the job system tries again later. The message never holds the key. */
export class DevtoCrosspostError extends Error {
  constructor(postId: string, readonly channelId: string, readonly problem: string) {
    super(`Dev.to cross-post of blog post ${postId} failed: ${problem}`)
    this.name = `DevtoCrosspostError`
  }
}

/** The `error` of a Dev.to share row while `DEVTO_API_KEY` is unset. */
export const DEVTO_KEY_MISSING = `key-missing`

/**
 * Records the cross-post on the post's row of the Dev.to channel that posts it: posted at `url`,
 * or still to do with `error`. An error never overwrites a row the operator already moved on from
 * "to do".
 */
async function recordDevtoShare(
  sql: postgres.Sql | postgres.TransactionSql,
  postId: string,
  channelId: string,
  outcome: { url: string } | { error: string },
): Promise<void> {
  if (`url` in outcome) {
    await sql`
      INSERT INTO blog_post_shares (id, post_id, channel_id, status, url, shared_at, automatic)
      VALUES (${uuidV7()}, ${postId}, ${channelId}, 'posted', ${outcome.url}, now(), true)
      ON CONFLICT (post_id, channel_id) DO UPDATE SET status = 'posted', url = EXCLUDED.url,
        shared_at = now(), skip_reason = NULL, automatic = true, error = NULL, updated_at = now()
    `
    return
  }
  await sql`
    INSERT INTO blog_post_shares (id, post_id, channel_id, status, automatic, error)
    VALUES (${uuidV7()}, ${postId}, ${channelId}, 'todo', true, ${outcome.error.slice(0, 500)})
    ON CONFLICT (post_id, channel_id) DO UPDATE SET error = EXCLUDED.error, updated_at = now()
    WHERE blog_post_shares.status = 'todo'
  `
}

/**
 * The Dev.to channel that posts `post` by itself: active, "Post automatically" on, listing the
 * post, with its row still to do ({@link autoPostTargets}). `null` for none.
 */
async function devtoTarget(
  sql: postgres.Sql | postgres.TransactionSql,
  post: BlogPostRow,
): Promise<string | null> {
  if (post.translationOf !== null) return null
  const [channel] = await autoPostTargets(sql, post, [`devto`])
  return channel?.id ?? null
}

/**
 * The `blog.crosspost` job, about one post, queued by `blog.publish` once the post is live. It
 * posts the post to Dev.to once ever, and records it in `crossposted_at` and `devto_url`.
 *
 * Once ever, also when a run is retried, repeated or dies half way: a post with `crossposted_at`
 * set is never posted, two runs at once are kept apart by a lock on the post's id, and before it
 * posts, a run asks Dev.to for an article with the post's canonical address, which a run that
 * posted and died before it could record finds, and records instead of posting again. A Dev.to
 * error fails the run, and the job system tries again later (docs/jobs.md).
 *
 * A post that is no longer live is left for its next publish, which queues this job again. A
 * translation, a post no Dev.to channel posts by itself (none with "Post automatically" on lists
 * it, or its row there is posted, suggested or skipped), or any post while the cross-post is off,
 * is settled as never cross-posted.
 *
 * The post's row on the Dev.to channel says what happened: posted with the article's address, or
 * still to do with the failure (`key-missing` while the key is unset), so the operator can post it
 * by hand.
 */
export function blogCrosspostJob(deps: BlogCrosspostJobDeps): JobHandler {
  return async (event) => {
    try {
      await crosspost(deps, event.aggregateId)
    } catch (error) {
      // Kept apart from the rolled-back run, so the checklist says why the post is not there.
      if (error instanceof DevtoCrosspostError) {
        await recordDevtoShare(deps.sql, event.aggregateId, error.channelId, {
          error: error.problem,
        })
      }
      throw error
    }
  }
}

async function crosspost(deps: BlogCrosspostJobDeps, postId: string): Promise<void> {
  await deps.sql.begin(async (tx) => {
    // Held to the end of the transaction, without blocking the operator's saves of the post.
    const [{ locked }] = await tx<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${`blog.crosspost:${postId}`}, 0))
        AS locked
    `
    if (!locked) return
    const [post] = await tx<
      BlogPostRow[]
    >`SELECT * FROM blog_posts WHERE id = ${postId}`
    if (!post || post.crosspostedAt !== null || post.status !== `published`) return
    const channelId = await devtoTarget(tx, post)
    if (deps.setup === null || channelId === null) {
      await tx`UPDATE blog_posts SET crossposted_at = now() WHERE id = ${post.id}`
      if (channelId !== null) {
        deps.log(`blog post ${post.id}: no Dev.to cross-post: DEVTO_API_KEY is unset`)
        await recordDevtoShare(tx, post.id, channelId, { error: DEVTO_KEY_MISSING })
      }
      return
    }
    const { siteUrl, client } = deps.setup
    const article = devtoArticle(post, siteUrl)
    const found = await client.find(article.canonical_url)
    if (!found.success) throw new DevtoCrosspostError(post.id, channelId, found.error)
    let url = found.output?.url
    if (url === undefined) {
      const made = await client.create(article)
      if (!made.success) throw new DevtoCrosspostError(post.id, channelId, made.error)
      url = made.output.url
    }
    // Not a new version: the operator's open editor keeps saving; only the record changes.
    const devtoUrl = url.startsWith(`https://`) ? url : null
    await tx`
      UPDATE blog_posts SET crossposted_at = now(), devto_url = ${devtoUrl} WHERE id = ${post.id}
    `
    if (devtoUrl !== null) await recordDevtoShare(tx, post.id, channelId, { url: devtoUrl })
  })
}
