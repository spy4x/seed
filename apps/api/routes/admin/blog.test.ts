import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { UserRole } from "@domain/identity"
import { BlogError, type BlogPost, BlogVersionConflictError } from "@domain/blog"
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
import { createAdminRoute } from "./+routes.ts"
import { ADMIN_API_MODULES } from "./registry.ts"
import { type AdminBlogService, blogNewsletterEnabled, createAdminBlogRoutes } from "./blog.ts"
import { apiError } from "../../_testing/api-error.ts"

const ID = `01a1658a-5fe7-7ab6-8e4a-0ad1c6ed703d`
const NOW = new Date(`2026-10-23T10:00:00.000Z`)

const post: BlogPost = {
  id: ID,
  slug: `hello-world`,
  title: `Hello`,
  seoTitle: null,
  description: `A post.`,
  tldr: [],
  topic: null,
  coverUrl: null,
  coverAlt: null,
  bodyMd: `Hi`,
  status: `draft`,
  publishAt: null,
  publishedAt: null,
  contentUpdatedAt: null,
  authorId: 7,
  authorName: `Maya Chen`,
  newsletterList: null,
  newsletterSentAt: null,
  newsletterRecipients: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  version: 1,
}

const FIELDS = {
  title: `Hello`,
  slug: `hello-world`,
  description: `A post.`,
  bodyMd: `Hi`,
}

/** The operator of every test, with the request id the test session gives. */
const ACTOR = { userId: 7, requestId: `req-test-1` }

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const operator = () => buildAuthData({ user: { id: 7, role: UserRole.OPERATOR } })

/**
 * The operator area with the blog module over a fake service that records every call; `fail`
 * makes every write throw it.
 */
