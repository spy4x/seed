import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import type { AdminBlogShareRow, AdminBlogSharingResponse, BlogShare } from "@domain/blog"
import type { AdminFetch } from "../../state.ts"
import { createSharingState } from "./sharing-state.ts"

const POST_ID = `0195f0b4-3c1e-7a00-8000-0000000000aa`
const CHANNEL_ID = `0195f0b4-3c1e-7a00-8000-0000000000bb`
const NOW = `2026-11-06T10:00:00.000Z`

const posted: BlogShare = {
  id: `0195f0b4-3c1e-7a00-8000-0000000000cc`,
  postId: POST_ID,
  channelId: CHANNEL_ID,
  status: `posted`,
  url: `https://dev.to/seed/hello`,
  sharedAt: `2026-11-02T09:30:00.000Z`,
  skipReason: null,
  automatic: true,
  error: `Dev.to answered 503 once`,
  readError: null,
  readFailedAt: null,
  updatedAt: NOW,
}

function sharingOf(share: BlogShare): AdminBlogSharingResponse {
  const row: AdminBlogShareRow = {
    channel: {
      id: CHANNEL_ID,
      name: `Dev.to`,
      kind: `devto`,
      address: `https://dev.to/seed`,
      utmSource: `devto`,
      addUtm: true,
      autoPost: true,
      languages: [`en`],
      startsAt: null,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    },
    share,
    state: share.status,
    text: null,
    link: `https://seedsaas.com/blog/hello`,
    submitUrl: null,
    result: null,
    visits: null,
    posting: false,
  }
  return {
    post: {
      id: POST_ID,
      title: `Hello`,
      language: `en`,
      status: `published`,
      translationOf: null,
      publishedAt: NOW,
    },
    hasChannels: true,
    linkedinExpiresAt: null,
    rows: [row],
    visits: { setup: false, missing: [], readAt: null, stale: false },
  }
}

it(`undoes a change by sending the row back with its date, its automatic flag and its error`, async () => {
  const sent: unknown[] = []
  let current = sharingOf(posted)
  const request = ((path: string, init?: RequestInit) => {
    if (init?.method === `POST`) {
      const body = JSON.parse(String(init.body))
      sent.push(body)
      current = sharingOf({ ...posted, status: body.status, automatic: false, error: null })
      return Promise.resolve({ ok: true, status: 200, data: { saved: true } })
    }
    expect(path).toBe(`/api/admin/blog/posts/${POST_ID}/sharing`)
    return Promise.resolve({ ok: true, status: 200, data: current })
  }) as unknown as AdminFetch
  const toasts = createToastStore()
  const state = createSharingState(request, toasts)
  await state.loadSharing(POST_ID)

  await state.setShares({ channelIds: [CHANNEL_ID], status: `todo` })
  await toasts.list.value.at(-1)?.action?.onAction()

  expect(sent.at(-1)).toEqual({
    channelIds: [CHANNEL_ID],
    status: `posted`,
    url: `https://dev.to/seed/hello`,
    skipReason: null,
    sharedAt: `2026-11-02T09:30:00.000Z`,
    automatic: true,
    error: `Dev.to answered 503 once`,
  })
})

it(`tries an automatic post again on its own route, then reads the checklist with the row posting`, async () => {
  const paths: string[] = []
  let current = sharingOf({ ...posted, status: `todo`, url: null, sharedAt: null })
  const request = ((path: string, init?: RequestInit) => {
    paths.push(`${init?.method ?? `GET`} ${path}`)
    if (init?.method === `POST`) {
      current = { ...current, rows: current.rows.map((row) => ({ ...row, posting: true })) }
      return Promise.resolve({ ok: true, status: 202, data: { queued: true } })
    }
    return Promise.resolve({ ok: true, status: 200, data: current })
  }) as unknown as AdminFetch
  const state = createSharingState(request, createToastStore())
  await state.loadSharing(POST_ID)
  expect(state.posting()).toBe(false)

  expect(await state.retryPost(CHANNEL_ID)).toBe(true)

  expect(paths).toEqual([
    `GET /api/admin/blog/posts/${POST_ID}/sharing`,
    `POST /api/admin/blog/posts/${POST_ID}/shares/${CHANNEL_ID}/retry`,
    `GET /api/admin/blog/posts/${POST_ID}/sharing`,
  ])
  expect(state.posting()).toBe(true)
  expect(state.sharing.value.pending).toBeNull()
})

it(`shows a refused try on its row`, async () => {
  const request = ((_path: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === `POST`
        ? { ok: false, status: 409, error: { message: `Turn on Post automatically first.` } }
        : { ok: true, status: 200, data: sharingOf(posted) },
    )) as unknown as AdminFetch
  const state = createSharingState(request, createToastStore())
  await state.loadSharing(POST_ID)

  expect(await state.retryPost(CHANNEL_ID)).toBe(false)
  expect(state.sharing.value.rowErrors).toEqual({
    [CHANNEL_ID]: `Turn on Post automatically first.`,
  })
})
