import type postgres from "postgres"
import { type } from "arktype"
import { extract } from "@std/front-matter/yaml"
import { fromFileUrl, join } from "@std/path"
import type { FileSystemPort } from "@spy4x/platform/server"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  BLOG_AUTHOR_NAME_MAX_LENGTH,
  BLOG_COVER_ALT_MAX_LENGTH,
  BlogError,
  type BlogPostFields,
  type BlogPostStatus,
  parseBlogPostFields,
} from "@domain/blog"
import { LANGUAGES } from "@domain/identity"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { queueDueBlogJobs } from "./blog-publish-job.ts"
import { queueIndexNow } from "./blog-indexnow-job.ts"
import type { BlogPostRow } from "./postgres-blog-repository.ts"

/**
 * Seed's own blog posts: Markdown files with YAML front matter in `seed-posts/`, loaded into
 * the blog's database only in demo mode, so a product built on Seed, which runs without it, never
 * gets them. The folder's README shows the format.
 *
 * @module
 */

/** The folder of Seed's post files, next to this module. */
export const SEED_POSTS_DIR = fromFileUrl(new URL(`./seed-posts/`, import.meta.url))

/** A file in {@link SEED_POSTS_DIR} that is not a post. */
const NOT_A_POST = `README.md`

/**
 * The folder of the posts' covers, inside {@link SEED_POSTS_DIR}: `<name>.webp`, `<name>-960.webp`
 * and `<name>-640.webp`.
 */
export const SEED_COVERS_DIR = join(SEED_POSTS_DIR, `covers`)

/** A post file's `cover`: a WebP file in `covers/`, named as a slug. */
const COVER_PATTERN = /^covers\/([a-z0-9]+(?:-[a-z0-9]+)*\.webp)$/

/** How many "In short" points a Seed post has: two to four. */
export const SEED_TLDR_MIN = 2
export const SEED_TLDR_MAX = 4

/** One post file, checked. */
export interface SeedPost {
  /** The file's name, for error messages. */
  file: string
  /** The fields as the blog stores them; `translationOf` is always `null` here. */
  fields: BlogPostFields
  /** The slug of the post this one translates, or `null`. */
  translationOf: string | null
  author: string
  /** In the past: published with this date. In the future: scheduled for it. */
  publishAt: Date
  /** Whether the post is emailed to subscribers when it goes live. */
  newsletter: boolean
  /** Whether the post is cross-posted to Dev.to when it goes live; never for a translation. */
  devto: boolean
  /**
   * The cover's file name in {@link SEED_COVERS_DIR}: the post's own `cover`, or for a translation
   * its original's, once {@link readSeedPosts} has read them all.
   */
  coverFile: string | null
}

/** A post file that cannot be loaded. Names the file and what is wrong. */
export class SeedPostError extends Error {
  constructor(file: string, problem: string) {
    super(`${file}: ${problem}`)
    this.name = `SeedPostError`
  }
}

/** The front matter of a post file. Lengths are checked by `parseBlogPostFields`, in characters. */
const frontMatterSchema = type({
  slug: `string`,
  language: type.enumerated(...LANGUAGES),
  "translationOf?": `string | null`,
  title: `string`,
  "seoTitle?": `string | null`,
  description: `string`,
  "tldr?": `string[] | null`,
  "topic?": `string | null`,
  "cover?": `string`,
  coverAlt: `string`,
  intro: `string`,
  "relatedFeature?": `string | null`,
  author: `string`,
  "authorUrl?": `string | null`,
  // YAML reads an unquoted timestamp as a date, a quoted one as text.
  publishAt: type(`Date`).or(`string.date.iso.parse`),
  "newsletter?": `boolean`,
  "devto?": `boolean`,
  "+": `reject`,
})

/**
 * Parses one post file named `file`. Throws {@link SeedPostError} for missing or unknown front
 * matter, a field the blog's own checks refuse, a name other than `<slug>.md`, an empty body, a
 * `cover` that is no WebP file in `covers/`, or fewer than {@link SEED_TLDR_MIN} or more than
 * {@link SEED_TLDR_MAX} "In short" points. A cover, its description and an intro are required
 * of Seed's own posts, unlike the admin app's; a translation names no cover, it shares its
 * original's.
 */