function buildApp(
  auth: APIContext["Variables"]["auth"] = operator(),
  {
    newsletterEnabled = true,
    fail = null as Error | null,
    siteUrl = `https://www.example.com` as string | null,
  } = {},
) {
  const calls: unknown[][] = []
  const write = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args])
    return fail ? Promise.reject(fail) : Promise.resolve(post)
  }
  const blog: AdminBlogService = {
    list: (
      filter,
    ) => (calls.push([`list`, filter]),
      Promise.resolve({ posts: [], counts: { all: 0, draft: 0, scheduled: 0, published: 0 } })),
    get: (id) => (calls.push([`get`, id]), Promise.resolve(id === ID ? post : null)),
    topics: () => (calls.push([`topics`]), Promise.resolve([{ topic: `Product`, count: 2 }])),
    create: write(`create`),
    update: write(`update`),
    publish: write(`publish`),
    unschedule: write(`unschedule`),
    unpublish: write(`unpublish`),
    changeUrl: write(`changeUrl`),
    delete: (
      ...args
    ) => (calls.push([`delete`, ...args]), fail ? Promise.reject(fail) : Promise.resolve()),
    confirmedSubscribers:
      () => (calls.push([`confirmed`]), Promise.resolve([{ list: `news`, confirmed: 12 }])),
  }
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules: [
      createAdminBlogRoutes({
        limit: passThrough,
        blog,
        newsletterEnabled,
        siteUrl,
        now: () => NOW,
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

/** Every path of the blog module, each with a body it accepts. */
const ROUTES: { method: string; path: string; body?: unknown }[] = [
  { method: `GET`, path: `/posts` },
  { method: `GET`, path: `/posts/${ID}` },
  { method: `POST`, path: `/posts`, body: { id: ID, ...FIELDS } },
  { method: `POST`, path: `/posts/${ID}`, body: { ...FIELDS, version: 1 } },
  { method: `POST`, path: `/posts/${ID}/publish`, body: { version: 1 } },
  { method: `POST`, path: `/posts/${ID}/unschedule`, body: { version: 1 } },
  { method: `POST`, path: `/posts/${ID}/unpublish`, body: { version: 1 } },
  { method: `POST`, path: `/posts/${ID}/change-url`, body: { version: 1, slug: `new-address` } },
  { method: `POST`, path: `/posts/${ID}/delete`, body: { version: 1 } },
  { method: `GET`, path: `/topics` },
  { method: `POST`, path: `/preview`, body: { bodyMd: `Hi` } },
  { method: `GET`, path: `/newsletter` },
]

describe(`operator area: blog routes`, () => {
  it(`is in the registry after the newsletter, so the API mounts it in the rail's order`, () => {
    const ids = ADMIN_API_MODULES.map((module) => module.id)
    expect(ids.indexOf(`blog`)).toBe(ids.indexOf(`newsletter`) + 1)
  })

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
    const response = await request(app, `POST`, `/posts/${ID}/delete`, { version: 1 }, {
      ...crossSiteHeaders,
    })

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it(`creates a draft with the trimmed fields and the operator as actor`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts`, {
      id: ID,
      ...FIELDS,
      title: `  Hello  `,
      seoTitle: ` `,
      tldr: [` One `, ``],
    })

    expect(response.status).toBe(201)
    expect(calls).toEqual([[`create`, ID, {
      ...FIELDS,
      seoTitle: null,
      tldr: [`One`],
      topic: null,
      coverUrl: null,
      coverAlt: null,
    }, ACTOR]])
  })

  it(`answers 400 naming the field for a cover that is not https, and saves nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${ID}`, {
      ...FIELDS,
      version: 1,
      coverUrl: `http://images.example.com/a.png`,
      coverAlt: `A chart`,
    })

    expect(response.status).toBe(400)
    expect(await apiError(response)).toMatchObject({
      reason: `INVALID_REQUEST`,
      details: { field: `coverUrl` },
    })
    expect(calls).toEqual([])
  })

  it(`answers 400 to a body with a field the post does not have`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${ID}`, {
      ...FIELDS,
      version: 1,
      status: `published`,
    })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it(`answers 409 with the current version when the post moved on`, async () => {
    const { app } = buildApp(operator(), { fail: new BlogVersionConflictError(4) })
    const response = await request(app, `POST`, `/posts/${ID}`, { ...FIELDS, version: 2 })

    expect(response.status).toBe(409)
    expect(await apiError(response)).toMatchObject({
      code: `conflict`,
      reason: `VERSION_CONFLICT`,
      details: { currentVersion: 4 },
    })
  })

  it(`answers 404 for a post that is gone and for an id that is no UUID`, async () => {
    const { app, calls } = buildApp(operator(), {
      fail: new BlogError(`POST_NOT_FOUND`, `gone`),
    })
    expect((await request(app, `POST`, `/posts/${ID}/unpublish`, { version: 1 })).status).toBe(404)
    expect((await request(app, `GET`, `/posts/not-a-uuid`)).status).toBe(404)
    expect((await request(app, `POST`, `/posts/x/delete`, { version: 1 })).status).toBe(404)
    expect(calls.map((call) => call[0])).toEqual([`unpublish`])
  })

  it(`publishes now when no time is given, with the chosen list`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${ID}/publish`, {
      version: 3,
      newsletterList: `news`,
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([[`publish`, ID, 3, null, `news`, ACTOR]])
  })

  it(`schedules for the time given, and refuses a time that has passed`, async () => {
    const { app, calls } = buildApp()
    const at = `2026-10-30T09:00:00.000Z`
    expect((await request(app, `POST`, `/posts/${ID}/publish`, { version: 1, at })).status).toBe(
      200,
    )
    const past = await request(app, `POST`, `/posts/${ID}/publish`, {
      version: 1,
      at: `2026-10-23T09:59:00.000Z`,
    })

    expect(past.status).toBe(400)
    expect(calls).toEqual([[`publish`, ID, 1, new Date(at), null, ACTOR]])
  })

  it(`refuses to email a post while the newsletter is off, and publishes nothing`, async () => {
    const { app, calls } = buildApp(operator(), { newsletterEnabled: false })
    const response = await request(app, `POST`, `/posts/${ID}/publish`, {
      version: 1,
      newsletterList: `news`,
    })

    expect(response.status).toBe(409)
    expect((await apiError(response)).reason).toBe(`NEWSLETTER_OFF`)
    expect(calls).toEqual([])
  })

  it(`refuses to email a post to a list the app does not have`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${ID}/publish`, {
      version: 1,
      newsletterList: `secret-list`,
    })

    expect(response.status).toBe(409)
    expect(calls).toEqual([])
  })

  it(`refuses a new address that is no slug, naming the field`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/posts/${ID}/change-url`, {
      version: 1,
      slug: `../admin`,
    })

    expect(response.status).toBe(400)
    expect((await apiError(response)).details).toEqual({ field: `slug` })
    expect(calls).toEqual([])
  })

  it(`answers the confirmed subscribers per list only while the newsletter is on, and the website's address always`, async () => {
    const on = buildApp()
    expect(await (await request(on.app, `GET`, `/newsletter`)).json()).toEqual({
      enabled: true,
      lists: [{ list: `news`, confirmed: 12 }],
      siteUrl: `https://www.example.com`,
    })
    const off = buildApp(operator(), { newsletterEnabled: false })
    expect(await (await request(off.app, `GET`, `/newsletter`)).json()).toEqual({
      enabled: false,
      lists: [],
      siteUrl: `https://www.example.com`,
    })
    const unset = buildApp(operator(), { siteUrl: null })
    expect((await (await request(unset.app, `GET`, `/newsletter`)).json()).siteUrl).toBe(null)
    expect(off.calls).toEqual([])
  })

  it(`renders a preview without letting the Markdown's HTML through`, async () => {
    const { app } = buildApp()
    const response = await request(app, `POST`, `/preview`, {
      bodyMd: `<script>alert(1)</script>`,
    })
    const { html } = await response.json()

    expect(html).not.toContain(`<script`)
  })

  it(`reads the status filter and a search cut to its longest`, async () => {
    const { app, calls } = buildApp()
    await request(app, `GET`, `/posts?status=scheduled&q=${`a`.repeat(150)}`)
    await request(app, `GET`, `/posts?status=everything`)

    expect(calls).toEqual([
      [`list`, { status: `scheduled`, query: `a`.repeat(100) }],
      [`list`, { status: null, query: `` }],
    ])
  })
})

describe(`blogNewsletterEnabled`, () => {
  it(`needs both mail subscriptions and the public website's address`, () => {
    expect(blogNewsletterEnabled(null)).toBe(false)
    expect(blogNewsletterEnabled({ secret: `s`, previousSecrets: [] })).toBe(false)
    expect(
      blogNewsletterEnabled({ secret: `s`, previousSecrets: [], siteUrl: `https://example.com` }),
    ).toBe(true)
  })
})
