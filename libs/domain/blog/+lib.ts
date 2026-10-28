import { type } from "arktype"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import { type FieldError, type FieldErrors, FORM_FIELD } from "@spy4x/validation"
// The preferences module itself: `@domain/identity` imports this library (its audit kinds).
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  type Language,
  LANGUAGES,
  sitePath,
} from "../identity/preferences.ts"

/**
 * The blog (#395): posts an operator writes in the admin app and the public website shows once
 * they are published. A post is a draft, scheduled for a time, or published. `docs/blog.md` walks
 * through the life of a post; the SQL is `libs/server/blog/`.
 *
 * @module
 */

// #region Limits
// Each matches its column in migration `2026_11_30_0001_blog_posts.sql`, counted in characters
// (an emoji is one), as Postgres counts a VARCHAR.

/** The longest slug: the post's address is `/blog/<slug>`. */
export const BLOG_SLUG_MAX_LENGTH = 100
/** The longest title. */
export const BLOG_TITLE_MAX_LENGTH = 200
/** The longest search-result title; search engines show about 60 characters. */
export const BLOG_SEO_TITLE_MAX_LENGTH = 70
/** The longest description. The editor counts towards 155, what search results show. */
export const BLOG_DESCRIPTION_MAX_LENGTH = 300
/** The most key points ("In short") a post carries. */
export const BLOG_TLDR_MAX = 5
/** The longest key point. */
export const BLOG_TLDR_ITEM_MAX_LENGTH = 200
/** The longest topic name. */
export const BLOG_TOPIC_MAX_LENGTH = 50
/** The longest cover image address. */
export const BLOG_COVER_URL_MAX_LENGTH = 2000
/** The longest cover description. */
export const BLOG_COVER_ALT_MAX_LENGTH = 300
/** The longest body, in Markdown. */
export const BLOG_BODY_MAX_LENGTH = 200_000
/** The longest search text of the admin list. */
export const BLOG_SEARCH_MAX_LENGTH = 100
/** The most rows the admin list answers; there is no paging, since a blog has few posts. */
export const ADMIN_BLOG_LIST_MAX = 500
/** How far ahead a post may be scheduled. */
export const BLOG_SCHEDULE_MAX_DAYS = 5 * 366
/** How many posts the public post page suggests under "Read next". */
export const BLOG_READ_NEXT_COUNT = 3
/** How many posts the RSS feed carries, newest first. */
export const BLOG_FEED_COUNT = 20

/**
 * A post's address on the public website, in the language it is written in: `/blog/<slug>` in the
 * product's main language, `/de/blog/<slug>` in German.
 */
export function blogPostPath(post: { language: Language; slug: string }): string {
  return sitePath(post.language, `/blog/${post.slug}`)
}

/** A slug: lowercase letters and digits in words joined by single hyphens. */
export const BLOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// #endregion

// #region Shapes

/** Where a post is in its life. Only `published` posts are on the public website. */
export type BlogPostStatus = `draft` | `scheduled` | `published`

export const BLOG_POST_STATUSES: readonly BlogPostStatus[] = [`draft`, `scheduled`, `published`]

/** One post as the admin app reads it. */
export interface BlogPost {
  id: string
  slug: string
  title: string
  /** Shown in search results instead of the title; `null` uses the title. */
  seoTitle: string | null
  description: string
  /** The key points shown as "In short", at most {@link BLOG_TLDR_MAX}. */
  tldr: string[]
  topic: string | null
  /** An `https:` address, or `null` for no cover. */
  coverUrl: string | null
  /** Set whenever `coverUrl` is. */
  coverAlt: string | null
  bodyMd: string
  /** The language the post is written in; the website lists it on that language's index. */
  language: Language
  /**
   * The post this one translates, or `null` for a post of its own. The website links a post and
   * its live translations to each other as language versions (`hreflang`).
   */
  translationOf: string | null
  status: BlogPostStatus
  /** When the post goes or went live: set while scheduled or published, `null` for a draft. */
  publishAt: string | null
  /** When the post first went live. Never moves, also after unpublishing. */
  publishedAt: string | null
  /** The last "Significant update" of a published post, shown as "Updated". */
  contentUpdatedAt: string | null
  /** The operator who created it; `null` once their account is gone. */
  authorId: number | null
  /** The name shown on the post, kept when the account is gone. */
  authorName: string | null
  /** The mailing list the post is emailed to when it goes live, or `null` for none. */
  newsletterList: string | null
  /** When its newsletter issue was queued; set once ever. */
  newsletterSentAt: string | null
  /** How many confirmed subscribers the list had when the issue was queued. */
  newsletterRecipients: number | null
  createdAt: string
  updatedAt: string
  /** Starts at 1 and grows by one with every change; every write must name it. */
  version: number
}

