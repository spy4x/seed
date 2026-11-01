import type postgres from "postgres"
import { type } from "arktype"
import { extract } from "@std/front-matter/yaml"
import { fromFileUrl, join } from "@std/path"
import type { FileSystemPort } from "@spy4x/platform/server"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  BLOG_AUTHOR_NAME_MAX_LENGTH,
  BlogError,
  type BlogPostFields,
  type BlogPostStatus,
  parseBlogPostFields,
} from "@domain/blog"
import { LANGUAGES } from "@domain/identity"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { queueDueBlogJobs } from "./blog-publish-job.ts"
import type { BlogPostRow } from "./postgres-blog-repository.ts"

/**
 * Seed's own blog posts (#621): Markdown files with YAML front matter in `seed-posts/`, loaded into
 * the blog's database only in demo mode, so a product built on Seed, which runs without it, never
 * gets them. The folder's README shows the format.
 *
 * @module
 */

/** The folder of Seed's post files, next to this module. */
export const SEED_POSTS_DIR = fromFileUrl(new URL(`./seed-posts/`, import.meta.url))

/** A file in {@link SEED_POSTS_DIR} that is not a post. */
const NOT_A_POST = `README.md`

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
  "coverUrl?": `string | null`,
  "coverAlt?": `string | null`,
  author: `string`,
  // YAML reads an unquoted timestamp as a date, a quoted one as text.
  publishAt: type(`Date`).or(`string.date.iso.parse`),
  "newsletter?": `boolean`,
  "+": `reject`,
})

/**
 * Parses one post file named `file`. Throws {@link SeedPostError} for missing or unknown front
 * matter, a field the blog's own checks refuse, a name other than `<slug>.md`, or an empty body.
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
  let fields: BlogPostFields
  try {
    fields = parseBlogPostFields({
      slug: front.slug,
      language: front.language,
      title: front.title,
      seoTitle: front.seoTitle,
      description: front.description,
      tldr: front.tldr ?? [],
      topic: front.topic,
      coverUrl: front.coverUrl,
      coverAlt: front.coverAlt,
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
  return {
    file,
    fields,
    translationOf: front.translationOf?.trim() || null,
    author,
    publishAt: front.publishAt,
    newsletter: front.newsletter ?? false,
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
  return posts
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
  bodyMd: string
  language: string
  translationOf: string | null
  status: BlogPostStatus
  publishAt: Date
  publishedAt: Date | null
  authorName: string
  newsletterList: string | null
  newsletterSentAt: Date | null
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
        SELECT id, slug, title, seo_title, description, tldr, topic, cover_url, cover_alt, body_md,
          language, translation_of, status, publish_at, published_at, author_name,
          newsletter_list, newsletter_sent_at
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
      }
      if (existing && same(existing, wanted)) continue
      const w = wanted
      if (existing) {
        await tx`
          UPDATE blog_posts SET
            title = ${w.title}, seo_title = ${w.seoTitle}, description = ${w.description},
            tldr = ${tx.array(w.tldr)}::text[], topic = ${w.topic}, cover_url = ${w.coverUrl},
            cover_alt = ${w.coverAlt}, body_md = ${w.bodyMd}, language = ${w.language},
            translation_of = ${w.translationOf}, status = ${w.status}, publish_at = ${w.publishAt},
            published_at = ${w.publishedAt}, author_name = ${w.authorName},
            newsletter_list = ${w.newsletterList}, newsletter_sent_at = ${w.newsletterSentAt},
            updated_at = ${now}, version = version + 1
          WHERE id = ${existing.id}
        `
      } else {
        // A post that went live was written then.
        const writtenAt = live ? post.publishAt : now
        await tx`
          INSERT INTO blog_posts (
            id, slug, title, seo_title, description, tldr, topic, cover_url, cover_alt, body_md,
            language, translation_of, status, publish_at, published_at, author_id, author_name,
            newsletter_list, newsletter_sent_at, created_at, updated_at
          ) VALUES (
            ${uuidV7()}, ${w.slug}, ${w.title}, ${w.seoTitle}, ${w.description},
            ${tx.array(w.tldr)}::text[], ${w.topic}, ${w.coverUrl}, ${w.coverAlt}, ${w.bodyMd},
            ${w.language}, ${w.translationOf}, ${w.status}, ${w.publishAt}, ${w.publishedAt},
            NULL, ${w.authorName}, ${w.newsletterList}, ${w.newsletterSentAt}, ${writtenAt},
            ${writtenAt}
          )
        `
      }
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
