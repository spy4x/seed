import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createNewsletterStatus } from "./newsletter.ts"

/** A fake API whose next answer is `api.answer()`, and which counts the questions it gets. */
function fakeApi(first: () => Promise<Response>) {
  const api = { answer: first, asked: [] as string[] }
  const fetch = ((input: string | URL | Request) => {
    api.asked.push(new Request(input).url)
    return api.answer()
  }) as typeof globalThis.fetch
  return { api, fetch }
}

const says = (enabled: boolean) => () => Promise.resolve(Response.json({ enabled }))
const down = () => Promise.reject(new TypeError("connection refused"))

describe("createNewsletterStatus", () => {
  it("counts the newsletter as on before the API has answered, then takes the API's answer", async () => {
    const { api, fetch } = fakeApi(says(false))
    const status = createNewsletterStatus({ apiUrl: "http://api:8000", fetch })

    expect(status.isOn()).toBe(true)
    await status.refresh()

    expect(status.isOn()).toBe(false)
    expect(api.asked).toEqual(["http://api:8000/api/subscribers"])
  })

  it("asks the API again only once its answer is older than the ttl, without holding the page up", async () => {
    let clock = 0
    const { api, fetch } = fakeApi(says(false))
    const status = createNewsletterStatus({
      apiUrl: "http://api:8000",
      fetch,
      now: () => clock,
      ttlMs: 60_000,
    })
    await status.refresh()

    api.answer = says(true)
    clock = 59_999
    expect(status.isOn()).toBe(false)
    expect(api.asked).toHaveLength(1)

    clock = 60_000
    // The old answer at once; the new one is being fetched.
    expect(status.isOn()).toBe(false)
    expect(status.isOn()).toBe(false)
    expect(api.asked).toHaveLength(2)
    await status.refresh()
    expect(api.asked).toHaveLength(2)
    expect(status.isOn()).toBe(true)
  })

  it("keeps the last answer when the API is down or answers something else", async () => {
    let clock = 0
    const { api, fetch } = fakeApi(says(false))
    const status = createNewsletterStatus({
      apiUrl: "http://api:8000",
      fetch,
      now: () => clock,
      ttlMs: 1,
    })
    await status.refresh()

    for (
      const answer of [
        down,
        () => Promise.resolve(new Response("Not found", { status: 404 })),
        () => Promise.resolve(Response.json({ enabled: true }, { status: 500 })),
        () => Promise.resolve(Response.json({ enabled: "yes" })),
      ]
    ) {
      api.answer = answer
      clock += 1
      await status.refresh()
      expect(status.isOn()).toBe(false)
    }
  })

  it("stops waiting for an API that never answers once the time limit is over, and keeps the last answer", async () => {
    // Never answers by itself: it ends only when the caller aborts the request.
    const silent =
      ((_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))
        })) as typeof globalThis.fetch
    const status = createNewsletterStatus({
      apiUrl: "http://api:8000",
      fetch: silent,
      timeoutMs: 1,
    })

    await status.refresh()

    expect(status.isOn()).toBe(true)
  })

  it("counts the newsletter as on when the API was never reached", async () => {
    const { fetch } = fakeApi(down)
    const status = createNewsletterStatus({ apiUrl: "http://api:8000", fetch })

    await status.refresh()

    expect(status.isOn()).toBe(true)
  })
})
