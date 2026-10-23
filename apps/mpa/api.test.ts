import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createApi, errorMessage } from "./api.ts"

/** A fake API: records the one request it gets and answers with `response`. */
function fakeFetch(response: Response) {
  const seen: Request[] = []
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return Promise.resolve(response)
  }
  return { seen, fetch: fetch as typeof globalThis.fetch }
}

const browserRequest = new Request("https://app.example.com/subscribe", {
  method: "POST",
  headers: {
    cookie: "sessionIdToken=abc",
    origin: "https://app.example.com",
    "sec-fetch-site": "same-origin",
    "user-agent": "test-browser",
    authorization: "Bearer should-not-pass",
    host: "app.example.com",
  },
})

describe("createApi", () => {
  it("passes the browser's origin headers to the API unchanged, and neither its cookie nor anything else of its own", async () => {
    const { seen, fetch } = fakeFetch(Response.json({}))
    const api = createApi({
      apiUrl: "http://api:8000",
      request: browserRequest,
      remoteAddress: "192.0.2.7",
      fetch,
    })

    await api.call("POST", "/api/subscribers", { email: "ada@example.com", list: "news" })

    const [sent] = seen
    expect(sent.url).toBe("http://api:8000/api/subscribers")
    expect(Object.fromEntries(sent.headers)).toEqual({
      "content-type": "application/json",
      origin: "https://app.example.com",
      "sec-fetch-site": "same-origin",
      "user-agent": "test-browser",
      "x-real-ip": "192.0.2.7",
    })
    expect(await sent.json()).toEqual({ email: "ada@example.com", list: "news" })
  })

  it("swaps only the page's own origin for the API's when given origins", async () => {
    const origins = { page: "https://www.example.com", api: "https://app.example.com" }
    const sent = async (origin: string) => {
      const { seen, fetch } = fakeFetch(Response.json({}))
      const request = new Request("https://www.example.com/act", {
        method: "POST",
        headers: { origin },
      })
      await createApi({
        apiUrl: "http://api:8000",
        request,
        remoteAddress: "",
        origins,
        fetch,
      })
        .call("POST", "/api/subscribers")
      return seen[0].headers.get("origin")
    }

    expect(await sent("https://www.example.com")).toBe("https://app.example.com")
    expect(await sent("https://evil.example.net")).toBe("https://evil.example.net")
    expect(await sent("null")).toBe("null")
  })

  it("keeps the client address a proxy in front already set", async () => {
    const { seen, fetch } = fakeFetch(Response.json({}))
    const request = new Request("https://app.example.com/", {
      headers: { "x-real-ip": "198.51.100.4", "x-forwarded-for": "198.51.100.4" },
    })
    const api = createApi({
      apiUrl: "http://api:8000",
      request,
      remoteAddress: "10.0.0.2",
      fetch,
    })

    await api.call("GET", "/api/subscribers/confirm")

    expect(seen[0].headers.get("x-real-ip")).toBe("198.51.100.4")
    expect(seen[0].headers.get("x-forwarded-for")).toBe("198.51.100.4")
  })
})

describe("createApi without an API that answers", () => {
  const tokenRequest = new Request("https://www.example.com/subscribe/confirm")
  const path = "/api/subscribers/confirm?list=news&token=token-from-the-link"

  it("answers 502 when the API cannot be reached, and logs the call without its query", async () => {
    const logged: string[] = []
    const api = createApi({
      apiUrl: "http://api:8000",
      request: tokenRequest,
      remoteAddress: "",
      fetch: (input) =>
        Promise.reject(new TypeError(`error sending request for url (${new Request(input).url})`)),
      log: (line) => logged.push(line),
    })

    expect(await api.call("GET", path)).toEqual({ status: 502, body: null })
    expect(logged).toEqual(["API call failed: GET /api/subscribers/confirm (TypeError)"])
  })

  it("gives up on an API that does not answer within the timeout, with 504", async () => {
    const logged: string[] = []
    /** Never answers; rejects only when the caller aborts, as `fetch` does. */
    const hanging =
      ((_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))
        })) as typeof globalThis.fetch
    const api = createApi({
      apiUrl: "http://api:8000",
      request: tokenRequest,
      remoteAddress: "",
      fetch: hanging,
      timeoutMs: 5,
      log: (line) => logged.push(line),
    })

    expect(await api.call("GET", path)).toEqual({ status: 504, body: null })
    expect(logged).toEqual(["API call failed: GET /api/subscribers/confirm (timeout)"])
  })
})

describe("errorMessage", () => {
  it("reads the message of the API's error body, and the fallback for any other body", () => {
    const conflict = {
      status: 409,
      body: {
        error: { code: "conflict", message: "Changed by someone else", reason: "VERSION_CONFLICT" },
      },
    }
    expect(errorMessage(conflict, "x")).toBe("Changed by someone else")
    expect(errorMessage({ status: 401, body: { error: "Invalid token" } }, "x")).toBe("x")
    expect(errorMessage({ status: 502, body: null }, "Sign in failed")).toBe("Sign in failed")
  })
})
