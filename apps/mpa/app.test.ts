import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import { setBuildCache } from "fresh/internal"
import { asset } from "fresh/runtime"
import { handler as subscribe } from "./routes/subscribe/index.ts"
import { handler as subscriptionConfirm } from "./routes/subscribe/confirm.ts"
import { handler as unsubscribe } from "./routes/unsubscribe.ts"
import {
  newsletterPageMiddleware,
  pageMiddleware,
  securityHeadersMiddleware,
  staticFilesMiddleware,
  UNVERSIONED_FILE_CACHE,
} from "./middleware.ts"
import { REPOSITORY_URL } from "./brand.ts"
import type { MpaConfig } from "./config.ts"
import type { State } from "./utils.ts"

const config: MpaConfig = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://app.example.com",
  apiOrigin: "https://app.example.com",
}
const sameOrigin = { origin: config.webAppOrigin, "sec-fetch-site": "same-origin" }
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

/** A fake API that answers every call with `answer()` and records each request's JSON body. */
function fakeApi(answer: (path: string, method: string) => Response) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    const text = await request.text()
    calls.push({ method: request.method, path, body: text ? JSON.parse(text) : null })
    return answer(path, request.method)
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

function appWith(fetch: typeof globalThis.fetch, newsletter: () => boolean = () => true) {
  return new App<State>()
    .use(pageMiddleware(config, fetch, newsletter))
    .get("/page", (ctx) => ctx.html("<p>page</p>"))
    .get("/subscribe", subscribe.GET!)
    .post("/subscribe", subscribe.POST!)
    .get("/subscribe/confirm", subscriptionConfirm.GET!)
    .post("/subscribe/confirm", subscriptionConfirm.POST!)
    .get("/unsubscribe", unsubscribe.GET!)
    .post("/unsubscribe", unsubscribe.POST!)
    .handler()
}

/** Runs `run` and returns every line it wrote with `console.error`, as text. */
async function errorLog(run: () => Promise<void>): Promise<string[]> {
  const logged: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "))
  try {
    await run()
  } finally {
    console.error = original
  }
  return logged
}