export function parseSeedPost(file: string, text: string): SeedPost {
  let attrs: unknown
  let body: string
  try {
    ;({ attrs, body } = extract(text))
  } catch (error) {
    throw new SeedPostError(file, `no YAML front matter between --- lines (${error})`)
  }
  const front = frontMatterSchema(attrs)
  if (front instanceof type.errors) throw new SeedPostError(file, front.summary)
  const translationOf = front.translationOf?.trim() || null
  let coverFile: string | null = null
  if (front.cover !== undefined) {
    const match = COVER_PATTERN.exec(front.cover)
    if (!match) {
      throw new SeedPostError(file, `cover: a WebP file in covers/, such as covers/<slug>.webp`)
    }
    coverFile = match[1]
  }
  if (translationOf === null && coverFile === null) {
    throw new SeedPostError(file, `cover: every post has one, such as covers/<slug>.webp`)
  }
  if (translationOf !== null && coverFile !== null) {
    throw new SeedPostError(file, `cover: a translation shares its original's; remove it`)
  }
  const tldr = front.tldr ?? []
  if (tldr.length < SEED_TLDR_MIN || tldr.length > SEED_TLDR_MAX) {
    throw new SeedPostError(file, `tldr: ${SEED_TLDR_MIN} to ${SEED_TLDR_MAX} points`)
  }
  if (front.intro.trim() === ``) throw new SeedPostError(file, `intro: two or three sentences`)
  if (front.coverAlt.trim() === ``) throw new SeedPostError(file, `coverAlt: what the cover shows`)
  let fields: BlogPostFields
  try {
    fields = parseBlogPostFields({
      slug: front.slug,
      language: front.language,
      title: front.title,
      seoTitle: front.seoTitle,
      description: front.description,
      tldr,
      topic: front.topic,
      coverUrl: null,
      // `parseBlogPostFields` keeps a description only with a cover address; the file's own
      // cover is checked above.
      coverAlt: null,
      authorUrl: front.authorUrl,
      intro: front.intro,
      relatedFeature: front.relatedFeature,
      bodyMd: body.trim() + `\n`,
      translationOf: null,
    })
  } catch (error) {
    if (!(error instanceof BlogError)) throw error
    throw new SeedPostError(file, `${error.field}: ${error.message}`)
  }
  if (file !== `${fields.slug}.md`) {
    throw new SeedPostError(file, `name the file after its slug: ${fields.slug}.md`)
  }
  if (fields.bodyMd.trim() === ``) throw new SeedPostError(file, `the post has no body`)
  const author = front.author.trim()
  if (
    author === `` || Array.from(author).length > BLOG_AUTHOR_NAME_MAX_LENGTH ||
    hasUnstorableTextCharacters(author)
  ) {
    throw new SeedPostError(file, `author: 1 to ${BLOG_AUTHOR_NAME_MAX_LENGTH} characters`)
  }
  const coverAlt = front.coverAlt.trim()
  if (
    Array.from(coverAlt).length > BLOG_COVER_ALT_MAX_LENGTH || hasUnstorableTextCharacters(coverAlt)
  ) {
    throw new SeedPostError(file, `coverAlt: up to ${BLOG_COVER_ALT_MAX_LENGTH} characters`)
  }
  return {
    file,
    fields: { ...fields, coverAlt },
    translationOf,
    author,
    publishAt: front.publishAt,
    newsletter: front.newsletter ?? false,
    devto: (front.devto ?? false) && translationOf === null,
    coverFile,
  }
}

/**
 * Checks what no single file can: a translation names a post among the files that is a post of
 * its own, in another language, and an original has at most one translation per language.
 */
export function checkSeedPosts(posts: readonly SeedPost[]): void {
  const bySlug = new Map(posts.map((post) => [post.fields.slug, post]))
  const languages = new Set<string>()
  for (const post of posts) {
    if (post.translationOf === null) continue
    const original = bySlug.get(post.translationOf)
    if (!original) {
      throw new SeedPostError(post.file, `translationOf: no post file ${post.translationOf}.md`)
    }
    if (original.translationOf !== null) {
      throw new SeedPostError(post.file, `translationOf: ${original.file} is a translation itself`)
    }
    if (original.fields.language === post.fields.language) {
      throw new SeedPostError(post.file, `translationOf: ${original.file} is in the same language`)
    }
    const key = `${post.translationOf} ${post.fields.language}`
    if (languages.has(key)) {
      throw new SeedPostError(
        post.file,
        `translationOf: ${original.file} has another ${post.fields.language} translation`,
      )
    }
    languages.add(key)
  }
}