/** One row of the admin list. */
export type AdminBlogPostRow = Pick<
  BlogPost,
  | `id`
  | `slug`
  | `title`
  | `status`
  | `topic`
  | `language`
  | `translationOf`
  | `publishAt`
  | `publishedAt`
  | `updatedAt`
>

/** How many posts each status chip of the admin list counts. */
export interface AdminBlogCounts {
  all: number
  draft: number
  scheduled: number
  published: number
}

/** The answer of `GET /api/admin/blog/posts`. */
export interface AdminBlogListResponse {
  posts: AdminBlogPostRow[]
  counts: AdminBlogCounts
}

/** One topic and how many posts carry it. */
export interface BlogTopic {
  topic: string
  count: number
}

/** One heading of a rendered body, for "On this page". */
export interface BlogHeading {
  /** The `id` of the heading element, for a `#` link. */
  id: string
  text: string
  /** 2 for `##`, 3 for `###`, and so on. */
  depth: number
}

/** A body rendered to safe HTML. */
export interface RenderedBlogBody {
  html: string
  headings: BlogHeading[]
  words: number
  readingMinutes: number
}

/**
 * A mailing list the publish dialog offers, with how many confirmed subscribers it has in each
 * language: a post's issue goes only to its language's (#527). A language with none is left out.
 */
export interface BlogNewsletterList {
  list: string
  byLanguage: Partial<Record<Language, number>>
}

/** The answer of `GET /api/admin/blog/newsletter`. */
export interface BlogNewsletterResponse {
  /** False when mail subscriptions or the public website's address are not set up. */
  enabled: boolean
  lists: BlogNewsletterList[]
  /**
   * The public website's address, such as `https://example.com`, for the editor's "View on
   * website"; `null` while `MPA_DOMAIN` is unset. Answered with the newsletter off too.
   */
  siteUrl: string | null
}

/** One post in a public list: what the blog index, sitemap and "Read next" show. */
export interface PublicBlogPostSummary {
  slug: string
  /** The language the post is written in; its address on the website is in that language. */
  language: Language
  title: string
  description: string
  topic: string | null
  publishedAt: string
  /** The last significant update, or `null`. */
  updatedAt: string | null
  readingMinutes: number
}

/** One published post, as the public website renders it. No id, author account or address. */
export interface PublicBlogPost extends PublicBlogPostSummary {
  seoTitle: string | null
  tldr: string[]
  coverUrl: string | null
  coverAlt: string | null
  html: string
  headings: BlogHeading[]
  authorName: string | null
  /**
   * The post's other language versions that are live, without the post itself: the post it
   * translates and that post's other translations. Empty when it has none.
   */
  translations: BlogTranslation[]
}

/** A live language version of a post, as its page links it. */
export interface BlogTranslation {
  language: Language
  slug: string
}

/** One item of the RSS feed: the summary, the cover and the full HTML. */
export type PublicBlogFeedItem =
  & PublicBlogPostSummary
  & Pick<PublicBlogPost, `html` | `authorName` | `coverUrl`>

// #endregion

// #region Errors

export type BlogErrorCode =
  | `POST_NOT_FOUND`
  | `INVALID_REQUEST`
  | `ID_ALREADY_EXISTS`
  | `SLUG_TAKEN`
  | `SLUG_LOCKED`
  | `SLUG_UNCHANGED`
  | `NOT_DRAFT_OR_SCHEDULED`
  | `NOT_SCHEDULED`
  | `NOT_PUBLISHED`
  | `NEWSLETTER_OFF`
  | `TRANSLATION_INVALID`
  | `VERSION_CONFLICT`

/** A refused blog request, with the field it is about when there is one. */
export class BlogError extends Error {
  constructor(
    public readonly code: BlogErrorCode,
    message: string,
    public readonly field: BlogField | null = null,
    /** Why it failed, by code, so a screen says it in the person's language (#275). */
    failed?: FieldError,
  ) {
    super(message)
    this.name = `BlogError`
    if (failed) this.fields = { [field ?? FORM_FIELD]: failed }
  }