function formPost(path: string, fields: Record<string, string>, headers = sameOrigin): Request {
  return new Request(`${config.webAppOrigin}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  })
}

describe("pageMiddleware", () => {
  const subscription = { email: "ada@example.com", list: "news" }

  it("refuses a subscription another site posts before the API hears of it", async () => {
    const { calls, fetch } = fakeApi(() => Response.json({}, { status: 202 }))

    const response = await appWith(fetch)(
      formPost("/subscribe", subscription, {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      }),
      info,
    )

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it("lets the site's own subscribe form through to the API", async () => {
    const { calls, fetch } = fakeApi(() => Response.json({}, { status: 202 }))

    const response = await appWith(fetch)(formPost("/subscribe", subscription), info)

    expect(response.status).not.toBe(403)
    expect(calls.map((call) => call.path)).toEqual(["/api/subscribers"])
  })

  it("lets a same-origin post under no-referrer through, whose origin is null", async () => {
    const { calls, fetch } = fakeApi(() => Response.json({}, { status: 202 }))

    const response = await appWith(fetch)(
      formPost("/subscribe", subscription, { origin: "null", "sec-fetch-site": "same-origin" }),
      info,
    )

    expect(response.status).not.toBe(403)
    expect(calls).toHaveLength(1)
  })

  it("answers a form over the size cap with 413 and never calls the API", async () => {
    const { calls, fetch } = fakeApi(() => Response.json({}))

    const response = await appWith(fetch)(
      formPost("/subscribe", { email: "x".repeat(300 * 1024), list: "news" }),
      info,
    )

    expect(response.status).toBe(413)
    expect(calls).toEqual([])
  })

  it("answers 400 to a post whose body is not a form and never calls the API", async () => {
    const { calls, fetch } = fakeApi(() => Response.json({}))
    const request = new Request(`${config.webAppOrigin}/subscribe`, {
      method: "POST",
      headers: { ...sameOrigin, "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", list: "news" }),
    })

    const response = await appWith(fetch)(request, info)

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it("lets a browser keep a page but revalidate it before showing it again", async () => {
    const { fetch } = fakeApi(() => Response.json({}))

    const response = await appWith(fetch)(new Request(`${config.webAppOrigin}/page`), info)

    expect(response.headers.get("cache-control")).toBe("no-cache")
  })
})

describe("securityHeadersMiddleware", () => {
  /** The app as `main.ts` builds it: the security headers first, then the page middleware. */
  async function securedApp(appConfig = config) {
    const { fetch } = fakeApi(() => Response.json({}))
    return new App<State>()
      .use(await securityHeadersMiddleware(appConfig))
      .use(pageMiddleware(appConfig, fetch, () => true))
      .get("/page", (ctx) => ctx.html("<p>page</p>"))
      .get("/broken", () => {
        throw new Error("a route failed")
      })
      .post("/subscribe", subscribe.POST!)
      .handler()
  }

  const policy =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; " +
    "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'none'"

  function expectSecurityHeaders(response: Response) {
    expect(response.headers.get("content-security-policy")).toBe(policy)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("x-frame-options")).toBe("DENY")
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=15552000; includeSubDomains",
    )
  }

  it("sends the policy, nosniff, no-referrer, the frame ban and HSTS with a page", async () => {
    const response = await (await securedApp())(new Request(`${config.webAppOrigin}/page`), info)

    expect(response.status).toBe(200)
    expectSecurityHeaders(response)
    expect(response.headers.get("cache-control")).toBe("no-cache")
  })

  it("sends them with the 404 of an unknown address, inside the site's frame", async () => {
    const response = await (await securedApp())(new Request(`${config.webAppOrigin}/nope`), info)

    expect(response.status).toBe(404)
    expectSecurityHeaders(response)
    const page = await response.text()
    expect(page).toContain("Page not found")
    expect(page).toContain(`data-e2e="site-brand"`)
  })

  it("sends them with the 500 of a route that throws, inside the site's frame, and logs the error with the path but not the query", async () => {
    let response = new Response()
    const logged = await errorLog(async () => {
      response = await (await securedApp())(
        new Request(`${config.webAppOrigin}/broken?token=token-from-the-link`),
        info,
      )
    })

    expect(response.status).toBe(500)
    expectSecurityHeaders(response)
    expect(response.headers.get("cache-control")).toBe("no-cache")
    const page = await response.text()
    expect(page).toContain("Something went wrong")
    expect(page).toContain(`data-e2e="site-brand"`)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain("GET /broken failed")
    expect(logged[0]).toContain("a route failed")
    expect(logged[0]).not.toContain("token-from-the-link")
  })

  it("sends them with the refusal of a post from another site", async () => {
    const response = await (await securedApp())(
      formPost("/subscribe", { email: "ada@example.com", list: "news" }, {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      }),
      info,
    )

    expect(response.status).toBe(403)
    expectSecurityHeaders(response)
  })

  it("lets a form on a website with its own domain redirect to the SPA, and nowhere else", async () => {
    const website = { ...config, webAppOrigin: "https://www.example.com" }

    const response = await (await securedApp(website))(
      new Request(`${website.webAppOrigin}/page`),
      info,
    )

    expect(response.headers.get("content-security-policy")).toBe(
      policy.replace("form-action 'self'", "form-action 'self' https://app.example.com"),
    )
  })

  it("allows the Umami origin to load its tracker and take its events, and nothing more", async () => {
    const analytics = { origin: "https://stats.example.com", websiteId: "site" }

    const response = await (await securedApp({ ...config, analytics }))(
      new Request(`${config.webAppOrigin}/page`),
      info,
    )

    expect(response.headers.get("content-security-policy")).toBe(
      policy
        .replace("script-src 'self'", "script-src 'self' https://stats.example.com")
        .replace("connect-src 'self'", "connect-src 'self' https://stats.example.com"),
    )
  })
})

describe("the subscription pages", () => {
  /**
   * A fake API that answers every call with `answer(url)`. Records each call's full URL, query
   * included, and its body.
   */
  function subscribersApi(answer: (url: URL) => Response) {
    const calls: { method: string; url: string; body: unknown }[] = []
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const text = await request.text()
      calls.push({
        method: request.method,
        url: url.pathname + url.search,
        body: text ? JSON.parse(text) : null,
      })
      return answer(url)
    }
    const apiCalls = () => calls
    return { apiCalls, fetch: fetch as typeof globalThis.fetch }
  }
  const token = { list: "news", token: "token-from-the-link" }
  const tokenQuery = new URLSearchParams(token).toString()

  it("asks the API for a confirm link with the address and the list, then redirects to a page that says it is on its way", async () => {
    const { apiCalls, fetch } = subscribersApi(() => Response.json({}, { status: 202 }))
    const app = appWith(fetch)

    const response = await app(
      formPost("/subscribe", { email: "ada@example.com", list: "news" }),
      info,
    )

    expect(apiCalls()).toEqual([
      { method: "POST", url: "/api/subscribers", body: { email: "ada@example.com", list: "news" } },
    ])
    // A reload of the page the browser lands on is a GET: it asks the API for nothing.
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/subscribe?state=sent")
    const landed = await app(new Request(`${config.webAppOrigin}/subscribe?state=sent`), info)
    expect(landed.status).toBe(200)
    expect(await landed.text()).toContain("Check your inbox")
    expect(apiCalls()).toHaveLength(1)
  })

  const refusals: { status: number; code: string; error: string; retryAfter: string | null }[] = [
    { status: 400, code: "bad_request", error: "Enter a valid e-mail address", retryAfter: null },
    { status: 429, code: "rate_limited", error: "Too many requests", retryAfter: "30" },
    { status: 503, code: "internal", error: "Mail subscriptions are off", retryAfter: null },
  ]
  for (const refusal of refusals) {
    it(`shows a subscription the API refuses with ${refusal.status} as refused: its status, its message and the address still in the form`, async () => {
      const { fetch } = subscribersApi(() =>
        Response.json({ error: { code: refusal.code, message: refusal.error } }, {
          status: refusal.status,
          headers: refusal.retryAfter === null ? {} : { "retry-after": refusal.retryAfter },
        })
      )

      const response = await appWith(fetch)(
        formPost("/subscribe", { email: "ada@example.com", list: "news" }),
        info,
      )

      expect(response.status).toBe(refusal.status)
      expect(response.headers.get("location")).toBeNull()
      expect(response.headers.get("retry-after")).toBe(refusal.retryAfter)
      const page = await response.text()
      expect(page).toContain(refusal.error)
      expect(page).toContain(`value="ada@example.com"`)
      expect(page).not.toContain("Check your inbox")
    })
  }

  it("shows the address a confirm link holds, sends no Referer and keeps the page out of caches", async () => {
    const { apiCalls, fetch } = subscribersApi(() =>
      Response.json({ state: "confirm", email: "ada@example.com" })
    )

    const response = await appWith(fetch)(
      new Request(`${config.webAppOrigin}/subscribe/confirm?${tokenQuery}`),
      info,
    )

    expect(apiCalls()).toEqual([
      { method: "GET", url: `/api/subscribers/confirm?${tokenQuery}`, body: null },
    ])
    expect(response.status).toBe(200)
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("cache-control")).toBe("no-store")
    const page = await response.text()
    expect(page).toContain("ada@example.com")
    expect(page).toContain(`name="token" value="token-from-the-link"`)
  })

  it("confirms with the link's list and token, then redirects to the page without the token", async () => {
    const { apiCalls, fetch } = subscribersApi(() => Response.json({ state: "done" }))

    const response = await appWith(fetch)(formPost("/subscribe/confirm", token), info)

    expect(apiCalls()).toEqual([{ method: "POST", url: "/api/subscribers/confirm", body: token }])
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/subscribe/confirm?state=done")
  })

  it("shows an expired confirm link with the API's status and offers a new one", async () => {
    const { fetch } = subscribersApi(() =>
      Response.json(
        { error: { code: "bad_request", message: "This link has expired.", reason: "expired" } },
        { status: 400 },
      )
    )

    const response = await appWith(fetch)(formPost("/subscribe/confirm", token), info)

    expect(response.status).toBe(400)
    expect(await response.text()).toContain("This link has expired")
  })

  it("shows whom an unsubscribe link names, sends no Referer and keeps the page out of caches", async () => {
    const { apiCalls, fetch } = subscribersApi(() =>
      Response.json({ state: "confirm", email: "ada@example.com" })
    )

    const response = await appWith(fetch)(
      new Request(`${config.webAppOrigin}/unsubscribe?${tokenQuery}`),
      info,
    )

    expect(apiCalls()).toEqual([
      { method: "GET", url: `/api/subscribers/unsubscribe/preview?${tokenQuery}`, body: null },
    ])
    expect(response.status).toBe(200)
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.text()).toContain("ada@example.com")
  })

  it("unsubscribes with the token in the API call's query, then redirects without the token", async () => {
    const { apiCalls, fetch } = subscribersApi(() => Response.json({ state: "done" }))

    const response = await appWith(fetch)(formPost("/unsubscribe", token), info)

    expect(apiCalls()).toEqual([
      { method: "POST", url: `/api/subscribers/unsubscribe?${tokenQuery}`, body: null },
    ])
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/unsubscribe?state=done")
  })

  it("passes the API's 429 and Retry-After on when unsubscribes come too fast", async () => {
    const { fetch } = subscribersApi(() =>
      Response.json(
        { error: { code: "rate_limited", message: "Too many tries.", reason: "limited" } },
        { status: 429, headers: { "retry-after": "30" } },
      )
    )

    const response = await appWith(fetch)(formPost("/unsubscribe", token), info)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("30")
    expect(await response.text()).toContain("Could not unsubscribe")
  })
})

describe("the subscription pages without an API behind them", () => {
  const token = { list: "news", token: "token-from-the-link" }
  const tokenQuery = new URLSearchParams(token).toString()
  /** What Deno's `fetch` rejects with when nothing listens: the message names the full address. */
  const unreachable = ((input: string | URL | Request) =>
    Promise.reject(
      new TypeError(`error sending request for url (${new Request(input).url})`),
    )) as typeof globalThis.fetch

  const requests: [string, () => Request][] = [
    [
      "a subscribe request",
      () => formPost("/subscribe", { email: "ada@example.com", list: "news" }),
    ],
    ["a confirm link", () => new Request(`${config.webAppOrigin}/subscribe/confirm?${tokenQuery}`)],
    ["a confirm", () => formPost("/subscribe/confirm", token)],
    ["an unsubscribe link", () => new Request(`${config.webAppOrigin}/unsubscribe?${tokenQuery}`)],
    ["an unsubscribe", () => formPost("/unsubscribe", token)],
  ]
  for (const [name, request] of requests) {
    it(`answers ${name} with the page's own error inside the site's frame, and logs neither the token nor the address`, async () => {
      let response = new Response()
      const logged = await errorLog(async () => {
        response = await appWith(unreachable)(request(), info)
      })

      expect(response.status).toBe(502)
      expect(response.headers.get("content-type")).toContain("text/html")
      const page = await response.text()
      expect(page).toContain(`data-e2e="site-brand"`)
      expect(page).toMatch(/Could not (send the link|confirm the subscription|unsubscribe)/)
      expect(logged).toHaveLength(1)
      expect(logged[0]).toMatch(
        /^API call failed: (GET|POST) \/api\/subscribers[a-z/]* \(TypeError\)$/,
      )
      expect(logged.join()).not.toContain("token-from-the-link")
      expect(logged.join()).not.toContain("ada@example.com")
    })
  }
})

describe("the subscription pages while subscriptions are off", () => {
  const token = { list: "news", token: "token-from-the-link" }
  const tokenQuery = new URLSearchParams(token).toString()
  const off = () => false

  const requests: [string, () => Request][] = [
    ["the subscribe page", () => new Request(`${config.webAppOrigin}/subscribe`)],
    [
      "a subscribe request",
      () => formPost("/subscribe", { email: "ada@example.com", list: "news" }),
    ],
    ["a confirm link", () => new Request(`${config.webAppOrigin}/subscribe/confirm?${tokenQuery}`)],
    ["a confirm", () => formPost("/subscribe/confirm", token)],
    ["an unsubscribe link", () => new Request(`${config.webAppOrigin}/unsubscribe?${tokenQuery}`)],
    ["an unsubscribe", () => formPost("/unsubscribe", token)],
  ]
  for (const [name, request] of requests) {
    it(`answers ${name} with a heading, a notice that the newsletter is off, a next step, no form, and no call to the API`, async () => {
      const { calls, fetch } = fakeApi(() => Response.json({ error: "off" }, { status: 503 }))

      const response = await appWith(fetch, off)(request(), info)

      expect(response.status).toBe(503)
      const page = await response.text()
      expect(page).toContain("The newsletter is off")
      expect(page).toMatch(/<h1\b[^>]*>The Seed newsletter<\/h1>/)
      expect(page.match(/<a [^>]*data-e2e="newsletter-off-releases"[^>]*>/)?.[0]).toContain(
        `href="${REPOSITORY_URL}/releases"`,
      )
      expect(page).toContain(`data-e2e="site-brand"`)
      expect(page).not.toContain("<form")
      expect(page).not.toContain("Try again in a minute")
      expect(calls).toEqual([])
    })
  }

  it("takes the API's word that subscriptions are off before the first page, wired as the website starts", async () => {
    const asked: string[] = []
    const api = ((input: string | URL | Request) => {
      asked.push(new URL(new Request(input).url).pathname)
      return Promise.resolve(Response.json({ enabled: false }))
    }) as typeof globalThis.fetch

    const handler = new App<State>()
      .use(await newsletterPageMiddleware(config, api))
      .get("/subscribe", subscribe.GET!)
      .handler()
    const response = await handler(new Request(`${config.webAppOrigin}/subscribe`), info)

    expect(response.status).toBe(503)
    const page = await response.text()
    expect(page).toContain("The newsletter is off")
    expect(page).not.toContain("<form")
    expect(asked).toEqual(["/api/subscribers"])
  })
})

describe("an MPA on its own domain", () => {
  const ownDomain = { ...config, webAppOrigin: "https://www.example.com" }

  /** An app whose one action calls the API, with a fake API that records each call's headers. */
  function ownDomainApp() {
    const seen: Headers[] = []
    const fetch = (input: string | URL | Request, init?: RequestInit) => {
      seen.push(new Request(input, init).headers)
      return Promise.resolve(Response.json({}))
    }
    const handler = new App<State>()
      .use(pageMiddleware(ownDomain, fetch as typeof globalThis.fetch, () => true))
      .post("/act", async (ctx) => {
        await ctx.state.api.call("POST", "/api/subscribers")
        return new Response(null, { status: 204 })
      })
      .handler()
    const post = (headers: Record<string, string>) =>
      handler(new Request(`${ownDomain.webAppOrigin}/act`, { method: "POST", headers }), info)
    return { seen, post }
  }

  it("presents its own posts to the API as coming from the API's origin", async () => {
    const { seen, post } = ownDomainApp()

    const response = await post({ origin: ownDomain.webAppOrigin, "sec-fetch-site": "same-origin" })

    expect(response.status).toBe(204)
    expect(seen[0].get("origin")).toBe(ownDomain.apiOrigin)
    expect(seen[0].get("sec-fetch-site")).toBe("same-origin")
  })

  it("refuses a post from the API's origin before calling the API", async () => {
    const { seen, post } = ownDomainApp()

    const response = await post({ origin: ownDomain.apiOrigin, "sec-fetch-site": "same-origin" })

    expect(response.status).toBe(403)
    expect(seen).toEqual([])
  })

  it(`links "Try the demo" to the app's /try at DOMAIN, not to the website's own host`, async () => {
    const response = await new App<State>()
      .use(pageMiddleware(ownDomain, fakeApi(() => Response.json({})).fetch, () => true))
      .get("/subscribe", subscribe.GET!)
      .handler()(new Request(`${ownDomain.webAppOrigin}/subscribe`), info)

    const page = await response.text()
    expect(page).toMatch(
      new RegExp(`<a [^>]*href="${ownDomain.apiOrigin}/try"[^>]*>Try the demo</a>`),
    )
    expect(page).not.toContain(`href="${ownDomain.webAppOrigin}/try"`)
  })

  it("passes an origin of null on unchanged for the API to judge", async () => {
    const { seen, post } = ownDomainApp()

    await post({ origin: "null", "sec-fetch-site": "same-origin" })

    expect(seen[0].get("origin")).toBe("null")
  })
})

describe("staticFilesMiddleware", () => {
  /** An app in production mode whose build holds one static file, `/shots/home.webp`. */
  function staticApp() {
    const app = new App<State>().use(staticFilesMiddleware())
    setBuildCache(app, {
      root: ".",
      islandRegistry: new Map(),
      clientEntry: "",
      features: { errorOverlay: false },
      getFsRoutes: () => [],
      getEntryAssets: () => [],
      readFile: (pathname) =>
        Promise.resolve(
          pathname === "/shots/home.webp"
            ? {
              hash: "home",
              size: 4,
              contentType: "image/webp",
              readable: new Uint8Array(4),
              close: () => {},
            }
            : null,
        ),
    }, "production")
    return app.handler()
  }

  it("sends a file whose address carries the build id as immutable for a year", async () => {
    const response = await staticApp()(
      new Request(`${config.webAppOrigin}${asset("/shots/home.webp")}`),
      info,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
  })

  it("sends a file whose address has no build id for an hour, never as immutable", async () => {
    const response = await staticApp()(
      new Request(`${config.webAppOrigin}/shots/home.webp`),
      info,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe(UNVERSIONED_FILE_CACHE)
    expect(UNVERSIONED_FILE_CACHE).toBe("public, max-age=3600")
  })
})
