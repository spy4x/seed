import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import type { SignInMethod } from "@domain/identity"
import {
  createSignInMethodsStore,
  listProviders,
  readPendingSignUp,
  type SignInMethodsHttp,
} from "./sign-in-methods.ts"

const password: SignInMethod = {
  id: 3,
  kind: "password",
  email: "ada@example.com",
  current: true,
  canUnlink: false,
}
const google: SignInMethod = {
  id: 8,
  kind: "google",
  email: "ada@example.com",
  current: false,
  canUnlink: true,
}

const PROOF_UNTIL = "2026-10-13T08:05:00.000Z"

/** A server that holds `methods`, records each call and answers as `answers` says. */
function fakeHttp(
  methods: SignInMethod[],
  answers: Partial<SignInMethodsHttp> = {},
): SignInMethodsHttp & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    list() {
      calls.push("list")
      return answers.list?.() ?? Promise.resolve({
        ok: true,
        methods,
        available: ["github"],
        providerProofUntil: PROOF_UNTIL,
      })
    },
    link(provider, password) {
      calls.push(password === undefined ? `link ${provider}` : `link ${provider} with ${password}`)
      return answers.link?.(provider, password) ??
        Promise.resolve({ ok: true, url: `https://provider.example/${provider}` })
    },
    unlink(methodId, password) {
      calls.push(
        password === undefined ? `unlink ${methodId}` : `unlink ${methodId} with ${password}`,
      )
      return answers.unlink?.(methodId, password) ?? Promise.resolve({ ok: true, signedOut: false })
    },
  }
}

