import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import type { BlogPost, BlogProblem, BlogRevision } from "@domain/blog"
import type { FigurePreview } from "./figure-preview.tsx"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { blogListHref } from "./module.tsx"
import { createBlogState } from "./state.ts"

const ok = <T>(data: T, status = 200) => ({ ok: true, status, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string, reason?: string) =>
  ({ ok: false, status, error: { status, message, ...(reason && { reason }) } }) as AdminApiResult<
    T
  >

const ID = `0195f0b4-3c1e-7a00-8000-0000000000aa`

const post: BlogPost = {
  id: ID,
  slug: `hello`,
  title: `Hello`,
  seoTitle: null,
  description: `A post.`,
  tldr: [],
  topic: null,
  coverUrl: null,
  coverAlt: null,
  coverFile: null,
  intro: null,
  relatedFeature: null,
  bodyMd: `Text.`,
  language: `en`,
  translationOf: null,
  status: `draft`,
  publishAt: null,
  publishedAt: null,
  contentUpdatedAt: null,
  authorId: 7,
  authorName: `Ann`,
  authorUrl: null,
  newsletterList: null,
  newsletterSentAt: null,
  newsletterRecipients: null,
  crosspostedAt: null,
  devtoUrl: null,
  createdAt: `2026-10-20T10:00:00.000Z`,
  updatedAt: `2026-10-20T10:00:00.000Z`,
  version: 1,
}

type Answer = (path: string, init?: RequestInit) => Promise<AdminApiResult<unknown>> | undefined

/** A `request` that answers from `answer` (or the post) and records each call and body. */
function fakeRequest(answer: Answer = () => undefined) {
  const calls: string[] = []
  const request = ((path: string, init?: RequestInit) => {
    const body = init?.body === undefined ? `` : ` ${init.body}`
    calls.push(`${init?.method ?? `GET`} ${path}${body}`)
    return answer(path, init) ?? Promise.resolve(ok({ post }))
  }) as AdminFetch
  return { request, calls }
}

/** The website's figures, faked: a body's figure problems are those its fake answer carries. */
const fakeFigures: FigurePreview = {
  check: (body) => ({
    preview: {
      parts: body.segments.filter((segment) => segment.kind === `html`),
      words: body.words,
      readingMinutes: body.readingMinutes,
    },
    problems: body.problems,
  }),
  example: `<CostCalculator />`,
}

/** The API's preview answer for `html`, with `problems`. */
const rendered = (html: string, problems: BlogProblem[] = []) =>
  ok({ segments: [{ kind: `html`, html }], headings: [], problems, words: 1, readingMinutes: 1 })

function build(answer?: Answer) {
  const { request, calls } = fakeRequest(answer)
  const toasts = createToastStore()
  const opened: string[] = []
  const state = createBlogState(request, toasts, () => ({ dateTime: () => `4 Mar 2031, 10:00` }), {
    newId: () => ID,
    now: () => new Date(`2026-10-23T10:00:00.000Z`),
    open: (url) => void opened.push(url),
    figures: () => Promise.resolve(fakeFigures),
  })
  return { state, calls, toasts, opened }
}

it(`moves the slug with the title on a new post, and keeps a slug the operator typed`, () => {
  const { state } = build()
  state.openNew()
  state.edit({ ...state.editor.value.value, title: `My first post` })
  expect(state.editor.value.value.slug).toBe(`my-first-post`)
  state.edit({ ...state.editor.value.value, slug: `custom` })
  state.edit({ ...state.editor.value.value, title: `Another` })
  expect(state.editor.value.value.slug).toBe(`custom`)
  expect(state.unsaved()).toBe(true)
})

it(`creates the post with its client id on the first save, then saves with the version read`, async () => {
  const { state, calls } = build()
  state.openNew()
  state.edit({ ...state.editor.value.value, title: `Hello`, description: `A post.` })
  expect(await state.save()).toEqual(post)
  expect(calls[0]).toBe(
    `POST /api/admin/blog/posts {"id":"${ID}","title":"Hello","slug":"hello","description":"A post.","seoTitle":"","tldr":[],"intro":"","topic":"","coverUrl":"","coverAlt":"","authorUrl":"","relatedFeature":"","bodyMd":"","language":"en","translationOf":null}`,
  )
  expect(state.editor.value.saveStatus).toBe(`saved`)
  state.edit({ ...state.editor.value.value, title: `Hello again` })
  await state.save()
  expect(calls[1]).toContain(`POST /api/admin/blog/posts/${ID} `)
  expect(calls[1]).toContain(`"version":1`)
  expect(calls[1]).not.toContain(`significantUpdate`)
})

it(`sends "Significant update" only with a published post`, async () => {
  const published = { ...post, status: `published` as const, publishedAt: post.createdAt }
  const { state, calls } = build((_path, init) =>
    init?.method === undefined ? Promise.resolve(ok({ post: published })) : undefined
  )
  await state.openPost(ID)
  state.setSignificantUpdate(true)
  state.edit({ ...state.editor.value.value, bodyMd: `Changed.` })
  await state.save()
  expect(calls.at(-1)).toContain(`"significantUpdate":true`)
})

it(`checks the fields before it sends anything`, async () => {
  const { state, calls } = build()
  state.openNew()
  expect(await state.save()).toBe(null)
  expect(calls).toEqual([])
  expect(state.editor.value.errors.title).toBe(`AdminBlogEditor.addTitle`)
})

it(`sends the author link as typed, and an emptied one to clear it (#730)`, async () => {
  const { state, calls } = build()
  await state.openPost(ID)
  state.edit({ ...state.editor.value.value, authorUrl: ` https://example.com/about ` })
  await state.save()
  expect(calls.at(-1)).toContain(`"authorUrl":" https://example.com/about "`)
  state.edit({ ...state.editor.value.value, authorUrl: `` })
  await state.save()
  expect(calls.at(-1)).toContain(`"authorUrl":""`)
})

it(`sends the intro and the related feature as typed (#733)`, async () => {
  const { state, calls } = build()
  await state.openPost(ID)
  state.edit({ ...state.editor.value.value, intro: `Two sentences. `, relatedFeature: `realtime` })
  await state.save()
  expect(calls.at(-1)).toContain(`"intro":"Two sentences. "`)
  expect(calls.at(-1)).toContain(`"relatedFeature":"realtime"`)
})

it(`refuses an author link that is not https before it sends anything (#730)`, async () => {
  const { state, calls } = build()
  await state.openPost(ID)
  const sent = calls.length
  state.edit({ ...state.editor.value.value, authorUrl: `http://example.com/about` })
  expect(await state.save()).toBe(null)
  expect(calls.length).toBe(sent)
  expect(state.editor.value.errors).toEqual({ authorUrl: `AdminBlogEditor.httpsCover` })
})

it(`marks a conflict on 409 and saves nothing more until reloaded`, async () => {
  const { state, calls } = build((_path, init) =>
    init?.method === `POST`
      ? Promise.resolve(fail(409, `Someone else changed this post.`, `VERSION_CONFLICT`))
      : undefined
  )
  await state.openPost(ID)
  state.edit({ ...state.editor.value.value, title: `Mine` })
  await state.save()
  expect(state.editor.value.conflict).toBe(true)
  const sent = calls.length
  expect(await state.save()).toBe(null)
  expect(calls.length).toBe(sent)
  await state.reload()
  expect(state.editor.value.conflict).toBe(false)
  expect(state.editor.value.value.title).toBe(`Hello`)
})

it(`says a save that never reached the server was not saved`, async () => {
  const { state } = build((_path, init) =>
    init?.method === `POST` ? Promise.resolve(fail(0, `Something went wrong.`)) : undefined
  )
  await state.openPost(ID)
  state.edit({ ...state.editor.value.value, title: `Mine` })
  await state.save()
  expect(state.editor.value.saveStatus).toBe(`failed`)
  expect(state.unsaved()).toBe(true)
})

it(`shows a taken slug on the slug field`, async () => {
  const { state } = build((_path, init) =>
    init?.method === `POST`
      ? Promise.resolve(fail(409, `This address is taken.`, `SLUG_TAKEN`))
      : undefined
  )
  await state.openPost(ID)
  state.edit({ ...state.editor.value.value, title: `Mine` })
  await state.save()
  expect(state.editor.value.errors).toEqual({ slug: `AdminBlogEditor.slugTaken` })
})

it(`saves unsaved changes before publishing, and always names the list, null for none`, async () => {
  const { state, calls, toasts } = build()
  await state.openPost(ID)
  state.edit({ ...state.editor.value.value, bodyMd: `New text.` })
  state.openDialog(`publish`)
  await state.publish({ at: null, list: null })
  expect(calls.slice(1)).toEqual([
    expect.stringContaining(`POST /api/admin/blog/posts/${ID} `),
    `POST /api/admin/blog/posts/${ID}/publish {"version":1,"newsletterList":null}`,
  ])
  expect(toasts.list.value.at(-1)?.body).toBe(`Published.`)
  expect(state.dialog.value.dialog).toBe(null)
})

it(`publishes with the chosen list and time, and says when it goes live`, async () => {
  const scheduled = {
    ...post,
    status: `scheduled` as const,
    publishAt: `2031-03-04T10:00:00.000Z`,
    newsletterList: `news`,
  }
  const { state, calls, toasts } = build((path) =>
    path.endsWith(`/publish`) ? Promise.resolve(ok({ post: scheduled })) : undefined
  )
  await state.openPost(ID)
  state.openDialog(`publish`)
  await state.publish({ at: scheduled.publishAt, list: `news` })
  expect(calls.at(-1)).toBe(
    `POST /api/admin/blog/posts/${ID}/publish {"version":1,"at":"2031-03-04T10:00:00.000Z","newsletterList":"news"}`,
  )
  expect(toasts.list.value.at(-1)?.body).toBe(`Scheduled for 4 Mar 2031, 10:00.`)
  expect(state.editor.value.post?.status).toBe(`scheduled`)
})

it(`opens no publish dialog for an empty post, and says why on the body`, async () => {
  const { state } = build((_path, init) =>
    init?.method === undefined ? Promise.resolve(ok({ post: { ...post, bodyMd: `` } })) : undefined
  )
  await state.openPost(ID)
  state.openDialog(`publish`)
  expect(state.dialog.value.dialog).toBe(null)
  expect(state.editor.value.errors).toEqual({ bodyMd: `AdminBlogEditor.emptyPost` })
})

it(`keeps a refused action's dialog open with the reason`, async () => {
  const { state } = build((path) =>
    path.endsWith(`/unpublish`)
      ? Promise.resolve(fail(409, `This post is not published.`, `NOT_PUBLISHED`))
      : undefined
  )
  await state.openPost(ID)
  state.openDialog(`unpublish`)
  await state.unpublish()
  expect(state.dialog.value).toEqual({
    dialog: `unpublish`,
    pending: false,
    error: `This post is not published.`,
  })
})

it(`deletes with the version read, says so, and lets the page leave without asking`, async () => {
  const { state, calls, toasts } = build((path) =>
    path.endsWith(`/delete`) ? Promise.resolve(ok({ deleted: true })) : undefined
  )
  await state.openPost(ID)
  state.openDialog(`delete`)
  expect(await state.remove()).toBe(true)
  expect(calls.at(-1)).toBe(`POST /api/admin/blog/posts/${ID}/delete {"version":1}`)
  expect(toasts.list.value.at(-1)?.body).toBe(`Post deleted.`)
  expect(state.unsaved()).toBe(false)
})

it(`answers a missing post as not found`, async () => {
  const { state } = build(() => Promise.resolve(fail(404, `This post does not exist.`)))
  await state.openPost(ID)
  expect(state.editor.value.notFound).toBe(true)
  expect(state.unsaved()).toBe(false)
})

it(`renders the preview once per text`, async () => {
  const { state, calls } = build((path) =>
    path.endsWith(`/preview`) ? Promise.resolve(rendered(`<p>Text.</p>`)) : undefined
  )
  await state.openPost(ID)
  await state.renderPreview()
  await state.renderPreview()
  expect(calls.filter((call) => call.includes(`/preview`))).toEqual([
    `POST /api/admin/blog/preview {"bodyMd":"Text."}`,
  ])
  expect(state.preview.value.preview?.parts).toEqual([{ kind: `html`, html: `<p>Text.</p>` }])
  expect(state.figures.value?.example).toBe(`<CostCalculator />`)
})

it(`keeps the last figure problems when a later check fails (#620)`, async () => {
  const problem: BlogProblem = { line: 3, code: `unknown`, tag: `Chart`, detail: `` }
  let failing = false
  const { state } = build((path) =>
    path.endsWith(`/preview`)
      ? Promise.resolve(
        failing ? fail(503, `Down for a moment.`) : rendered(`<p>Text.</p>`, [problem]),
      )
      : undefined
  )
  await state.openPost(ID)
  await state.renderPreview()
  expect(state.preview.value.problems).toEqual([problem])
  failing = true
  state.edit({ ...state.editor.value.value, bodyMd: `Text, changed.` })
  await state.renderPreview()
  expect(state.preview.value.error).toBe(`Down for a moment.`)
  expect(state.preview.value.problems).toEqual([problem])
})

it(`reads the list with its status and search, and drops an answer the page has left`, async () => {
  let release: (value: AdminApiResult<unknown>) => void = () => {}
  const late = new Promise<AdminApiResult<unknown>>((resolve) => release = resolve)
  const empty = { posts: [], counts: { all: 0, draft: 0, scheduled: 0, published: 0 } }
  const { state, calls } = build((path) =>
    path.includes(`q=old`) ? late : Promise.resolve(ok(empty))
  )
  const first = state.loadList({ status: `draft`, query: `old` })
  await state.loadList({ status: null, query: `` })
  release(ok({ ...empty, counts: { ...empty.counts, all: 9 } }))
  await first
  expect(calls).toEqual([
    `GET /api/admin/blog/posts?status=draft&q=old`,
    `GET /api/admin/blog/posts`,
  ])
  expect(state.list.value.list?.counts.all).toBe(0)
})

it(`keeps the status in the list's address and the search out of it`, () => {
  expect(blogListHref({ status: `scheduled`, query: `secret` })).toBe(`/blog?status=scheduled`)
  expect(blogListHref({ status: null, query: `secret` })).toBe(`/blog`)
})

it(`offers "View post" after publishing when the website's address is known`, async () => {
  const live = { ...post, status: `published` as const, publishedAt: post.createdAt }
  const { state, toasts, opened } = build((path) =>
    path.endsWith(`/newsletter`)
      ? Promise.resolve(ok({ enabled: false, lists: [], siteUrl: `https://www.example.com` }))
      : path.endsWith(`/topics`)
      ? Promise.resolve(ok({ topics: [] }))
      : path.endsWith(`/posts`)
      ? Promise.resolve(ok({ posts: [], counts: { all: 0, draft: 0, scheduled: 0, published: 0 } }))
      : path.endsWith(`/publish`)
      ? Promise.resolve(ok({ post: live }))
      : undefined
  )
  await state.loadExtras()
  await state.openPost(ID)
  state.openDialog(`publish`)
  await state.publish({ at: null, list: null })
  toasts.list.value.at(-1)?.action?.onAction()
  expect(opened).toEqual([`https://www.example.com/blog/hello`])
})

// #region History

const NEWER = `0195f0b4-3c1e-7a00-8000-0000000000b2`
const OLDER = `0195f0b4-3c1e-7a00-8000-0000000000b1`

/** An earlier version of `post`: its fields as saved at `savedAt`, with `changes`. */
const revisionOf = (id: string, changes: Partial<BlogRevision> = {}): BlogRevision => ({
  id,
  savedAt: `2026-10-22T10:00:00.000Z`,
  savedBy: `Ann`,
  slug: post.slug,
  title: post.title,
  seoTitle: post.seoTitle,
  description: post.description,
  tldr: post.tldr,
  topic: post.topic,
  coverUrl: post.coverUrl,
  coverAlt: post.coverAlt,
  intro: null,
  relatedFeature: null,
  authorUrl: post.authorUrl,
  bodyMd: post.bodyMd,
  language: post.language,
  translationOf: post.translationOf,
  ...changes,
})

const HISTORY = [
  revisionOf(NEWER, { title: `Hello, rewritten`, bodyMd: `Worse.` }),
  revisionOf(OLDER, { slug: `hello-first`, title: `Hello, first`, bodyMd: `The good text.` }),
]

/** Answers the post, its versions' list, and each version by id. */
const historyAnswer = (opened: BlogPost = post): Answer => (path) => {
  if (path.endsWith(`/revisions`)) {
    return Promise.resolve(ok({
      revisions: HISTORY.map(({ id, savedAt, savedBy, title }) => ({
        id,
        savedAt,
        savedBy,
        title,
      })),
    }))
  }
  const revision = HISTORY.find((entry) => path.endsWith(`/revisions/${entry.id}`))
  return Promise.resolve(revision ? ok({ revision }) : ok({ post: opened }))
}

/** Lets the reads History starts on its own finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

it(`History reads the list and the newest version, and reads a version picked again only once`, async () => {
  const { state, calls } = build(historyAnswer())
  await state.openPost(ID)
  state.openDialog(`history`)
  await settle()
  expect(state.history.value.revisions?.map((entry) => entry.id)).toEqual([NEWER, OLDER])
  expect(state.history.value.selected?.bodyMd).toBe(`Worse.`)
  await state.selectRevision(OLDER)
  await state.selectRevision(NEWER)
  expect(state.history.value.selected?.id).toBe(NEWER)
  expect(calls.slice(1)).toEqual([
    `GET /api/admin/blog/posts/${ID}/revisions`,
    `GET /api/admin/blog/posts/${ID}/revisions/${NEWER}`,
    `GET /api/admin/blog/posts/${ID}/revisions/${OLDER}`,
  ])
})

it(`History drops a version's answer that comes after another version was picked`, async () => {
  let answerOlder: (value: AdminApiResult<unknown>) => void = () => {}
  const { state } = build((path, init) =>
    path.endsWith(`/revisions/${OLDER}`)
      ? new Promise((resolve) => answerOlder = resolve)
      : historyAnswer()(path, init)
  )
  await state.openPost(ID)
  state.openDialog(`history`)
  await settle()
  const late = state.selectRevision(OLDER)
  await state.selectRevision(NEWER)
  answerOlder(ok({ revision: HISTORY[1] }))
  await late
  expect(state.history.value.selectedId).toBe(NEWER)
  expect(state.history.value.selected?.bodyMd).toBe(`Worse.`)
})

it(`History says why its list failed, and Try again reads it again`, async () => {
  let failing = true
  const { state } = build((path, init) =>
    failing && path.endsWith(`/revisions`)
      ? Promise.resolve(fail(500, `Couldn't reach the server.`))
      : historyAnswer()(path, init)
  )
  await state.openPost(ID)
  state.openDialog(`history`)
  await settle()
  expect(state.history.value.listError).toBe(`Couldn't reach the server.`)
  failing = false
  await state.retryHistory()
  expect(state.history.value.listError).toBe(null)
  expect(state.history.value.selected?.id).toBe(NEWER)
})

it(`restoring a version puts its fields in the editor unsaved, closes History and says to save`, async () => {
  const { state, calls, toasts } = build(historyAnswer())
  await state.openPost(ID)
  state.openDialog(`history`)
  await settle()
  state.restoreRevision(HISTORY[1])
  expect(state.editor.value.value).toMatchObject({
    slug: `hello-first`,
    title: `Hello, first`,
    bodyMd: `The good text.`,
  })
  expect(state.editor.value.saveStatus).toBe(`unsaved`)
  expect(state.dialog.value.dialog).toBe(null)
  expect(toasts.list.value.at(-1)?.body).toBe(`Earlier version restored. Save to keep it.`)
  // Nothing is written: the operator saves the restored fields, or leaves them.
  expect(calls.filter((call) => call.startsWith(`POST`))).toEqual([])
})

it(`restoring a version of a published post keeps its address, which only Change URL moves`, async () => {
  const published = { ...post, status: `published` as const, publishedAt: post.createdAt }
  const { state } = build(historyAnswer(published))
  await state.openPost(ID)
  state.restoreRevision(HISTORY[1])
  expect(state.editor.value.value.slug).toBe(`hello`)
  expect(state.editor.value.value.title).toBe(`Hello, first`)
})

// #endregion