  /** {@link field} (or the whole form) and why it failed, as the API's `fields` names them. */
  readonly fields?: FieldErrors
}

/**
 * A write named a version the post has moved past. It carries the version the post is at now, so
 * the editor can read it again instead of overwriting a change it never saw.
 */
export class BlogVersionConflictError extends BlogError {
  constructor(public readonly currentVersion: number) {
    super(`VERSION_CONFLICT`, `Someone else changed this post. Reload it to see their changes.`)
    this.name = `BlogVersionConflictError`
  }
}

// #endregion

// #region Request schemas
// The bodies of the admin routes. Lengths are checked in characters by `parseBlogPostFields`,
// not here: arktype counts UTF-16 units.

const postFields = {
  title: `string`,
  slug: `string`,
  description: `string`,
  "seoTitle?": `string | null`,
  "tldr?": `string[]`,
  "topic?": `string | null`,
  "coverUrl?": `string | null`,
  "coverAlt?": `string | null`,
  bodyMd: `string`,
  /** One of the languages the apps ship; left out, the product's main language. */
  "language?": type.enumerated(...LANGUAGES),
  "translationOf?": type(UUID_PATTERN).or(`null`),
} as const

const versionField = { version: `number.integer >= 1` } as const

/** `POST /api/admin/blog/posts`: a client-made id, so a retry cannot create a second post. */
export const blogPostCreateSchema = type({ id: UUID_PATTERN, ...postFields, "+": `reject` })
export type BlogPostCreateRequest = typeof blogPostCreateSchema.infer

/**
 * `POST /api/admin/blog/posts/:id`: every field and the version edited. `significantUpdate` on a
 * published post moves its "Updated" date. A different slug is refused once the post has been
 * published; "Change URL" changes it then.
 */
export const blogPostUpdateSchema = type({
  ...postFields,
  ...versionField,
  "significantUpdate?": `boolean`,
  "+": `reject`,
})
export type BlogPostUpdateRequest = typeof blogPostUpdateSchema.infer

/**
 * `POST /api/admin/blog/posts/:id/publish`: now without `at`, else scheduled for `at`.
 * `newsletterList` emails the post to that list when it goes live; left out, nothing is emailed.
 */
export const blogPublishSchema = type({
  ...versionField,
  "at?": `string.date.iso`,
  "newsletterList?": `string <= 64 | null`,
  "+": `reject`,
})
export type BlogPublishRequest = typeof blogPublishSchema.infer

/** The body of unschedule, unpublish and delete: the version the operator saw. */
export const blogVersionSchema = type({ ...versionField, "+": `reject` })

/** `POST /api/admin/blog/posts/:id/change-url`: the new slug. */
export const blogChangeUrlSchema = type({ ...versionField, slug: `string`, "+": `reject` })

/** `POST /api/admin/blog/preview`: the Markdown to render. */
export const blogPreviewSchema = type({ bodyMd: `string`, "+": `reject` })

// #endregion

// #region Validation

/** The fields a post's form has, as named in the request bodies. */
export type BlogField =
  | `title`
  | `slug`
  | `description`
  | `seoTitle`
  | `tldr`
  | `topic`
  | `coverUrl`
  | `coverAlt`
  | `bodyMd`
  | `language`
  | `translationOf`

/** A post's fields, trimmed and checked, as the repository stores them. */
export interface BlogPostFields {
  title: string
  slug: string
  description: string
  seoTitle: string | null
  tldr: string[]
  topic: string | null
  coverUrl: string | null
  coverAlt: string | null
  bodyMd: string
  language: Language
  translationOf: string | null
}

/** How many characters `text` has, an emoji counting as one, as Postgres counts. */
function characters(text: string): number {
  return Array.from(text).length
}

/** `null` for an empty or missing optional text, else the text trimmed. */
function optional(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? ``
  return trimmed === `` ? null : trimmed
}

/**
 * Why `slug` is not a slug, or `null` when it is one. Checked by the API and by the database.
 */
