import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { UserRole } from "@domain/identity"
import {
  type AdminBlogListResponse,
  type BlogChannel,
  BlogChannelVersionConflictError,
  type BlogShare,
  BlogSharingError,
} from "@domain/blog"
import type { PostSharing } from "@server/blog/postgres-sharing-repository.ts"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { apiError } from "../../_testing/api-error.ts"
import type { WebsitePathVisits } from "../../services/website-stats.ts"
import { createAdminRoute } from "./+routes.ts"
import { type AdminSharingService, createAdminSharingRoutes, sharingRows } from "./blog-sharing.ts"
import { type AdminBlogService, createAdminBlogRoutes } from "./blog.ts"

const POST_ID = `01a1658a-5fe7-7ab6-8e4a-0ad1c6ed7100`
const ORIGINAL_ID = `01a1658a-5fe7-7ab6-8e4a-0ad1c6ed7101`
const REDDIT_ID = `01a1658a-5fe7-7ab6-8e4a-0ad1c6ed7200`
const TELEGRAM_ID = `01a1658a-5fe7-7ab6-8e4a-0ad1c6ed7201`
const OLD_ID = `01a1658a-5fe7-7ab6-8e4a-0ad1c6ed7202`
const SITE = `https://seedsaas.com`
const NOW = `2026-11-01T10:00:00.000Z`

const ACTOR = { userId: 7, requestId: `req-test-1` }

function channel(id: string, fields: Partial<BlogChannel> = {}): BlogChannel {
  return {
    id,
    name: `r/selfhosted`,
    kind: `reddit`,
    address: `r/selfhosted`,
    utmSource: `r-selfhosted`,
    addUtm: true,
    autoPost: false,
    languages: [`en`, `ru`],
    startsAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...fields,
  }
}

function share(channelId: string, fields: Partial<BlogShare> = {}): BlogShare {
  return {
    id: `share-${channelId}`,
    postId: POST_ID,
    channelId,
    status: `posted`,
    url: `https://reddit.com/r/selfhosted/1`,
    sharedAt: NOW,
    skipReason: null,
    automatic: false,
    error: null,
    readError: null,
    readFailedAt: null,
    updatedAt: NOW,
    ...fields,
  }
}

const REDDIT = channel(REDDIT_ID)
const TELEGRAM = channel(TELEGRAM_ID, {
  name: `Seed news`,
  kind: `telegram`,
  address: `https://t.me/seednews`,
  utmSource: `telegram`,
  addUtm: false,
})

/** A live English post on two channels, with nothing done yet. */
function sharing(fields: Partial<PostSharing> = {}): PostSharing {
  return {
    post: {
      id: POST_ID,
      title: `Hello & bye`,
      slug: `hello`,
      description: `A post.`,
      intro: null,
      tldr: [],
      language: `en`,
      translationOf: null,
      status: `published`,
      publishedAt: NOW,
    },
    channels: [REDDIT, TELEGRAM],
    own: new Map(),
    original: new Map(),
    results: new Map(),
    posting: new Set(),
    ...fields,
  }
}

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const operator = () => buildAuthData({ user: { id: 7, role: UserRole.OPERATOR } })

/**
 * The operator area with the sharing routes over a fake service that records every call; `fail`
 * makes every write throw it.
 */