describe("the sign-in methods store", () => {
  it("shows the methods and the providers still to link once the list is read", async () => {
    const store = createSignInMethodsStore(fakeHttp([password, google]))
    expect(store.methods.value).toBe(null)

    await store.load()

    expect(store.methods.value).toEqual([password, google])
    expect(store.available.value).toEqual(["github"])
    expect(store.providerProofUntil.value).toBe(PROOF_UNTIL)
    expect(store.error.value).toBe(null)
  })

  it("keeps the list shown and gives the reason when a read fails", async () => {
    let fail = false
    const http = fakeHttp([password], {
      list: () => fail ? Promise.resolve({ ok: false, error: "Too many requests" }) : undefined!,
    })
    const store = createSignInMethodsStore(http)
    await store.load()
    fail = true

    await store.load()

    expect(store.methods.value).toEqual([password])
    expect(store.loadError.value).toBe("Too many requests")
    expect(store.error.value).toBe(null)
  })

  it("tells a read that cannot reach the server apart from a failed change", async () => {
    let release: () => void = () => {}
    const http = fakeHttp([password], {
      list: () =>
        new Promise((_resolve, reject) => {
          release = () => reject(new TypeError("offline"))
        }),
    })
    const store = createSignInMethodsStore(http)

    const read = store.load()
    expect(store.loading.value).toBe(true)
    release()
    await read

    expect(store.loading.value).toBe(false)
    expect(store.methods.value).toBe(null)
    expect(store.loadError.value).toBe("")
    expect(store.error.value).toBe(null)
  })

  it("clears the read's failure once a read answers", async () => {
    let fail = true
    const http = fakeHttp([password], {
      list: () => fail ? Promise.reject(new TypeError("offline")) : undefined!,
    })
    const store = createSignInMethodsStore(http)
    await store.load()
    expect(store.loadError.value).toBe("")
    fail = false

    await store.load()

    expect(store.loadError.value).toBe(null)
    expect(store.methods.value).toEqual([password])
  })

  it("sends the browser to the provider's page to link it", async () => {
    const left: string[] = []
    const store = createSignInMethodsStore(fakeHttp([password]), (url) => void left.push(url))

    await store.link("github")

    expect(left).toEqual(["https://provider.example/github"])
    expect(store.error.value).toBe(null)
  })

  it("hands the account's password to the server with the link", async () => {
    const http = fakeHttp([password])
    const store = createSignInMethodsStore(http, () => {})

    await store.link("github", "Passw0rd!")

    expect(http.calls).toEqual(["link github with Passw0rd!"])
  })

  it("reads until when the provider sign-in confirms again after a refused link", async () => {
    let until: string | null = PROOF_UNTIL
    const http = fakeHttp([google], {
      list: () =>
        Promise.resolve({ ok: true, methods: [google], available: [], providerProofUntil: until }),
      link: () => Promise.resolve({ ok: false, error: "Sign in with your provider again" }),
    })
    const store = createSignInMethodsStore(http, () => {})
    await store.load()
    until = null

    await store.link("github")

    expect(store.providerProofUntil.value).toBe(null)
    // The refusal stays shown: the read after it does not clear it.
    expect(store.error.value).toBe("Sign in with your provider again")
    expect(store.pending.value).toBe(false)
  })

  it("stays on the page with the reason when a link is refused", async () => {
    const left: string[] = []
    const http = fakeHttp([password], {
      link: () => Promise.resolve({ ok: false, error: "This sign-in method is not available." }),
    })
    const store = createSignInMethodsStore(http, (url) => void left.push(url))

    await store.link("github")

    expect(left).toHaveLength(0)
    expect(store.error.value).toBe("This sign-in method is not available.")
    expect(store.pending.value).toBe(false)
  })

  it("reads the list again after an unlink", async () => {
    const http = fakeHttp([password])
    const store = createSignInMethodsStore(http)

    expect(await store.unlink(8)).toBe("unlinked")

    expect(http.calls).toEqual(["unlink 8", "list"])
    expect(store.methods.value).toEqual([password])
    expect(store.pending.value).toBe(false)
  })

  it("says so when the unlink signed this device out, and reads nothing more", async () => {
    const http = fakeHttp([google], {
      unlink: () => Promise.resolve({ ok: true, signedOut: true }),
    })
    const store = createSignInMethodsStore(http)

    expect(await store.unlink(8)).toBe("signed-out")

    expect(http.calls).toEqual(["unlink 8"])
  })

  it("gives the server's reason when an unlink is refused, and keeps the list", async () => {
    const http = fakeHttp([google], {
      unlink: () => Promise.resolve({ ok: false, error: "This is your only way to sign in." }),
    })
    const store = createSignInMethodsStore(http)
    await store.load()

    expect(await store.unlink(8)).toBe("failed")

    expect(store.error.value).toBe("This is your only way to sign in.")
    expect(store.methods.value).toEqual([google])
    expect(http.calls).toEqual(["list", "unlink 8", "list"])
  })

  it("hands the account's password to the server with the unlink", async () => {
    const http = fakeHttp([password])
    const store = createSignInMethodsStore(http)

    expect(await store.unlink(8, "Passw0rd!")).toBe("unlinked")

    expect(http.calls).toEqual(["unlink 8 with Passw0rd!", "list"])
  })

  it("reads until when the provider sign-in confirms again after a refused unlink", async () => {
    let until: string | null = PROOF_UNTIL
    const http = fakeHttp([google], {
      list: () =>
        Promise.resolve({ ok: true, methods: [google], available: [], providerProofUntil: until }),
      unlink: () => Promise.resolve({ ok: false, error: "Sign in with your provider again" }),
    })
    const store = createSignInMethodsStore(http)
    await store.load()
    until = null

    expect(await store.unlink(8)).toBe("failed")

    expect(store.providerProofUntil.value).toBe(null)
    // The refusal stays shown: the read after it does not clear it.
    expect(store.error.value).toBe("Sign in with your provider again")
    expect(store.pending.value).toBe(false)
  })

  it("reports a failure without a reason when the server cannot be reached", async () => {
    const http = fakeHttp([google], { unlink: () => Promise.reject(new TypeError("offline")) })
    const store = createSignInMethodsStore(http)

    expect(await store.unlink(8)).toBe("failed")

    expect(store.error.value).toBe("")
    expect(store.loadError.value).toBe(null)
    expect(store.pending.value).toBe(false)
  })

  it("starts no second change while one is in flight", async () => {
    let release: () => void = () => {}
    const http = fakeHttp([password, google], {
      unlink: () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, signedOut: false })
        }),
    })
    const store = createSignInMethodsStore(http, () => {})
    const first = store.unlink(8)

    expect(await store.unlink(8)).toBe("failed")
    await store.link("github")
    release()
    await first

    expect(http.calls).toEqual(["unlink 8", "list"])
  })
})

describe("what the sign-in pages read", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  /** Makes every request answer `status` with `body`, and records the paths asked for. */
  function answers(status: number, body: unknown): string[] {
    const asked: string[] = []
    globalThis.fetch = (input) => {
      asked.push(new URL(String(input instanceof Request ? input.url : input), "http://x").pathname)
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      )
    }
    return asked
  }

  it("lists the providers the API says are on", async () => {
    const asked = answers(200, { providers: ["google"] })

    expect(await listProviders()).toEqual(["google"])
    expect(asked).toEqual(["/api/auth/providers"])
  })

  it("shows no provider when the list cannot be read", async () => {
    answers(503, { error: "down" })
    expect(await listProviders()).toEqual([])

    globalThis.fetch = () => Promise.reject(new TypeError("offline"))
    expect(await listProviders()).toEqual([])

    answers(200, "<html>maintenance</html>")
    expect(await listProviders()).toEqual([])
  })

  it("reads the sign-up that waits, and none when the API holds none", async () => {
    const waiting = {
      provider: "google",
      email: "ada@example.com",
      expiresAt: "2026-11-04T08:10Z",
      unconfirmedAccount: false,
    }
    const asked = answers(200, { pending: waiting })
    expect(await readPendingSignUp()).toEqual(waiting)
    expect(asked).toEqual(["/api/auth/sign-up/pending"])

    answers(200, { pending: null })
    expect(await readPendingSignUp()).toBe(null)

    answers(500, { error: "down" })
    expect(await readPendingSignUp()).toBe(null)
  })
})