export function blogSlugProblem(slug: string): string | null {
  if (slug.length === 0) return `Enter the post's address.`
  if (slug.length > BLOG_SLUG_MAX_LENGTH) {
    return `Keep the address to ${BLOG_SLUG_MAX_LENGTH} characters.`
  }
  if (!BLOG_SLUG_PATTERN.test(slug)) {
    return `Use lowercase letters, digits and single hyphens, such as "my-first-post".`
  }
  return null
}

/**
 * Whether `url` is an absolute `https:` address with a host and no credentials: the only cover
 * a post may point at, so a page never loads an image over plain HTTP or from `javascript:`.
 */
export function isHttpsUrl(url: string): boolean {
  if (!URL.canParse(url)) return false
  const parsed = new URL(url)
  return parsed.protocol === `https:` && parsed.hostname !== `` && parsed.username === `` &&
    parsed.password === ``
}

/**
 * Trims and checks a post's fields. Throws {@link BlogError} with the field it is about: a
 * missing title or description, a slug that is no slug, more than {@link BLOG_TLDR_MAX} key
 * points, a cover that is not `https:` or has no description, a text past its column, or a NUL
 * or broken character anywhere.
 */
export function parseBlogPostFields(
  input: Pick<BlogPostCreateRequest, Exclude<keyof BlogPostCreateRequest, `id`>>,
): BlogPostFields {
  const fail = (field: BlogField, message: string, failed: FieldError): never => {
    throw new BlogError(`INVALID_REQUEST`, message, field, failed)
  }
  const tooLong = (rule: number): FieldError => ({ code: `maxLength`, values: { rule } })
  const fields: BlogPostFields = {
    title: input.title.trim(),
    slug: input.slug.trim(),
    description: input.description.trim(),
    seoTitle: optional(input.seoTitle),
    tldr: (input.tldr ?? []).map((point) => point.trim()).filter((point) => point !== ``),
    topic: optional(input.topic),
    coverUrl: optional(input.coverUrl),
    coverAlt: optional(input.coverAlt),
    bodyMd: input.bodyMd,
    language: isLanguage(input.language) ? input.language : DEFAULT_LANGUAGE,
    translationOf: input.translationOf ?? null,
  }
  const texts: [BlogField, string | null][] = [
    [`title`, fields.title],
    [`slug`, fields.slug],
    [`description`, fields.description],
    [`seoTitle`, fields.seoTitle],
    [`topic`, fields.topic],
    [`coverUrl`, fields.coverUrl],
    [`coverAlt`, fields.coverAlt],
    [`bodyMd`, fields.bodyMd],
    ...fields.tldr.map((point): [BlogField, string] => [`tldr`, point]),
  ]
  for (const [field, text] of texts) {
    if (text !== null && hasUnstorableTextCharacters(text)) {
      fail(field, `Remove the NUL or broken character from this field.`, {
        code: `unstorableCharacters`,
      })
    }
  }
  if (fields.title === ``) fail(`title`, `Enter a title.`, { code: `required` })
  if (characters(fields.title) > BLOG_TITLE_MAX_LENGTH) {
    fail(
      `title`,
      `Keep the title to ${BLOG_TITLE_MAX_LENGTH} characters.`,
      tooLong(BLOG_TITLE_MAX_LENGTH),
    )
  }
  const slugProblem = blogSlugProblem(fields.slug)
  if (slugProblem) {
    fail(
      `slug`,
      slugProblem,
      fields.slug === ``
        ? { code: `required` }
        : characters(fields.slug) > BLOG_SLUG_MAX_LENGTH
        ? tooLong(BLOG_SLUG_MAX_LENGTH)
        : { code: `slug` },
    )
  }
  if (fields.description === ``) fail(`description`, `Enter a description.`, { code: `required` })
  if (characters(fields.description) > BLOG_DESCRIPTION_MAX_LENGTH) {
    fail(
      `description`,
      `Keep the description to ${BLOG_DESCRIPTION_MAX_LENGTH} characters.`,
      tooLong(BLOG_DESCRIPTION_MAX_LENGTH),
    )
  }
  if (fields.seoTitle !== null && characters(fields.seoTitle) > BLOG_SEO_TITLE_MAX_LENGTH) {
    fail(
      `seoTitle`,
      `Keep the SEO title to ${BLOG_SEO_TITLE_MAX_LENGTH} characters.`,
      tooLong(BLOG_SEO_TITLE_MAX_LENGTH),
    )
  }
  if (fields.tldr.length > BLOG_TLDR_MAX) {
    fail(`tldr`, `Keep it to ${BLOG_TLDR_MAX} key points.`, {
      code: `maxItems`,
      values: { rule: BLOG_TLDR_MAX },
    })
  }
  if (fields.tldr.some((point) => characters(point) > BLOG_TLDR_ITEM_MAX_LENGTH)) {
    fail(
      `tldr`,
      `Keep each key point to ${BLOG_TLDR_ITEM_MAX_LENGTH} characters.`,
      tooLong(BLOG_TLDR_ITEM_MAX_LENGTH),
    )
  }
  if (fields.topic !== null && characters(fields.topic) > BLOG_TOPIC_MAX_LENGTH) {
    fail(
      `topic`,
      `Keep the topic to ${BLOG_TOPIC_MAX_LENGTH} characters.`,
      tooLong(BLOG_TOPIC_MAX_LENGTH),
    )
  }
  if (fields.coverUrl !== null) {
    if (characters(fields.coverUrl) > BLOG_COVER_URL_MAX_LENGTH || !isHttpsUrl(fields.coverUrl)) {
      fail(`coverUrl`, `Enter a full https:// link to the image.`, { code: `httpsUrl` })
    }
    if (fields.coverAlt === null) {
      fail(`coverAlt`, `Describe what the image shows.`, { code: `required` })
    }
  }
  if (fields.coverAlt !== null && characters(fields.coverAlt) > BLOG_COVER_ALT_MAX_LENGTH) {
    fail(
      `coverAlt`,
      `Keep the cover description to ${BLOG_COVER_ALT_MAX_LENGTH} characters.`,
      tooLong(BLOG_COVER_ALT_MAX_LENGTH),
    )
  }
  if (fields.coverUrl === null) fields.coverAlt = null
  if (characters(fields.bodyMd) > BLOG_BODY_MAX_LENGTH) {
    fail(
      `bodyMd`,
      `Keep the post to ${BLOG_BODY_MAX_LENGTH} characters.`,
      tooLong(BLOG_BODY_MAX_LENGTH),
    )
  }
  return fields
}