function buildApp(
  auth: APIContext["Variables"]["auth"] = operator(),
  {
    fail = null as Error | null,
    read = sharing() as PostSharing | null,
    visits = { state: `off`, missing: [`UMAMI_URL`] } as WebsitePathVisits,
    linkedinExpiresAt = null as string | null,
  } = {},
) {
  const calls: unknown[][] = []
  const write = <T>(name: string, answer: T) => (...args: unknown[]) => {
    calls.push([name, ...args])
    return fail ? Promise.reject(fail) : Promise.resolve(answer)
  }
  const service: AdminSharingService = {
    channels: () => (calls.push([`channels`]), Promise.resolve({ channels: [], livePosts: [] })),
    gaps: () => Promise.resolve({ activeChannels: 0, toDo: {} }),
    postSharing: (id) => (calls.push([`postSharing`, id]), Promise.resolve(read)),
    createChannel: write(`createChannel`, REDDIT),
    updateChannel: write(`updateChannel`, REDDIT),
    archiveChannel: write(`archiveChannel`, REDDIT),
    deleteChannel: write(`deleteChannel`, undefined),
    setShares: write(`setShares`, undefined),
    retryShare: write(`retryShare`, undefined),
    enterResults: write(`enterResults`, {
      readAt: NOW,
      source: `hand` as const,
      views: 3,
      reactions: null,
      comments: null,
      score: null,
    }),
  }
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules: [
      createAdminSharingRoutes({
        limit: passThrough,
        sharing: service,
        siteUrl: SITE,
        linkedinExpiresAt,
        pathVisits: (
          path,
          since,
        ) => (calls.push([`pathVisits`, path, since]), Promise.resolve(visits)),
      }),
    ],
  })
  return { app: mountRoute(`/admin`, route, auth), calls }
}

