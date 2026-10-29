import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import { ADMIN_SUBSCRIBERS_NO_FILTER, type AdminSubscriberFilter } from "@domain/subscribers"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { newsletterHref } from "./module.tsx"
import { createNewsletterState, type NewsletterExportPorts } from "./state.ts"

const ok = <T>(data: T, status = 200) => ({ ok: true, status, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

type Answer = (path: string, init?: RequestInit) => Promise<AdminApiResult<unknown>> | undefined

/** A `request` that answers from `answer` (or a plain success) and records each call and body. */
function fakeRequest(answer: Answer = () => undefined) {
  const calls: string[] = []
  const request = ((path: string, init?: RequestInit) => {
    const body = init?.body === undefined ? `` : ` ${init.body}`
    calls.push(`${init?.method ?? `GET`} ${path}${body}`)
    const fallback = path === `/api/admin/newsletter/subscribers/search`
      ? ok({ subscribers: [], total: 0, page: 1, pageSize: 25 })
      : path.endsWith(`/sends`)
      ? ok({ sends: [] })
      : ok({})
    return answer(path, init) ?? Promise.resolve(fallback)
  }) as AdminFetch
  return { request, calls }
}

/** Export ports that answer `response` and record what was saved. */
function fakeExport(response: Response | Error) {
  const fetched: [string, RequestInit][] = []
  const saved: [string, string][] = []
  const ports: NewsletterExportPorts = {
    fetch: (path, init) => {
      fetched.push([path, init])
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
    },
    save: async (file, name) => {
      saved.push([name, await file.text()])
    },
    now: () => new Date(`2026-10-16T09:00:00.000Z`),
  }
  return { ports, fetched, saved }
}

it(`reads the list with the filter in a POST body, never in the URL`, async () => {
  const { request, calls } = fakeRequest()
  const state = createNewsletterState(request, createToastStore())
  await state.loadList({ query: `ann`, status: `pending`, language: `de`, page: 2 })

  expect(calls).toEqual([
    `POST /api/admin/newsletter/subscribers/search {"q":"ann","status":"pending","language":"de","page":"2"}`,
  ])
  expect(state.list.value.pending).toBe(false)
})

it(`drops the answer for a filter the page has already left`, async () => {
  let release: (value: AdminApiResult<unknown>) => void = () => {}
  const late = new Promise<AdminApiResult<unknown>>((resolve) => release = resolve)
  const { request } = fakeRequest((_path, init) =>
    String(init?.body).includes(`"q":"old"`) ? late : undefined
  )
  const state = createNewsletterState(request, createToastStore())
  const old: AdminSubscriberFilter = { ...ADMIN_SUBSCRIBERS_NO_FILTER, query: `old` }

  const first = state.loadList(old)
  await state.loadList(ADMIN_SUBSCRIBERS_NO_FILTER)
  release(ok({ subscribers: [{ email: `old@example.com` }], total: 1, page: 1, pageSize: 25 }))
  await first

  expect(state.list.value.filter).toBe(ADMIN_SUBSCRIBERS_NO_FILTER)
  expect(state.list.value.list?.total).toBe(0)
})

it(`posts the dialog's address in the body, then reads the list and numbers again`, async () => {
  const { request, calls } = fakeRequest()
  const toasts = createToastStore()
  const state = createNewsletterState(request, toasts)
  await state.loadList(ADMIN_SUBSCRIBERS_NO_FILTER)
  calls.length = 0

  state.openDialog({ action: `remove`, email: `ann@example.com` })
  await state.confirm()

  expect(calls).toEqual([
    `POST /api/admin/newsletter/subscribers/remove {"email":"ann@example.com"}`,
    `POST /api/admin/newsletter/subscribers/search {}`,
    `GET /api/admin/newsletter/stats`,
  ])
  expect(state.dialog.value.dialog).toBeNull()
  expect(state.done.value).toBe(1)
  expect(toasts.list.value.map((toast) => toast.body)).toEqual([
    `ann@example.com no longer gets the newsletter.`,
  ])
})

it(`keeps the dialog open with the API's reason when it refuses`, async () => {
  const { request } = fakeRequest((path) =>
    path.endsWith(`/resend`) ? Promise.resolve(fail(409, `Already confirmed`)) : undefined
  )
  const toasts = createToastStore()
  const state = createNewsletterState(request, toasts)

  state.openDialog({ action: `resend`, email: `ann@example.com` })
  await state.confirm()

  expect(state.dialog.value).toEqual({
    dialog: { action: `resend`, email: `ann@example.com` },
    error: `Already confirmed`,
    pending: false,
  })
  expect(state.done.value).toBe(0)
  expect(toasts.list.value).toEqual([])
})

it(`saves the export under today's name, posting with the session cookie`, async () => {
  const { request } = fakeRequest()
  const { ports, fetched, saved } = fakeExport(new Response(`Address\r\n`, { status: 200 }))
  const state = createNewsletterState(request, createToastStore(), ports)

  await state.exportCsv()

  expect(fetched.map(([path, init]) => [path, init.method, init.credentials])).toEqual([
    [`/api/admin/newsletter/subscribers/export`, `POST`, `include`],
  ])
  expect(saved).toEqual([[`newsletter-subscribers-2026-10-16.csv`, `Address\r\n`]])
  expect(state.exporting.value).toBe(false)
})

it(`says why the export failed and saves nothing`, async () => {
  const { request } = fakeRequest()
  const refused = Response.json(
    { error: { code: `rate_limited`, message: `Too many requests` } },
    { status: 429 },
  )
  for (
    const [answer, message] of [
      [refused, `Too many requests`],
      [new Error(`offline`), `Something went wrong. Try again.`],
    ] as const
  ) {
    const toasts = createToastStore()
    const { ports, saved } = fakeExport(answer)
    const state = createNewsletterState(request, toasts, ports)

    await state.exportCsv()

    expect(saved).toEqual([])
    expect(toasts.list.value.map((toast) => toast.body)).toEqual([message])
    expect(state.exporting.value).toBe(false)
  }
})

it(`keeps the status, page and tab in the address, leaving out every default and the search`, () => {
  expect(newsletterHref(ADMIN_SUBSCRIBERS_NO_FILTER, `subscribers`)).toBe(`/newsletter`)
  expect(
    newsletterHref(
      { query: `ann@example.com`, status: `pending`, language: `de`, page: 2 },
      `sends`,
    ),
  ).toBe(`/newsletter?status=pending&language=de&page=2&tab=sends`)
  expect(newsletterHref({ ...ADMIN_SUBSCRIBERS_NO_FILTER, query: `ann` }, `subscribers`)).toBe(
    `/newsletter`,
  )
})
