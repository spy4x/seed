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