function request(
  app: ReturnType<typeof buildApp>[`app`],
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}/admin/blog${path}`, {
    method,
    headers: { ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const FIELDS = {
  name: `r/selfhosted`,
  kind: `reddit`,
  address: `r/selfhosted`,
  utmSource: `r-selfhosted`,
  addUtm: true,
  languages: [`en`],
  startsAt: null,
}

/** Every sharing path, each with a body it accepts. */
const ROUTES: { method: string; path: string; body?: unknown }[] = [
  { method: `GET`, path: `/channels` },
  { method: `POST`, path: `/channels`, body: { id: REDDIT_ID, ...FIELDS } },
  { method: `POST`, path: `/channels/${REDDIT_ID}`, body: { ...FIELDS, version: 1 } },
  { method: `POST`, path: `/channels/${REDDIT_ID}/archive`, body: { version: 1 } },
  { method: `POST`, path: `/channels/${REDDIT_ID}/restore`, body: { version: 1 } },
  { method: `POST`, path: `/channels/${REDDIT_ID}/delete`, body: { version: 1 } },
  { method: `GET`, path: `/posts/${POST_ID}/sharing` },
  {
    method: `POST`,
    path: `/posts/${POST_ID}/shares`,
    body: { channelIds: [REDDIT_ID], status: `skipped`, skipReason: `Not a fit` },
  },
  {
    method: `POST`,
    path: `/posts/${POST_ID}/shares/${REDDIT_ID}/results`,
    body: { views: 3, reactions: null, comments: null, score: null },
  },
  { method: `POST`, path: `/posts/${POST_ID}/shares/${TELEGRAM_ID}/retry`, body: {} },
]

describe(`operator area: sharing routes`, () => {
  for (const route of ROUTES) {
    it(`answers 404 to a viewer on ${route.method} ${route.path} and calls nothing`, async () => {
      const viewer = buildAuthData({ user: { id: 7, role: UserRole.VIEWER } })
      const { app, calls } = buildApp(viewer)
      const response = await request(app, route.method, route.path, route.body)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
    })

    it(`answers an operator on ${route.method} ${route.path}`, async () => {
      const { app } = buildApp()
      const response = await request(app, route.method, route.path, route.body)

      expect(response.status).toBeLessThan(300)
    })
  }

  it(`refuses an operator's cross-site write with 403 and calls nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/channels/${REDDIT_ID}/delete`, { version: 1 }, {
      ...crossSiteHeaders,
    })

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it(`adds a channel with its trimmed fields and the operator as actor`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/channels`, {
      id: REDDIT_ID,
      ...FIELDS,
      name: `  r/selfhosted  `,
    })

    expect(response.status).toBe(201)
    expect(calls).toEqual([[
      `createChannel`,
      REDDIT_ID,
      { ...FIELDS, name: `r/selfhosted`, autoPost: false },
      ACTOR,
    ]])
  })

  it(`refuses a channel with no name as a field error and calls nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/channels`, { id: REDDIT_ID, ...FIELDS, name: `` })

    expect(response.status).toBe(400)
    const error = await apiError(response)
    expect(error.fields?.name?.code).toBe(`channelName`)
    expect(calls).toEqual([])
  })

  it(`refuses a body with a field it does not know`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/channels/${REDDIT_ID}/archive`, {
      version: 1,
      extra: true,
    })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it(`answers 404 to an id that is no UUID and calls nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `GET`, `/posts/not-a-uuid/sharing`)

    expect(response.status).toBe(404)
    expect((await apiError(response)).reason).toBe(`POST_NOT_FOUND`)
    expect(calls).toEqual([])
  })

  it(`answers the service's refusals with their status and reason`, async () => {
    const cases: [BlogSharingError, number, string][] = [
      [new BlogSharingError(`HAS_SHARES`, `It has shares.`), 409, `HAS_SHARES`],
      [new BlogSharingError(`CHANNEL_NOT_FOUND`, `Gone.`), 404, `CHANNEL_NOT_FOUND`],
      [new BlogSharingError(`NOT_PUBLISHED`, `Not live.`), 409, `NOT_PUBLISHED`],
      [new BlogChannelVersionConflictError(4), 409, `VERSION_CONFLICT`],
    ]
    for (const [fail, status, reason] of cases) {
      const { app } = buildApp(operator(), { fail })
      const response = await request(app, `POST`, `/channels/${REDDIT_ID}/delete`, { version: 1 })

      expect(response.status).toBe(status)
      expect((await apiError(response)).reason).toBe(reason)
    }
  })

  it(`turns Post automatically on for a new automatic channel unless the body turns it off`, async () => {
    const telegram = { ...FIELDS, kind: `telegram`, address: `https://t.me/seednews` }
    const { app, calls } = buildApp()
    await request(app, `POST`, `/channels`, { id: TELEGRAM_ID, ...telegram })
    await request(app, `POST`, `/channels`, { id: OLD_ID, ...telegram, autoPost: false })
    await request(app, `POST`, `/channels`, { id: REDDIT_ID, ...FIELDS, autoPost: true })

    expect(calls.map((call) => (call[2] as { autoPost: boolean }).autoPost)).toEqual([
      true,
      false,
      false,
    ])
  })

  it(`queues another automatic try with the post, the channel and the operator as actor`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${POST_ID}/shares/${TELEGRAM_ID}/retry`, {})

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ queued: true })
    expect(calls).toEqual([[`retryShare`, POST_ID, TELEGRAM_ID, ACTOR]])
  })

  it(`refuses a try on a channel that does not post by itself with 409`, async () => {
    const fail = new BlogSharingError(`NOT_AUTOMATIC`, `Not automatic.`)
    const { app } = buildApp(operator(), { fail })
    const response = await request(app, `POST`, `/posts/${POST_ID}/shares/${REDDIT_ID}/retry`, {})

    expect(response.status).toBe(409)
    expect((await apiError(response)).reason).toBe(`NOT_AUTOMATIC`)
  })

  it(`refuses a cross-site try with 403 and queues nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await request(
      app,
      `POST`,
      `/posts/${POST_ID}/shares/${TELEGRAM_ID}/retry`,
      {},
      { ...crossSiteHeaders },
    )

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it(`sends the LinkedIn sign-in's expiry date and nothing else of it`, async () => {
    const expiry = `2027-01-01T00:00:00.000Z`
    const { app } = buildApp(operator(), { linkedinExpiresAt: expiry })
    const list = await (await request(app, `GET`, `/channels`)).json()
    const page = await (await request(app, `GET`, `/posts/${POST_ID}/sharing`)).json()

    expect(list.linkedinExpiresAt).toBe(expiry)
    expect(page.linkedinExpiresAt).toBe(expiry)
    expect(JSON.stringify([list, page])).not.toMatch(/token|LINKEDIN_/i)
  })

  it(`answers a version conflict with the current version`, async () => {
    const { app } = buildApp(operator(), { fail: new BlogChannelVersionConflictError(4) })
    const response = await request(app, `POST`, `/channels/${REDDIT_ID}/archive`, { version: 1 })

    expect((await apiError(response)).details).toEqual({ currentVersion: 4 })
  })

  it(`sets a skip on every channel named, with its trimmed reason`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${POST_ID}/shares`, {
      channelIds: [REDDIT_ID, TELEGRAM_ID],
      status: `skipped`,
      skipReason: ` Not a fit `,
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([[
      `setShares`,
      POST_ID,
      [REDDIT_ID, TELEGRAM_ID],
      { status: `skipped`, url: null, skipReason: `Not a fit`, sharedAt: null, restore: null },
      ACTOR,
    ]])
  })

  it(`passes Undo's date, automatic flag and error through to the row`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${POST_ID}/shares`, {
      channelIds: [REDDIT_ID],
      status: `posted`,
      url: `https://dev.to/seed/1`,
      sharedAt: `2026-11-02T09:30:00.000Z`,
      automatic: true,
      error: `Dev.to answered 503`,
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([[
      `setShares`,
      POST_ID,
      [REDDIT_ID],
      {
        status: `posted`,
        url: `https://dev.to/seed/1`,
        skipReason: null,
        sharedAt: `2026-11-02T09:30:00.000Z`,
        restore: { automatic: true, error: `Dev.to answered 503` },
      },
      ACTOR,
    ]])
  })

  it(`refuses a posted link that is not https as a field error`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${POST_ID}/shares`, {
      channelIds: [REDDIT_ID],
      status: `posted`,
      url: `http://reddit.com/1`,
    })

    expect(response.status).toBe(400)
    expect((await apiError(response)).fields?.url?.code).toBe(`channelHttps`)
    expect(calls).toEqual([])
  })

  it(`refuses results with no number in them`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${POST_ID}/shares/${REDDIT_ID}/results`, {
      views: null,
      reactions: null,
      comments: null,
      score: null,
    })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it(`refuses a count above the database's integer limit and calls nothing`, async () => {
    const { app, calls } = buildApp()
    const path = `/posts/${POST_ID}/shares/${REDDIT_ID}/results`
    const at = { views: null, reactions: null, comments: null, score: 2147483647 }
    expect((await request(app, `POST`, path, at)).status).toBe(201)
    const above = await request(app, `POST`, path, { ...at, score: 2147483648 })

    expect(above.status).toBe(400)
    expect(calls).toHaveLength(1)
  })

  it(`answers a live post's checklist and reads its visits from the time it went live`, async () => {
    const { app, calls } = buildApp(operator(), {
      visits: { state: `ready`, bySource: { "r-selfhosted": 12 }, readAt: NOW, stale: false },
    })
    const response = await request(app, `GET`, `/posts/${POST_ID}/sharing`)
    const body = await response.json()

    expect(calls).toContainEqual([`pathVisits`, `/blog/hello`, Date.parse(NOW)])
    expect(body.rows.map((row: { visits: number | null }) => row.visits)).toEqual([12, null])
    expect(body.visits).toEqual({ setup: true, missing: [], readAt: NOW, stale: false })
  })

  it(`answers a draft's sharing page with no rows and without asking Umami`, async () => {
    const draft = sharing()
    draft.post = { ...draft.post, status: `draft`, publishedAt: null }
    const { app, calls } = buildApp(operator(), { read: draft })
    const body = await (await request(app, `GET`, `/posts/${POST_ID}/sharing`)).json()

    expect(body.rows).toEqual([])
    expect(body.hasChannels).toBe(true)
    expect(calls.some(([name]) => name === `pathVisits`)).toBe(false)
  })

  it(`answers 404 for a post that does not exist`, async () => {
    const { app } = buildApp(operator(), { read: null })
    const response = await request(app, `GET`, `/posts/${POST_ID}/sharing`)

    expect(response.status).toBe(404)
  })
})

