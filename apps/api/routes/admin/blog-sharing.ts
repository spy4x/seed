import { type Context, Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { JSON_BODY_WRONG_TYPE, readJsonBody } from "@spy4x/server/http/bounded-body"
import {
  type AdminBlogChannelsResponse,
  type AdminBlogShareRow,
  type AdminBlogSharingResponse,
  type AdminBlogVisits,
  type BlogChannel,
  blogChannelCreateSchema,
  type BlogChannelFields,
  blogChannelUpdateSchema,
  BlogChannelVersionConflictError,
  blogChannelVersionSchema,
  blogPostPath,
  type BlogShareResult,
  type BlogShareResultsRequest,
  blogShareResultsSchema,
  blogShareSetSchema,
  blogShareState,
  BlogSharingError,
  blogSubmitUrl,
  channelUtmSource,
  parseBlogChannelFields,
  parseBlogShareFields,
  withUtmSource,
} from "@domain/blog"
import {
  type PostSharing,
  type ShareChange,
  type SharingActor,
  type SharingGaps,
} from "@server/blog/postgres-sharing-repository.ts"
import { channelText } from "@server/blog/social-texts.ts"
import type { WebsitePathVisits } from "../../services/website-stats.ts"
import type { APIContext } from "../../_types.ts"
import { codeForStatus, errorResponse } from "../../services/error-response.ts"

/** The largest body a sharing route takes: a channel's few fields, or a hundred channel ids. */
export const SHARING_BODY_MAX_BYTES = 16 * 1024

/** What the sharing routes call. Who may call it is the route's business. */
export interface AdminSharingService {
  channels(): Promise<AdminBlogChannelsResponse>
  gaps(): Promise<SharingGaps>
  postSharing(postId: string): Promise<PostSharing | null>
  createChannel(id: string, fields: BlogChannelFields, actor: SharingActor): Promise<BlogChannel>
  updateChannel(
    id: string,
    version: number,
    fields: BlogChannelFields,
    actor: SharingActor,
  ): Promise<BlogChannel>
  archiveChannel(
    id: string,
    version: number,
    archived: boolean,
    actor: SharingActor,
  ): Promise<BlogChannel>
  deleteChannel(id: string, version: number, actor: SharingActor): Promise<void>
  setShares(
    postId: string,
    channelIds: readonly string[],
    change: ShareChange,
    actor: SharingActor,
  ): Promise<void>
  enterResults(
    postId: string,
    channelId: string,
    counts: BlogShareResultsRequest,
    actor: SharingActor,
  ): Promise<BlogShareResult>
}

/** What the sharing routes need. */
export interface AdminSharingRouteDependencies {
  limit: MiddlewareHandler<APIContext>
  sharing: AdminSharingService
  /** The public website's address (`MPA_DOMAIN`), for the links and texts; `null` unset. */
  siteUrl: string | null
  /** Umami's visits to one page by `utm_source`. */
  pathVisits(path: string, since: number): Promise<WebsitePathVisits>
}

function invalid(message: string): BlogSharingError {
  return new BlogSharingError(`INVALID_REQUEST`, message)
}

async function readBody<T>(
  c: Context<APIContext>,
  schema: (input: unknown) => T | type.errors,
): Promise<T> {
  let refused: BlogSharingError | undefined
  let body: unknown
  try {
    body = await readJsonBody(c, {
      maxBytes: SHARING_BODY_MAX_BYTES,
      requireJsonContentType: true,
      toError: ({ status }) =>
        refused = invalid(status === 415 ? JSON_BODY_WRONG_TYPE : `Request body must be JSON`),
    })
  } catch (_error) {
    throw refused ?? invalid(`Request body must be JSON`)
  }
  const checked = schema(body)
  if (checked instanceof type.errors) throw invalid(checked.summary)
  return checked
}

function statusOf(error: BlogSharingError): 400 | 404 | 409 {
  const missing = [`CHANNEL_NOT_FOUND`, `POST_NOT_FOUND`, `SHARE_NOT_FOUND`]
  if (missing.includes(error.code)) return 404
  if (error.code === `INVALID_REQUEST`) return 400
  return 409
}

function actorOf(c: Context<APIContext>): SharingActor {
  return { userId: c.get(`auth`)!.user.id, requestId: c.get(`requestId`) ?? null }
}

/** The id in path parameter `name`, or a refusal with `code`: an id that is no UUID is no row. */
function idOf(
  c: Context<APIContext>,
  name: string,
  code: `CHANNEL_NOT_FOUND` | `POST_NOT_FOUND`,
): string {
  const id = c.req.param(name) ?? ``
  if (!isUuid(id)) {
    throw new BlogSharingError(
      code,
      code === `POST_NOT_FOUND` ? `This post does not exist.` : `This channel does not exist.`,
    )
  }
  return id.toLowerCase()
}

/**
 * A post's checklist: every channel that lists it, and every channel it already has a row on,
 * with the texts and tagged links to paste, the latest numbers and Umami's visits per channel.
 */
export function sharingRows(
  read: PostSharing,
  siteUrl: string | null,
  visits: WebsitePathVisits,
): { rows: AdminBlogShareRow[]; visits: AdminBlogVisits } {
  const { post } = read
  const address = `${siteUrl ?? ``}${blogPostPath(post)}`
  const bySource = visits.state === `ready` ? visits.bySource : null
  const rows: AdminBlogShareRow[] = []
  for (const channel of read.channels) {
    const share = read.own.get(channel.id) ?? null
    const state = blogShareState(channel, post, share, read.original.get(channel.id))
    // A row on an archived or no longer fitting channel still shows what happened there.
    if (state === null && (share === null || share.status === `todo`)) continue
    const shown = state ?? share!.status
    const source = channelUtmSource(channel)
    const link = siteUrl === null ? address : withUtmSource(address, source)
    rows.push({
      channel,
      share,
      state: shown,
      text: siteUrl === null ? null : channelText(channel.kind, post, siteUrl, source),
      link,
      submitUrl: siteUrl === null ? null : blogSubmitUrl(channel, post.title, link),
      result: share ? read.results.get(share.id) ?? null : null,
      visits: bySource === null || source === null ? null : bySource[source] ?? 0,
    })
  }
  return {
    rows,
    visits: {
      setup: visits.state !== `off`,
      missing: visits.state === `off` ? visits.missing : [],
      readAt: visits.state === `ready` ? visits.readAt : null,
      stale: visits.state === `failed` || (visits.state === `ready` && visits.stale),
    },
  }
}

/**
 * The sharing routes of the operator area, mounted at `/api/admin` with the blog's, behind the
 * gate in `+routes.ts`. Channel writes name the version the operator saw; every write leaves an
 * audit row on the operator.
 *
 * - `GET /blog/channels` lists every channel with its counts, and the live posts' languages and
 *   times for the form's "It will show as to do on {count} live posts".
 * - `POST /blog/channels` adds one: `{ id, name, kind, address, utmSource, addUtm, languages,
 *   startsAt }` with a client-made UUID v7 id. 201.
 * - `POST /blog/channels/:id` saves every field, plus `version`.
 * - `POST /blog/channels/:id/archive`, `/restore` and `/delete` take `{ version }`. A channel with
 *   shares is refused deletion with 409 `HAS_SHARES`.
 * - `GET /blog/posts/:id/sharing` answers the post's checklist.
 * - `POST /blog/posts/:id/shares` sets `{ channelIds, status, url?, skipReason?, sharedAt? }`.
 * - `POST /blog/posts/:id/shares/:channelId/results` records `{ views, reactions, comments, score }`
 *   typed by hand.
 */
export function createAdminSharingRoutes(
  { limit, sharing, siteUrl, pathVisits }: AdminSharingRouteDependencies,
): Hono<APIContext> {
  const route = new Hono<APIContext>()
  route.onError((error, c) => {
    if (error instanceof BlogChannelVersionConflictError) {
      return errorResponse(c, `conflict`, {
        message: error.message,
        reason: error.code,
        details: { currentVersion: error.currentVersion },
      })
    }
    if (error instanceof BlogSharingError) {
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

  const archive = (archived: boolean) => async (c: Context<APIContext>) => {
    const id = idOf(c, `id`, `CHANNEL_NOT_FOUND`)
    const { version } = await readBody(c, blogChannelVersionSchema)
    return c.json({ channel: await sharing.archiveChannel(id, version, archived, actorOf(c)) })
  }

  return route
    .get(`/blog/channels`, limit, async (c) => c.json(await sharing.channels()))
    .post(`/blog/channels`, limit, async (c) => {
      const { id, ...input } = await readBody(c, blogChannelCreateSchema)
      const channel = await sharing.createChannel(id, parseBlogChannelFields(input), actorOf(c))
      return c.json({ channel }, 201)
    })
    .post(`/blog/channels/:id`, limit, async (c) => {
      const id = idOf(c, `id`, `CHANNEL_NOT_FOUND`)
      const { version, ...input } = await readBody(c, blogChannelUpdateSchema)
      const fields = parseBlogChannelFields(input)
      return c.json({ channel: await sharing.updateChannel(id, version, fields, actorOf(c)) })
    })
    .post(`/blog/channels/:id/archive`, limit, archive(true))
    .post(`/blog/channels/:id/restore`, limit, archive(false))
    .post(`/blog/channels/:id/delete`, limit, async (c) => {
      const id = idOf(c, `id`, `CHANNEL_NOT_FOUND`)
      const { version } = await readBody(c, blogChannelVersionSchema)
      await sharing.deleteChannel(id, version, actorOf(c))
      return c.json({ deleted: true })
    })
    .get(`/blog/posts/:id/sharing`, limit, async (c) => {
      const read = await sharing.postSharing(idOf(c, `id`, `POST_NOT_FOUND`))
      if (!read) throw new BlogSharingError(`POST_NOT_FOUND`, `This post does not exist.`)
      const live = read.post.status === `published` && read.post.publishedAt !== null
      const visits: WebsitePathVisits = live
        ? await pathVisits(blogPostPath(read.post), Date.parse(read.post.publishedAt!))
        : { state: `failed` }
      const { rows, visits: summary } = sharingRows(read, siteUrl, visits)
      const answer: AdminBlogSharingResponse = {
        post: {
          id: read.post.id,
          title: read.post.title,
          language: read.post.language,
          status: read.post.status,
          translationOf: read.post.translationOf,
          publishedAt: read.post.publishedAt,
        },
        hasChannels: read.channels.length > 0,
        rows: live ? rows : [],
        visits: summary,
      }
      return c.json(answer)
    })
    .post(`/blog/posts/:id/shares`, limit, async (c) => {
      const postId = idOf(c, `id`, `POST_NOT_FOUND`)
      const body = await readBody(c, blogShareSetSchema)
      const fields = parseBlogShareFields(body)
      let sharedAt: string | null = null
      if (body.sharedAt != null) {
        const at = Date.parse(body.sharedAt)
        if (Number.isNaN(at)) throw invalid(`sharedAt is no date.`)
        sharedAt = new Date(at).toISOString()
      }
      const restore = body.automatic === undefined
        ? null
        : { automatic: body.automatic, error: body.error ?? null }
      const change: ShareChange = { status: body.status, ...fields, sharedAt, restore }
      await sharing.setShares(
        postId,
        body.channelIds.map((id) => id.toLowerCase()),
        change,
        actorOf(c),
      )
      return c.json({ saved: true })
    })
    .post(`/blog/posts/:id/shares/:channelId/results`, limit, async (c) => {
      const postId = idOf(c, `id`, `POST_NOT_FOUND`)
      const channelId = idOf(c, `channelId`, `CHANNEL_NOT_FOUND`)
      const counts = await readBody(c, blogShareResultsSchema)
      if (Object.values(counts).every((value) => value === null)) {
        throw invalid(`Enter at least one number.`)
      }
      const result = await sharing.enterResults(postId, channelId, counts, actorOf(c))
      return c.json({ result }, 201)
    })
}
