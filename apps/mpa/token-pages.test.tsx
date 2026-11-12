import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "@spy4x/preact-server"
import type { Api, ApiAnswer } from "./api.ts"
import {
  createSubscriptionConfirmHandlers,
  createUnsubscribeHandlers,
  type TokenPageAddress,
  type TokenPageFrame,
  type TokenScreenProps,
} from "./token-pages.tsx"
import type { State } from "./utils.ts"

const origin = `https://shop.example.com`
const info = {
  remoteAddr: { transport: `tcp`, hostname: `192.0.2.7`, port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>
const link = { list: `news`, token: `token-from-the-link` }
const linkQuery = new URLSearchParams(link).toString()

/** A fake API whose every call answers `answer`, recording each call. */
function fakeApi(answer: ApiAnswer) {
  const calls: { method: string; path: string; json?: unknown }[] = []
  const api: Api = {
    call(method, path, json) {
      calls.push(json === undefined ? { method, path } : { method, path, json })
      return Promise.resolve(answer)
    },
    file: () => Promise.reject(new Error(`no files here`)),
  }
  return { api, calls }
}

/**
 * A product's frame: it wraps the screen in a `<main>` naming the page's kind and state, draws its
 * own off page, and records what it was asked to draw.
 */
function fakeFrame(props: TokenScreenProps = {}) {
  const drawn: { kind: string; state: string; status: number }[] = []
  const offs: TokenPageAddress[] = []
  const frame: TokenPageFrame = {
    screen: () => props,
    render(ctx, page, init) {
      drawn.push({ kind: page.kind, state: page.state, status: init.status })
      return ctx.render(<main data-frame={page.kind}>{page.screen}</main>, init)
    },
    off(ctx, page, init) {
      offs.push(page)
      return ctx.render(<p data-e2e="product-off" />, init)
    },
  }
  return { frame, drawn, offs }
}

type Handlers = ReturnType<typeof createSubscriptionConfirmHandlers>

/** The handlers under `path`, with the fake API on the request's state. */
function appOf(
  handlers: Handlers,
  path: string,
  api: Api,
  newsletter = true,
): (request: Request) => Promise<Response> {
  const handle = new App<State>()
    .use((ctx) => {
      ctx.state.api = api
      ctx.state.newsletter = newsletter
      ctx.state.language = `en`
      return ctx.next()
    })
    .get(path, handlers.GET!)
    .post(path, handlers.POST!)
    .handler()
  return (request) => Promise.resolve(handle(request, info))
}

function get(path: string): Request {
  return new Request(`${origin}${path}`)
}

function post(path: string, fields: Record<string, string>): Request {
  return new Request(`${origin}${path}`, { method: `POST`, body: new URLSearchParams(fields) })
}

/** What differs between the two pages; every test below runs on both. */
const PAGES = [
  {
    kind: `confirm`,
    path: `/subscribe/confirm`,
    create: createSubscriptionConfirmHandlers,
    missing: { state: `invalid`, status: 400 },
    refused: `expired`,
    preview: `/api/subscribers/confirm?${linkQuery}`,
    step: { method: `POST`, path: `/api/subscribers/confirm`, json: link },
    done: `subscription-confirm-done`,
  },
  {
    kind: `unsubscribe`,
    path: `/unsubscribe`,
    create: createUnsubscribeHandlers,
    missing: { state: `not-recognised`, status: 404 },
    refused: `not-recognised`,
    preview: `/api/subscribers/unsubscribe/preview?${linkQuery}`,
    step: { method: `POST`, path: `/api/subscribers/unsubscribe?${linkQuery}` },
    done: `unsubscribe-done`,
  },
] as const

for (const page of PAGES) {
  describe(`the ${page.kind} handlers from a product's frame`, () => {
    function setup(answer: ApiAnswer, props?: TokenScreenProps, newsletter = true) {
      const { api, calls } = fakeApi(answer)
      const { frame, drawn, offs } = fakeFrame(props)
      return { app: appOf(page.create(frame), page.path, api, newsletter), calls, drawn, offs }
    }

    it(`draws the frame's off page with 503 and asks the API nothing while subscriptions are off`, async () => {
      const { app, calls, drawn, offs } = setup({ status: 200, body: {} }, {}, false)

      for (const request of [get(`${page.path}?${linkQuery}`), post(page.path, link)]) {
        const response = await app(request)
        expect(response.status).toBe(503)
        expect(response.headers.get(`referrer-policy`)).toBe(`no-referrer`)
        expect(await response.text()).toContain(`product-off`)
      }
      expect(offs).toEqual([{ kind: page.kind, path: page.path }, {
        kind: page.kind,
        path: page.path,
      }])
      expect(calls).toEqual([])
      expect(drawn).toEqual([])
    })

    it(`answers a link without a token as ${page.missing.state} with ${page.missing.status}, asking the API nothing`, async () => {
      const { app, calls, drawn } = setup({ status: 200, body: {} })

      const response = await app(get(`${page.path}?list=news`))

      expect(response.status).toBe(page.missing.status)
      expect(response.headers.get(`referrer-policy`)).toBe(`no-referrer`)
      expect(drawn).toEqual([{ kind: page.kind, ...page.missing }])
      expect(calls).toEqual([])
    })

    it(`shows a finished step at ?state=done without asking the API`, async () => {
      const { app, calls, drawn } = setup({ status: 200, body: {} })

      const response = await app(get(`${page.path}?state=done`))

      expect(response.status).toBe(200)
      expect(response.headers.get(`referrer-policy`)).toBe(`no-referrer`)
      expect(await response.text()).toContain(`data-e2e="${page.done}"`)
      expect(drawn).toEqual([{ kind: page.kind, state: `done`, status: 200 }])
      expect(calls).toEqual([])
    })

    it(`asks the API what the link holds and shows its address, asking for a click`, async () => {
      const { app, calls, drawn } = setup({
        status: 200,
        body: { state: `confirm`, email: `ada@example.com` },
      })

      const response = await app(get(`${page.path}?${linkQuery}`))

      expect(calls).toEqual([{ method: `GET`, path: page.preview }])
      expect(response.status).toBe(200)
      expect(response.headers.get(`referrer-policy`)).toBe(`no-referrer`)
      const html = await response.text()
      expect(html).toContain(`ada@example.com`)
      expect(html).toContain(`name="token" value="token-from-the-link"`)
      expect(drawn).toEqual([{ kind: page.kind, state: `confirm`, status: 200 }])
    })

    it(`reads a refused link's state from the API error's reason and keeps its status`, async () => {
      const { app, drawn } = setup({
        status: 400,
        body: { error: { code: `bad_request`, message: `No.`, reason: page.refused } },
      })

      const response = await app(get(`${page.path}?${linkQuery}`))

      expect(response.status).toBe(400)
      expect(drawn).toEqual([{ kind: page.kind, state: page.refused, status: 400 }])
    })

    for (const answer of [{ status: 502, body: null }, { status: 200, body: { state: `odd` } }]) {
      it(`shows an error for an API answer it cannot read (${answer.status}, ${JSON.stringify(answer.body)})`, async () => {
        const { app, drawn } = setup(answer)

        const response = await app(get(`${page.path}?${linkQuery}`))

        expect(response.status).toBe(answer.status)
        expect(drawn).toEqual([{ kind: page.kind, state: `error`, status: answer.status }])
      })
    }

    it(`sends the link's list and token to the API and redirects a finished step with 303 to the frame's address of the page, with no token`, async () => {
      const localized = setup({ status: 200, body: { state: `done` } }, {
        localize: (path) => `/vi${path}`,
      })
      const plain = setup({ status: 200, body: { state: `done` } })

      const response = await localized.app(post(page.path, link))
      const unlocalized = await plain.app(post(page.path, link))

      expect(response.status).toBe(303)
      expect(response.headers.get(`location`)).toBe(`/vi${page.path}?state=done`)
      expect(unlocalized.headers.get(`location`)).toBe(`${page.path}?state=done`)
      expect(localized.calls).toEqual([page.step])
      expect(localized.drawn).toEqual([])
    })

    it(`draws a refused post again with the link's token kept and the API's Retry-After`, async () => {
      const { app, drawn } = setup({
        status: 429,
        body: { error: { code: `rate_limited`, message: `Slow down.` } },
        retryAfter: `30`,
      })

      const response = await app(post(page.path, link))

      expect(response.status).toBe(429)
      expect(response.headers.get(`retry-after`)).toBe(`30`)
      expect(response.headers.get(`referrer-policy`)).toBe(`no-referrer`)
      expect(await response.text()).toContain(`name="token" value="token-from-the-link"`)
      expect(drawn).toEqual([{ kind: page.kind, state: `error`, status: 429 }])
    })
  })
}

describe(`the confirm handlers' screen props`, () => {
  function confirmApp(props: TokenScreenProps, answer: ApiAnswer) {
    const { api, calls } = fakeApi(answer)
    const { frame } = fakeFrame(props)
    return {
      app: appOf(createSubscriptionConfirmHandlers(frame), `/subscribe/confirm`, api),
      calls,
    }
  }

  it(`posts the frame's language with the confirm, and none when the frame names none`, async () => {
    const withLanguage = confirmApp({ language: `de` }, { status: 200, body: { state: `confirm` } })
    const without = confirmApp({}, { status: 200, body: { state: `done` } })

    const asked = await (await withLanguage.app(get(`/subscribe/confirm?${linkQuery}`))).text()
    await without.app(post(`/subscribe/confirm`, { ...link, language: `` }))

    expect(asked).toContain(`name="language" value="de"`)
    expect(without.calls).toEqual([{
      method: `POST`,
      path: `/api/subscribers/confirm`,
      json: link,
    }])
  })

  it(`shows the frame's onward link and localized form action`, async () => {
    const { app } = confirmApp({
      localize: (path) => `/vi${path}`,
      onward: { href: `/catalog`, label: `Back to the shop` },
    }, { status: 200, body: { state: `confirm` } })

    const asked = await (await app(get(`/subscribe/confirm?${linkQuery}`))).text()
    const done = await (await app(get(`/subscribe/confirm?state=done`))).text()

    expect(asked).toContain(`action="/vi/subscribe/confirm"`)
    expect(done).toContain(`href="/catalog"`)
    expect(done).toContain(`Back to the shop`)
  })
})