describe(`sharingRows`, () => {
  const OFF: WebsitePathVisits = { state: `off`, missing: [`UMAMI_URL`] }

  it(`tags the link with the channel's source only when the channel adds it`, () => {
    const { rows } = sharingRows(sharing(), SITE, OFF)

    expect(rows.map((row) => row.link)).toEqual([
      `${SITE}/blog/hello?utm_source=r-selfhosted`,
      `${SITE}/blog/hello`,
    ])
    expect(rows[0].submitUrl).toContain(`reddit.com/r/selfhosted/submit`)
    expect(rows[1].text).toContain(`${SITE}/blog/hello`)
  })

  it(`marks only the row whose automatic post waits for a job as posting`, () => {
    const read = sharing({ posting: new Set([TELEGRAM_ID]) })

    expect(sharingRows(read, SITE, OFF).rows.map((row) => row.posting)).toEqual([false, true])
  })

  it(`marks a translation covered by its original's post`, () => {
    const read = sharing({ original: new Map([[REDDIT_ID, share(REDDIT_ID)]]) })
    read.post = { ...read.post, language: `ru`, translationOf: ORIGINAL_ID }

    expect(sharingRows(read, SITE, OFF).rows.map((row) => row.state)).toEqual([`covered`, `todo`])
  })

  it(`keeps a handled row on an archived channel, and drops one with nothing done`, () => {
    const old = channel(OLD_ID, { utmSource: `old`, archivedAt: NOW })
    const posted = sharing({
      channels: [old],
      own: new Map([[OLD_ID, share(OLD_ID)]]),
    })
    const toDo = sharing({
      channels: [old],
      own: new Map([[OLD_ID, share(OLD_ID, { status: `todo` })]]),
    })

    expect(sharingRows(posted, SITE, OFF).rows.map((row) => row.state)).toEqual([`posted`])
    expect(sharingRows(toDo, SITE, OFF).rows).toEqual([])
  })

  it(`says Umami is not set up, and names what is missing`, () => {
    expect(sharingRows(sharing(), SITE, OFF).visits)
      .toEqual({ setup: false, missing: [`UMAMI_URL`], readAt: null, stale: false })
    expect(sharingRows(sharing(), SITE, { state: `failed` }).visits.stale).toBe(true)
  })
})