/**
 * Reads and checks every post file in `dir`, sorted by name. Throws {@link SeedPostError} for the
 * first file that is wrong.
 */
export async function readSeedPosts(
  fs: Pick<FileSystemPort, `readDir` | `readText`>,
  dir = SEED_POSTS_DIR,
): Promise<SeedPost[]> {
  const names = (await fs.readDir(dir))
    .filter((entry) => entry.isFile && entry.name.endsWith(`.md`) && entry.name !== NOT_A_POST)
    .map((entry) => entry.name)
    .sort()
  const posts: SeedPost[] = []
  for (const name of names) {
    const text = await fs.readText(join(dir, name))
    if (text === null) throw new SeedPostError(name, `the file disappeared while reading`)
    posts.push(parseSeedPost(name, text))
  }
  checkSeedPosts(posts)
  const covers = new Map(posts.map((post) => [post.fields.slug, post.coverFile]))
  return posts.map((post) =>
    post.translationOf === null ? post : { ...post, coverFile: covers.get(post.translationOf)! }
  )
}

/** The columns a load writes, as it compares them. */
interface StoredPost {
  slug: string
  title: string
  seoTitle: string | null
  description: string
  tldr: string[]
  topic: string | null
  coverUrl: string | null
  coverAlt: string | null
  coverFile: string | null
  intro: string | null
  relatedFeature: string | null
  authorUrl: string | null
  bodyMd: string
  language: string
  translationOf: string | null
  status: BlogPostStatus
  publishAt: Date
  publishedAt: Date | null
  authorName: string
  newsletterList: string | null
  newsletterSentAt: Date | null
  crosspostedAt: Date | null
}

/** Whether `row` holds every value of `wanted`, dates compared by their time. */
function same(row: StoredPost, wanted: StoredPost): boolean {
  return (Object.keys(wanted) as (keyof StoredPost)[]).every((key) => {
    const [a, b] = [row[key], wanted[key]]
    if (a instanceof Date || b instanceof Date) {
      return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    }
    return JSON.stringify(a) === JSON.stringify(b)
  })
}

/**
 * Writes `posts` to the blog, matched by slug, in one transaction, then queues the `blog.publish`
 * jobs they need. Originals are written before their translations, which point at them.
 *
 * - A post that is not there is created, with no author account and the file's author name.
 * - A post that differs from its file is changed to match it, as a new version.
 * - A post that matches its file is left as it is, so a second run writes nothing.
 * - A post in the database that no file names is left alone.
 *
 * A `publishAt` in the future makes the post scheduled, so the `blog.publish` job publishes it
 * then; one in the past publishes it with that date. `newsletter: true` stores the default list,
 * so the job emails the post once when it is live. `newsletter: false` stores no list and records
 * the post as mailed (`newsletter_sent_at`), so it is never emailed, also when an operator adds a
 * list later. A post already mailed keeps its list and record. Answers how many posts it wrote.
 */