/**
 * When a publish request goes live: `now` without `at`, else `at`, which must lie in the future
 * and at most {@link BLOG_SCHEDULE_MAX_DAYS} days ahead. Answers `null` for "now".
 */
export function parsePublishTime(at: string | undefined, now: Date): Date | null {
  if (at === undefined) return null
  const when = new Date(at)
  if (Number.isNaN(when.getTime()) || when.getTime() <= now.getTime()) {
    throw new BlogError(`INVALID_REQUEST`, `Pick a time in the future.`, null, { code: `future` })
  }
  if (when.getTime() > now.getTime() + BLOG_SCHEDULE_MAX_DAYS * 86_400_000) {
    throw new BlogError(`INVALID_REQUEST`, `Pick a time within the next five years.`, null, {
      code: `withinYears`,
      values: { rule: 5 },
    })
  }
  return when
}

/** Reads the admin list's `?status=` value; anything else lists every post. */
export function parseBlogStatusFilter(value: string | null): BlogPostStatus | null {
  return BLOG_POST_STATUSES.includes(value as BlogPostStatus) ? value as BlogPostStatus : null
}

// #endregion

// #region Audit
// Every operator action on a post writes one `audit_events` row on the operator, with the post as
// its entity; the audit log names them (`@ui/admin-audit-screen.tsx`).

/** The `audit_events.entity_type` of a post. */
export const BLOG_POST_ENTITY = `blog_post`

/** The `audit_events.event_kind` of each operator action on a post. */
export const BLOG_AUDIT_KINDS = {
  created: `blog.post_created`,
  updated: `blog.post_updated`,
  published: `blog.post_published`,
  scheduled: `blog.post_scheduled`,
  unscheduled: `blog.post_unscheduled`,
  unpublished: `blog.post_unpublished`,
  urlChanged: `blog.post_url_changed`,
  deleted: `blog.post_deleted`,
} as const

export type BlogAuditKind = typeof BLOG_AUDIT_KINDS[keyof typeof BLOG_AUDIT_KINDS]

// #endregion

/** The job that publishes a scheduled post at its time and queues its newsletter issue. */
export const BLOG_PUBLISH_JOB = `blog.publish`