describe(`operator area: the blog list's sharing summary`, () => {
  const POSTS = [{ id: POST_ID }, { id: ORIGINAL_ID }]

  function listApp() {
    const blog = {
      list: () => Promise.resolve({ posts: POSTS, counts: { all: 2 } }),
    } as unknown as AdminBlogService
    const route = createAdminRoute({
      auth: testSessionGuards(),
      mutationGuards: testMutationGuards,
      modules: [
        createAdminBlogRoutes({
          limit: passThrough,
          blog,
          newsletterEnabled: false,
          siteUrl: SITE,
          now: () => new Date(NOW),
          sharingGaps: () => Promise.resolve({ activeChannels: 3, toDo: { [POST_ID]: 2 } }),
        }),
      ],
    })
    return mountRoute(`/admin`, route, operator())
  }

  it(`answers each post's to-dos with the list`, async () => {
    const body: AdminBlogListResponse = await (await request(listApp(), `GET`, `/posts`)).json()

    expect(body.posts.length).toBe(2)
    expect(body.sharing).toEqual({
      activeChannels: 3,
      needsSharing: 1,
      toDo: { [POST_ID]: 2 },
    })
  })

  it(`keeps only the posts with something to share on sharing=todo`, async () => {
    const response = await request(listApp(), `GET`, `/posts?sharing=todo`)
    const body: AdminBlogListResponse = await response.json()

    expect(body.posts.map((post) => post.id)).toEqual([POST_ID])
  })
})