export async function upsertSeedPosts(
  sql: postgres.Sql,
  posts: readonly SeedPost[],
  now = new Date(),
): Promise<number> {
  const ordered = [...posts].sort((a, b) =>
    Number(a.translationOf !== null) - Number(b.translationOf !== null)
  )
  const written = await sql.begin(async (tx) => {
    let count = 0
    for (const post of ordered) {
      const [existing] = await tx<(StoredPost & { id: string })[]>`
        SELECT id, slug, title, seo_title, description, tldr, topic, cover_url, cover_alt,
          cover_file, intro, related_feature, author_url, body_md, language, translation_of,
          status, publish_at, published_at, author_name, newsletter_list, newsletter_sent_at,
          crossposted_at
        FROM blog_posts WHERE slug = ${post.fields.slug}
        FOR UPDATE
      `
      let translationOf: string | null = null
      if (post.translationOf !== null) {
        const [original] = await tx<Pick<BlogPostRow, `id`>[]>`
          SELECT id FROM blog_posts WHERE slug = ${post.translationOf}
        `
        translationOf = original.id
      }
      const live = post.publishAt <= now
      const mailed = existing?.newsletterSentAt ?? null
      const wanted: StoredPost = {
        slug: post.fields.slug,
        title: post.fields.title,
        seoTitle: post.fields.seoTitle,
        description: post.fields.description,
        tldr: post.fields.tldr,
        topic: post.fields.topic,
        coverUrl: post.fields.coverUrl,
        coverAlt: post.fields.coverAlt,
        coverFile: post.coverFile,
        intro: post.fields.intro,
        relatedFeature: post.fields.relatedFeature,
        authorUrl: post.fields.authorUrl,
        bodyMd: post.fields.bodyMd,
        language: post.fields.language,
        translationOf,
        status: live ? `published` : `scheduled`,
        publishAt: post.publishAt,
        publishedAt: live ? post.publishAt : null,
        authorName: post.author,
        newsletterList: mailed
          ? existing?.newsletterList ?? null
          : post.newsletter
          ? DEFAULT_SUBSCRIBER_LIST
          : null,
        newsletterSentAt: mailed ?? (post.newsletter ? null : now),
        // As the newsletter: settled at once unless the file asks for the cross-post.
        crosspostedAt: existing?.crosspostedAt ?? (post.devto ? null : now),
      }
      if (existing && same(existing, wanted)) continue
      const w = wanted
      const id = existing?.id ?? uuidV7()
      if (existing) {
        await tx`
          UPDATE blog_posts SET
            title = ${w.title}, seo_title = ${w.seoTitle}, description = ${w.description},
            tldr = ${tx.array(w.tldr)}::text[], topic = ${w.topic}, cover_url = ${w.coverUrl},
            cover_alt = ${w.coverAlt}, cover_file = ${w.coverFile}, intro = ${w.intro},
            related_feature = ${w.relatedFeature}, author_url = ${w.authorUrl},
            body_md = ${w.bodyMd}, language = ${w.language},
            translation_of = ${w.translationOf}, status = ${w.status}, publish_at = ${w.publishAt},
            published_at = ${w.publishedAt}, author_name = ${w.authorName},
            newsletter_list = ${w.newsletterList}, newsletter_sent_at = ${w.newsletterSentAt},
            crossposted_at = ${w.crosspostedAt}, updated_at = ${now}, version = version + 1
          WHERE id = ${id}
        `
      } else {
        // A post that went live was written then.
        const writtenAt = live ? post.publishAt : now
        await tx`
          INSERT INTO blog_posts (
            id, slug, title, seo_title, description, tldr, topic, cover_url, cover_alt, cover_file,
            intro, related_feature, author_url, body_md, language, translation_of, status,
            publish_at, published_at, author_id, author_name, newsletter_list, newsletter_sent_at,
            crossposted_at, created_at, updated_at
          ) VALUES (
            ${id}, ${w.slug}, ${w.title}, ${w.seoTitle}, ${w.description},
            ${tx.array(w.tldr)}::text[], ${w.topic}, ${w.coverUrl}, ${w.coverAlt}, ${w.coverFile},
            ${w.intro}, ${w.relatedFeature}, ${w.authorUrl}, ${w.bodyMd}, ${w.language},
            ${w.translationOf}, ${w.status}, ${w.publishAt}, ${w.publishedAt}, NULL,
            ${w.authorName}, ${w.newsletterList}, ${w.newsletterSentAt}, ${w.crosspostedAt},
            ${writtenAt}, ${writtenAt}
          )
        `
      }
      // Seed's own posts are real (seedsaas.com): a live one that changed is announced.
      if (live) await queueIndexNow(tx, id)
      count++
    }
    return count
  })
  // A scheduled post gets its job at its time, a live one with a pending newsletter at once.
  await queueDueBlogJobs(sql)
  return written
}

/**
 * Loads Seed's post files into the blog when `demo` is on (`DEMO_MODE=true`), and does nothing,
 * reading no file, when it is off: a product built on Seed never gets Seed's posts. The worker
 * calls it at every start. Answers how many posts it wrote.
 */
export async function loadDemoBlogPosts(
  sql: postgres.Sql,
  options: {
    demo: boolean
    fs: Pick<FileSystemPort, `readDir` | `readText`>
    dir?: string
    now?: Date
  },
): Promise<number> {
  if (!options.demo) return 0
  return await upsertSeedPosts(sql, await readSeedPosts(options.fs, options.dir), options.now)
}
