import { type Context, Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import type postgres from "postgres"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { JSON_BODY_WRONG_TYPE, readJsonBody } from "@spy4x/server/http/bounded-body"
import {
  type AdminBlogListResponse,
  BLOG_SEARCH_MAX_LENGTH,
  blogChangeUrlSchema,
  BlogError,
  type BlogNewsletterList,
  type BlogNewsletterResponse,
  type BlogPost,
  blogPostCreateSchema,
  type BlogPostFields,
  type BlogPostStatus,
  blogPostUpdateSchema,
  blogPreviewSchema,
  blogPublishSchema,
  blogSlugProblem,
  type BlogTopic,
  BlogVersionConflictError,
  blogVersionSchema,
  parseBlogPostFields,
  parseBlogStatusFilter,
  parsePublishTime,
  type RenderedBlogBody,
} from "@domain/blog"
import { isSubscriberList, SUBSCRIBER_LISTS } from "@domain/subscribers"
import { DEFAULT_LANGUAGE, type Language } from "@domain/identity"
import { type BlogActor, PostgresBlogRepository } from "@server/blog/postgres-blog-repository.ts"
import { renderBlogBody } from "@server/blog/render.ts"
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"
import { codeForStatus, errorResponse } from "../../services/error-response.ts"

/**
 * The largest body a blog route takes: a post's Markdown is up to 200,000 characters, and one
 * character is up to four bytes of UTF-8. Every other admin route keeps the API's 64 KiB.
 */
export const BLOG_BODY_MAX_BYTES = 1024 * 1024

/** What the blog routes call. Who may call it is the route's business. */
export interface AdminBlogService {
  list(filter: { status: BlogPostStatus | null; query: string }): Promise<AdminBlogListResponse>
  get(id: string): Promise<BlogPost | null>
  topics(): Promise<BlogTopic[]>
  create(id: string, fields: BlogPostFields, actor: BlogActor): Promise<BlogPost>
  update(
    id: string,
    version: number,
    fields: BlogPostFields,
    significantUpdate: boolean,
    actor: BlogActor,
  ): Promise<BlogPost>
  publish(
    id: string,
    version: number,
    at: Date | null,
    newsletterList: string | null,
    actor: BlogActor,
  ): Promise<BlogPost>
  unschedule(id: string, version: number, actor: BlogActor): Promise<BlogPost>
  unpublish(id: string, version: number, actor: BlogActor): Promise<BlogPost>
  changeUrl(id: string, version: number, slug: string, actor: BlogActor): Promise<BlogPost>
  delete(id: string, version: number, actor: BlogActor): Promise<void>
  /** Every mailing list with how many confirmed subscribers it has in each language. */
  confirmedSubscribers(): Promise<BlogNewsletterList[]>
}

/** What the blog routes need. */
export interface AdminBlogRouteDependencies {
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  blog: AdminBlogService
  /**
   * Whether a post can be emailed: mail subscriptions are on and the public website's address is
   * set, since the issue links to the post there.
   */
  newsletterEnabled: boolean
  /** The public website's address (`MPA_DOMAIN`), for the editor's "View on website"; `null` unset. */
  siteUrl: string | null
  now(): Date
}

/** The refusal of a body that is not JSON, or not the route's shape. */
function invalid(message: string): BlogError {
  return new BlogError(`INVALID_REQUEST`, message)
}

/** Reads and checks the request's JSON body against `schema`; throws `INVALID_REQUEST`. */
async function readBody<T>(
  c: Context<APIContext>,
  schema: (input: unknown) => T | type.errors,
): Promise<T> {
  let refused: BlogError | undefined
  let body: unknown
  try {
    body = await readJsonBody(c, {
      maxBytes: BLOG_BODY_MAX_BYTES,
      requireJsonContentType: true,
      toError: ({ status }) =>
        refused = invalid(
          status === 415
            ? JSON_BODY_WRONG_TYPE
            : status === 413
            ? `This post is too long to save.`
            : `Request body must be JSON`,
        ),
    })
  } catch (_error) {
    throw refused ?? invalid(`Request body must be JSON`)
  }
  const checked = schema(body)
  if (checked instanceof type.errors) throw invalid(checked.summary)
  return checked
}

/** The status a refusal answers with. */
function statusOf(error: BlogError): 400 | 404 | 409 {
  if (error.code === `POST_NOT_FOUND`) return 404
  if (error.code === `INVALID_REQUEST`) return 400
  return 409
}

/** The operator behind the request, for the audit row. */
function actorOf(c: Context<APIContext>): BlogActor {
  return { userId: c.get(`auth`)!.user.id, requestId: c.get(`requestId`) ?? null }
}

/**
 * The blog routes of the operator area (#395), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them, and every `POST` passed the
 * same-origin guard. Every change names the version the operator saw, and is refused with 409 and
 * the current version when the post moved on; each one writes an audit row on the operator.
 *
 * - `GET /blog/posts?status=&q=` lists posts, most recently changed first, with each status's count.
 * - `GET /blog/posts/:id` answers one post with everything the editor shows.
 * - `POST /blog/posts` creates a draft: `{ id, title, slug, description, seoTitle?, tldr?, topic?,
 *   coverUrl?, coverAlt?, bodyMd }` with a client-made UUID v7 id. 201.
 * - `POST /blog/posts/:id` saves every field: the same body without `id`, plus `version` and
 *   `significantUpdate?`.
 * - `POST /blog/posts/:id/publish` takes `{ version, at?, newsletterList? }`: now, or scheduled for
 *   `at`; with a list, the post is emailed to it once, when it goes live.
 * - `POST /blog/posts/:id/unschedule`, `/unpublish`, `/delete` take `{ version }`.
 * - `POST /blog/posts/:id/change-url` takes `{ version, slug }`.
 * - `GET /blog/topics` lists every topic in use, for the editor's topic field.
 * - `POST /blog/preview` takes `{ bodyMd }` and answers it rendered as the public page renders it.
 * - `GET /blog/newsletter` answers whether a post can be emailed, each list's confirmed
 *   subscribers, for the publish dialog, and the website's address for "View on website".
 *
 * A refusal answers `{ error, code }`, plus `field` when it is about one field and
 * `currentVersion` on a version conflict.
 */
export function createAdminBlogRoutes(
  { limit, blog, newsletterEnabled, siteUrl, now }: AdminBlogRouteDependencies,
): Hono<APIContext> {
  /** The post id in the path, or a refusal: an id that is no UUID is no post. */
  const idOf = (c: Context<APIContext>): string => {
    const id = c.req.param(`id`) ?? ``
    if (!isUuid(id)) throw new BlogError(`POST_NOT_FOUND`, `This post does not exist.`)
    return id.toLowerCase()
  }

  const route = new Hono<APIContext>()
  route.onError((error, c) => {
    if (error instanceof BlogVersionConflictError) {
      return errorResponse(c, `conflict`, {
        message: error.message,
        reason: error.code,
        details: { currentVersion: error.currentVersion },
      })
    }
    if (error instanceof BlogError) {
      const status = statusOf(error)
      return errorResponse(c, codeForStatus(status), {
        message: error.message,
        reason: error.code,
        status,
        fields: error.fields,
        ...(error.field && { details: { field: error.field } }),
      })
    }
    throw error
  })

  return route
    .get(`/blog/posts`, limit, async (c) => {
      const query = (c.req.query(`q`) ?? ``).trim().slice(0, BLOG_SEARCH_MAX_LENGTH)
      const status = parseBlogStatusFilter(c.req.query(`status`) ?? null)
      return c.json(await blog.list({ status, query }))
    })
    .get(`/blog/posts/:id`, limit, async (c) => {
      const post = await blog.get(idOf(c))
      if (!post) throw new BlogError(`POST_NOT_FOUND`, `This post does not exist.`)
      return c.json({ post })
    })
    .post(`/blog/posts`, limit, async (c) => {
      const { id, ...input } = await readBody(c, blogPostCreateSchema)
      const post = await blog.create(id, parseBlogPostFields(input), actorOf(c))
      return c.json({ post }, 201)
    })
    .post(`/blog/posts/:id`, limit, async (c) => {
      const id = idOf(c)
      const { version, significantUpdate = false, ...input } = await readBody(
        c,
        blogPostUpdateSchema,
      )
      const fields = parseBlogPostFields(input)
      return c.json({
        post: await blog.update(id, version, fields, significantUpdate, actorOf(c)),
      })
    })
    .post(`/blog/posts/:id/publish`, limit, async (c) => {
      const id = idOf(c)
      const body = await readBody(c, blogPublishSchema)
      const at = parsePublishTime(body.at, now())
      const list = body.newsletterList ?? null
      if (list !== null && (!newsletterEnabled || !isSubscriberList(list))) {
        throw new BlogError(`NEWSLETTER_OFF`, `This post cannot be emailed: the newsletter is off.`)
      }
      return c.json({ post: await blog.publish(id, body.version, at, list, actorOf(c)) })
    })
    .post(`/blog/posts/:id/unschedule`, limit, async (c) => {
      const id = idOf(c)
      const { version } = await readBody(c, blogVersionSchema)
      return c.json({ post: await blog.unschedule(id, version, actorOf(c)) })
    })
    .post(`/blog/posts/:id/unpublish`, limit, async (c) => {
      const id = idOf(c)
      const { version } = await readBody(c, blogVersionSchema)
      return c.json({ post: await blog.unpublish(id, version, actorOf(c)) })
    })
    .post(`/blog/posts/:id/change-url`, limit, async (c) => {
      const id = idOf(c)
      const body = await readBody(c, blogChangeUrlSchema)
      const slug = body.slug.trim()
      const problem = blogSlugProblem(slug)
      if (problem) throw new BlogError(`INVALID_REQUEST`, problem, `slug`)
      return c.json({ post: await blog.changeUrl(id, body.version, slug, actorOf(c)) })
    })
    .post(`/blog/posts/:id/delete`, limit, async (c) => {
      const id = idOf(c)
      const { version } = await readBody(c, blogVersionSchema)
      await blog.delete(id, version, actorOf(c))
      return c.json({ deleted: true })
    })
    .get(`/blog/topics`, limit, async (c) => c.json({ topics: await blog.topics() }))
    .post(`/blog/preview`, limit, async (c) => {
      const { bodyMd } = await readBody(c, blogPreviewSchema)
      const rendered: RenderedBlogBody = renderBlogBody(bodyMd)
      return c.json(rendered)
    })
    .get(`/blog/newsletter`, limit, async (c) => {
      const answer: BlogNewsletterResponse = {
        enabled: newsletterEnabled,
        lists: newsletterEnabled ? await blog.confirmedSubscribers() : [],
        siteUrl,
      }
      return c.json(answer)
    })
}

/** The service over the app's database. */
export function createAdminBlog(sql: postgres.Sql): AdminBlogService {
  const repository = new PostgresBlogRepository(sql)
  return {
    list: (filter) => repository.list(filter),
    get: (id) => repository.get(id),
    topics: () => repository.topics(),
    create: (id, fields, actor) => repository.create(id, fields, actor),
    update: (id, version, fields, significant, actor) =>
      repository.update(id, version, fields, significant, actor),
    publish: (id, version, at, list, actor) => repository.publish(id, version, at, list, actor),
    unschedule: (id, version, actor) => repository.unschedule(id, version, actor),
    unpublish: (id, version, actor) => repository.unpublish(id, version, actor),
    changeUrl: (id, version, slug, actor) => repository.changeUrl(id, version, slug, actor),
    delete: (id, version, actor) => repository.delete(id, version, actor),
    async confirmedSubscribers() {
      // A subscriber with no language counts as the main language's, as the issue's send does.
      const rows = await sql<{ list: string; language: Language; confirmed: number }[]>`
        SELECT list_id AS list, COALESCE(language, ${DEFAULT_LANGUAGE}) AS language,
          COUNT(*)::int AS confirmed
        FROM subscribers
        WHERE list_id IN ${sql([...SUBSCRIBER_LISTS])}
        GROUP BY 1, 2
      `
      return SUBSCRIBER_LISTS.map((list) => ({
        list,
        byLanguage: Object.fromEntries(
          rows.filter((row) => row.list === list).map((row) => [row.language, row.confirmed]),
        ),
      }))
    },
  }
}

/** Whether a post can be emailed with `setup`: subscriptions on and the website's address set. */
export function blogNewsletterEnabled(setup: SubscribersSetup | null): boolean {
  return typeof setup?.siteUrl === `string`
}

/** The blog module: posts, publishing and the newsletter send (#395). */
export const blogAdminModule: AdminApiModule = {
  id: `blog`,
  routes: ({ sql, subscribers, limit, now, siteUrl }) =>
    createAdminBlogRoutes({
      limit,
      now,
      blog: createAdminBlog(sql),
      newsletterEnabled: blogNewsletterEnabled(subscribers),
      siteUrl,
    }),
}
