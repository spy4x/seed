import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createSubscribersApi, type SubscribersFetch } from "./subscribers.ts"

/** A fake API that answers every call with `answer` and records each request. */
function harness(answer: () => Response | Promise<Response>) {
  const calls: { url: string; method: string; body: string | null }[] = []
  const fetch: SubscribersFetch = async (url, init) => {
    const request = new Request(new URL(url, "http://app.localhost"), init)
    const parsed = new URL(request.url)
    calls.push({
      url: parsed.pathname + parsed.search,
      method: request.method,
      body: init?.body === undefined ? null : await request.text(),
    })
    return answer()
  }
  return { api: createSubscribersApi(fetch), calls }
}

describe("subscribers api", () => {
  it("reads a refused confirm link's state from the reason of its 400", async () => {
    const { api } = harness(() =>
      Response.json(
        { error: { code: "bad_request", message: "This link has expired.", reason: "expired" } },
        { status: 400 },
      )
    )

    expect(await api.previewConfirm("news", "t")).toEqual({ state: "expired" })
  })

  it("keeps the address a link previews, for the page to show", async () => {
    const { api } = harness(() => Response.json({ state: "confirm", email: "ada@example.com" }))

    expect(await api.previewUnsubscribe("news", "t"))
      .toEqual({ state: "confirm", email: "ada@example.com" })
  })

  it("reads a state it does not know, a body that is not JSON and a network failure as error", async () => {
    const limited = harness(() =>
      Response.json(
        { error: { code: "rate_limited", message: "Too many tries.", reason: "limited" } },
        { status: 429 },
      )
    )
    const broken = harness(() => new Response("<html>", { status: 502 }))
    const offline = harness(() => Promise.reject(new TypeError("Failed to fetch")))

    expect(await limited.api.unsubscribe("news", "t")).toEqual({ state: "error" })
    expect(await broken.api.confirm("news", "t")).toEqual({ state: "error" })
    expect(await offline.api.previewConfirm("news", "t")).toEqual({ state: "error" })
  })

  it("sends the unsubscribe token in the form body, never in the address", async () => {
    const { api, calls } = harness(() => Response.json({ state: "done" }))

    expect(await api.unsubscribe("news", "secret-token")).toEqual({ state: "done" })

    expect(calls).toEqual([
      { url: "/api/subscribers/unsubscribe?list=news", method: "POST", body: "token=secret-token" },
    ])
  })

  it("passes on the API's message when it refuses a subscribe", async () => {
    const { api } = harness(() =>
      Response.json(
        { error: { code: "bad_request", message: "Enter a valid e-mail address" } },
        { status: 400 },
      )
    )

    expect(await api.subscribe("nope", "news"))
      .toEqual({ ok: false, error: "Enter a valid e-mail address" })
  })
})
