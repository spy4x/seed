import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import { SIGN_IN_LINK_ASKED_ELSEWHERE_CODE, type User, UserMFAStatus } from "@domain/identity"
import {
  bootstrapSession,
  confirmProviderSignUp,
  deleteAccount,
  redeemSignInLink,
  requestSignInLink,
  signIn,
  signOut,
  totpConnectFinish,
  totpDisconnect,
  useFlagStorage,
} from "./auth.ts"
import { sessionState } from "./session.ts"

const realFetch = globalThis.fetch
const user = { id: 1, firstName: "Test", lastName: "User" }

/** What the API sends for `status`: no profile while the second factor is pending. */
function body(status: number) {
  if (status === 401) return { error: "User not signed in" }
  return status === 202 ? { secondFactor: "Pending" } : user
}

/** Makes the next `/api/auth/me` answer with `status` and the user (or an error for 401). */
function meAnswers(status: number) {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(body(status)), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )
}

describe("bootstrapSession", () => {
  // Never read or write the real `localStorage`, which persists between runs.
  beforeEach(() => useFlagStorage(memoryFlags()))
  afterEach(() => {
    useFlagStorage(undefined)
    globalThis.fetch = realFetch
    sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false, isReady: false }
  })

  it("marks the session as owing its second factor when /me answers 202", async () => {
    meAnswers(202)

    await bootstrapSession()

    expect(sessionState.value.isMfaRequired).toBe(true)
    expect(sessionState.value.user).toBeNull()
    expect(sessionState.value.isReady).toBe(true)
  })

  it("clears the second-factor state when /me answers 200", async () => {
    sessionState.value = { ...sessionState.value, isMfaRequired: true }
    meAnswers(200)

    await bootstrapSession()

    expect(sessionState.value.isMfaRequired).toBe(false)
    expect(sessionState.value.user?.id).toBe(1)
  })

  it("leaves no user and no second-factor state when /me answers 401", async () => {
    meAnswers(401)

    await bootstrapSession()

    expect(sessionState.value.user).toBeNull()
    expect(sessionState.value.isMfaRequired).toBe(false)
    expect(sessionState.value.isReady).toBe(true)
  })

  it("opens as the remembered user when the server cannot be reached", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))

    await bootstrapSession(() => ({ id: 5 } as User))

    expect(sessionState.value.user?.id).toBe(5)
    expect(sessionState.value.isReady).toBe(true)
  })

  it("signs the person out when the server cannot be reached and nobody is remembered", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))

    await bootstrapSession(() => null)

    expect(sessionState.value.user).toBeNull()
    expect(sessionState.value.isReady).toBe(true)
  })

  it("ignores the remembered user when the server answers 401", async () => {
    meAnswers(401)

    await bootstrapSession(() => ({ id: 5 } as User))

    expect(sessionState.value.user).toBeNull()
  })

  // What a person meets while the API is replaced by a deploy, or struggles: none of these answers
  // says that the session ended.
  const errorAnswers = [
    { name: "a proxy's 502", status: 502, body: "<html>Bad Gateway</html>", type: "text/html" },
    { name: "a proxy's bare 404", status: 404, body: "404 page not found", type: "text/plain" },
    { name: "a 403", status: 403, body: "<html>Forbidden</html>", type: "text/html" },
    { name: "a 500", status: 500, body: "Internal Server Error", type: "text/plain" },
    {
      name: "a 429",
      status: 429,
      body: JSON.stringify({ error: "Too many requests" }),
      type: "application/json",
    },
  ]
  for (const { name, status, body, type } of errorAnswers) {
    it(`opens as the remembered user when /me answers ${name}`, async () => {
      globalThis.fetch = () =>
        Promise.resolve(new Response(body, { status, headers: { "content-type": type } }))

      await bootstrapSession(() => ({ id: 5 } as User))

      expect(sessionState.value.user?.id).toBe(5)
      expect(sessionState.value.isMfaRequired).toBe(false)
      expect(sessionState.value.isReady).toBe(true)
    })
  }

  // A 2xx that is not the API's: a maintenance page, a captive portal, a misrouted proxy.
  const strangerAnswers = [
    { name: "a 200 with a page", answer: () => new Response("<html>Back soon</html>") },
    { name: "a 200 with an empty object", answer: () => Response.json({}) },
    { name: "a 204", answer: () => new Response(null, { status: 204 }) },
  ]
  for (const { name, answer } of strangerAnswers) {
    it(`opens as the remembered user when /me answers ${name}`, async () => {
      globalThis.fetch = () => Promise.resolve(answer())

      await bootstrapSession(() => ({ id: 5 } as User))

      expect(sessionState.value.user).toEqual({ id: 5 })
      expect(sessionState.value.isReady).toBe(true)
    })

    it(`shows the sign-in page when /me answers ${name} and nobody is remembered`, async () => {
      globalThis.fetch = () => Promise.resolve(answer())

      await bootstrapSession(() => null)

      expect(sessionState.value.user).toBeNull()
      expect(sessionState.value.isReady).toBe(true)
    })
  }

  it("shows the sign-in page when /me answers 502 and nobody is remembered", async () => {
    globalThis.fetch = () => Promise.resolve(new Response("Bad Gateway", { status: 502 }))

    await bootstrapSession(() => null)

    expect(sessionState.value.user).toBeNull()
    expect(sessionState.value.isReady).toBe(true)
  })
})

function memoryFlags() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

describe("a sign-out made while the server was out of reach", () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    useFlagStorage(undefined)
    sessionState.value = { ...sessionState.value, user: null, isReady: false }
  })

  /** Records each request's path; answers with `answer`. */
  function serverThat(answer: (path: string) => Response | Promise<never>) {
    const paths: string[] = []
    globalThis.fetch = (input) => {
      const path = new URL(String(input), "http://x").pathname
      paths.push(path)
      return Promise.resolve(answer(path))
    }
    return paths
  }

  it("is sent before the session is asked for, and the person stays signed out", async () => {
    const flags = memoryFlags()
    flags.setItem("auth:sign-out-owed", "1")
    useFlagStorage(flags)
    const paths = serverThat(() => Response.json(user))

    await bootstrapSession(() => ({ id: 5 } as User))

    expect(paths).toEqual(["/api/auth/sign-out"])
    expect(sessionState.value.user).toBeNull()
    expect(flags.getItem("auth:sign-out-owed")).toBeNull()
  })

  it("is kept while the server is still unreachable, and the remembered user is not used", async () => {
    const flags = memoryFlags()
    useFlagStorage(flags)
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }

    await signOut()
    expect(flags.getItem("auth:sign-out-owed")).toBe("1")

    await bootstrapSession(() => ({ id: 5 } as User))
    expect(flags.getItem("auth:sign-out-owed")).toBe("1")
    expect(sessionState.value.user).toBeNull()
  })

  it("is kept when the server answers the sign-out with an error", async () => {
    const flags = memoryFlags()
    flags.setItem("auth:sign-out-owed", "1")
    useFlagStorage(flags)
    serverThat((path) =>
      path === "/api/auth/sign-out"
        ? Response.json({ error: "Bad Gateway" }, { status: 502 })
        : Response.json(user)
    )

    await bootstrapSession(() => ({ id: 5 } as User))

    expect(flags.getItem("auth:sign-out-owed")).toBe("1")
    expect(sessionState.value.user).toBeNull()
  })

  it("clears the page and owes nothing when the cookie is now another user's", async () => {
    const flags = memoryFlags()
    useFlagStorage(flags)
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    const sent: Headers[] = []
    globalThis.fetch = (_input, init) => {
      sent.push(new Headers(init?.headers))
      return Promise.resolve(
        Response.json({ error: { code: "unauthorized", message: "no" } }, { status: 401 }),
      )
    }

    await signOut()

    expect(sent[0].get("x-realtime-user")).toBe("1")
    expect(sessionState.value.user).toBeNull()
    expect(flags.getItem("auth:sign-out-owed")).toBeNull()
  })

  it("is owed when the server answers the sign-out with an error", async () => {
    const flags = memoryFlags()
    useFlagStorage(flags)
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    serverThat(() => Response.json({ error: "Bad Gateway" }, { status: 502 }))

    await signOut()

    expect(sessionState.value.user).toBeNull()
    expect(flags.getItem("auth:sign-out-owed")).toBe("1")
  })

  it("is remembered until the page closes when the browser blocks storage", async () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError")
      },
    })
    try {
      useFlagStorage(undefined)
      sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
      globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))

      await signOut()

      const paths = serverThat(() => Response.json({ success: true }))
      await bootstrapSession(() => ({ id: 5 } as User))
      expect(paths).toEqual(["/api/auth/sign-out"])
      expect(sessionState.value.user).toBeNull()
    } finally {
      if (real) Object.defineProperty(globalThis, "localStorage", real)
    }
  })

  it("is forgotten once the person signs in again", async () => {
    const flags = memoryFlags()
    flags.setItem("auth:sign-out-owed", "1")
    useFlagStorage(flags)
    serverThat(() => Response.json(user))

    await signIn("ada", "Passw0rd!")

    expect(flags.getItem("auth:sign-out-owed")).toBeNull()
  })
})

describe("signOut", () => {
  afterEach(() => {
    useFlagStorage(undefined)
    globalThis.fetch = realFetch
    sessionState.value = { ...sessionState.value, user: null }
  })

  it("signs the page out even when the server cannot be reached", async () => {
    useFlagStorage(memoryFlags())
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))

    await signOut()

    expect(sessionState.value.user).toBeNull()
  })

  /**
   * Gives the test's `navigator` a service worker whose registration holds one push subscription.
   * `unsubscribe` answers with `settle`; the returned record says whether it was called.
   */
  function browserWithSubscription(settle: () => Promise<boolean>) {
    const record = { unsubscribed: false }
    const subscription = {
      unsubscribe: () => {
        record.unsubscribed = true
        return settle()
      },
    }
    const registration = { pushManager: { getSubscription: () => Promise.resolve(subscription) } }
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: () => Promise.resolve(registration) },
    })
    return record
  }

  /** Lets the chained promises of the push sign-out settle. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

  it("ends this browser's push subscription, also when the server cannot be reached", async () => {
    useFlagStorage(memoryFlags())
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))
    const browser = browserWithSubscription(() => Promise.resolve(true))
    try {
      await signOut()
      await settled()

      expect(browser.unsubscribed).toBe(true)
      expect(sessionState.value.user).toBeNull()
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker")
    }
  })

  it("does not wait for the browser to end its push subscription", async () => {
    useFlagStorage(memoryFlags())
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    globalThis.fetch = () => Promise.resolve(Response.json({ success: true }))
    // A push service that never answers: sign-out must finish anyway.
    const browser = browserWithSubscription(() => new Promise(() => {}))
    try {
      await signOut()
      await settled()

      expect(browser.unsubscribed).toBe(true)
      expect(sessionState.value.user).toBeNull()
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker")
    }
  })

  it("signs out when the browser refuses to read its push subscription", async () => {
    useFlagStorage(memoryFlags())
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    globalThis.fetch = () => Promise.resolve(Response.json({ success: true }))
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: () => Promise.reject(new DOMException("denied", "SecurityError")) },
    })
    try {
      await signOut()
      await settled()

      expect(sessionState.value.user).toBeNull()
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker")
    }
  })
})

describe("confirming a sign-up a provider vouched for", () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
  })

  /** Makes the API answer `status`, and records the method and path of each request. */
  function confirmAnswers(status: number, answer: unknown): string[] {
    const asked: string[] = []
    globalThis.fetch = (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input), "http://x")
      asked.push(`${init?.method ?? "GET"} ${url.pathname}`)
      return Promise.resolve(
        new Response(JSON.stringify(answer), {
          status,
          headers: { "content-type": "application/json" },
        }),
      )
    }
    return asked
  }

  it("signs the page in as the account the server created", async () => {
    const asked = confirmAnswers(201, user)

    expect(await confirmProviderSignUp()).toEqual({ ok: true, mfaRequired: false })

    expect(asked).toEqual(["POST /api/auth/sign-up/confirm"])
    expect(sessionState.value.user?.id).toBe(1)
  })

  it("gives the server's reason and signs nobody in when the sign-up no longer waits", async () => {
    confirmAnswers(400, { error: "This took too long. Start again from the sign-in page." })

    const result = await confirmProviderSignUp()

    expect(result.ok).toBe(false)
    expect(result.error).toBe("This took too long. Start again from the sign-in page.")
    expect(sessionState.value.user).toBeNull()
  })
})

/** Makes every request answer 200 with `{ success: true }`. */
function apiSucceeds() {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
}

describe("two-factor enrolment", () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    sessionState.value = { ...sessionState.value, user: null }
  })

  it("marks the user's authenticator app as connected after the first code", async () => {
    sessionState.value = {
      ...sessionState.value,
      user: { ...user, mfa: UserMFAStatus.CONFIGURATION_NOT_FINISHED } as unknown as User,
    }
    apiSucceeds()

    expect(await totpConnectFinish("123456")).toEqual({ ok: true })

    expect(sessionState.value.user?.mfa).toBe(UserMFAStatus.CONFIGURED)
  })

  it("marks the user's authenticator app as removed after disabling", async () => {
    sessionState.value = {
      ...sessionState.value,
      user: { ...user, mfa: UserMFAStatus.CONFIGURED } as unknown as User,
    }
    apiSucceeds()

    expect(await totpDisconnect({ password: "correct-horse" })).toEqual({ ok: true })

    expect(sessionState.value.user?.mfa).toBe(UserMFAStatus.NOT_CONFIGURED)
  })

  for (const proof of [{ password: "correct-horse" }, { otp: "123456" }]) {
    it(`sends the ${Object.keys(proof)[0]} as the proof for disabling`, async () => {
      const sent: unknown[] = []
      globalThis.fetch = (_input, init) => {
        sent.push(JSON.parse(String(init?.body)))
        return Promise.resolve(Response.json({ success: true }))
      }

      await totpDisconnect(proof)

      expect(sent).toEqual([proof])
    })
  }

  it("keeps the authenticator app and hands back the refusal when the proof is wrong", async () => {
    sessionState.value = {
      ...sessionState.value,
      user: { ...user, mfa: UserMFAStatus.CONFIGURED } as unknown as User,
    }
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ error: "Invalid password" }, { status: 400 }))

    expect(await totpDisconnect({ password: "wrong-horse" })).toEqual({
      ok: false,
      error: "Invalid password",
    })
    expect(sessionState.value.user?.mfa).toBe(UserMFAStatus.CONFIGURED)
  })
})

describe("deleteAccount", () => {
  const sent: { url: string; body: unknown }[] = []

  /** Makes every request answer `status` with `body`, and records what was sent. */
  function apiAnswers(status: number, body: unknown) {
    globalThis.fetch = (input, init) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      )
    }
  }

  beforeEach(() => {
    sent.length = 0
    sessionState.value = { ...sessionState.value, user: user as unknown as User }
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    sessionState.value = { ...sessionState.value, user: null }
  })

  it("signs the page out and returns the day the account goes once the server accepts", async () => {
    apiAnswers(200, { success: true, deleteAfter: "2026-10-11T08:00:00.000Z" })

    const result = await deleteAccount("secret-pass", "123456")

    expect(result).toEqual({ ok: true, deleteAfter: new Date("2026-10-11T08:00:00.000Z") })
    expect(sent).toEqual([
      { url: "/api/auth/account/delete", body: { password: "secret-pass", otp: "123456" } },
    ])
    expect(sessionState.value.user).toBeNull()
  })

  it("leaves the page while still signed in, then signs it out", async () => {
    apiAnswers(200, { success: true, deleteAfter: "2026-10-11T08:00:00.000Z" })
    const signedInOnLeave: boolean[] = []

    await deleteAccount("secret-pass", undefined, () => {
      signedInOnLeave.push(sessionState.value.user !== null)
    })

    expect(signedInOnLeave).toEqual([true])
    expect(sessionState.value.user).toBeNull()
  })

  it("does not leave the page when the server refuses", async () => {
    apiAnswers(400, { error: "Invalid password" })
    let left = 0

    await deleteAccount("wrong", undefined, () => void left++)

    expect(left).toBe(0)
  })

  it("sends no code without two-factor, and keeps the session when groups block it", async () => {
    apiAnswers(409, { error: "You own groups", blockers: [] })

    const result = await deleteAccount("secret-pass")

    expect(result).toEqual({ ok: false, blocked: true, error: "You own groups" })
    expect(sent[0].body).toEqual({ password: "secret-pass" })
    expect(sessionState.value.user?.id).toBe(1)
  })

  it("keeps the session and reports the server's message when the password is refused", async () => {
    apiAnswers(400, { error: "Invalid password" })

    expect(await deleteAccount("wrong")).toEqual({
      ok: false,
      blocked: false,
      error: "Invalid password",
    })
    expect(sessionState.value.user?.id).toBe(1)
  })
})

describe("redeemSignInLink", () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  /** Makes every request answer `status` with the JSON `payload`. */
  function answers(status: number, payload: unknown) {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
      )
  }

  it("tells a link another browser asked for apart from a used link and any other refusal", async () => {
    answers(403, {
      error: {
        code: "forbidden",
        message: "Asked for elsewhere",
        reason: SIGN_IN_LINK_ASKED_ELSEWHERE_CODE,
      },
    })
    expect(await redeemSignInLink("token")).toEqual({ ok: false, askedElsewhere: true })

    answers(410, { error: { code: "not_found", message: "This link no longer works." } })
    expect(await redeemSignInLink("token")).toEqual({ ok: false, refused: true })

    // The origin guard's 403 carries no such code: it stays a failure with the API's words.
    answers(403, { error: { code: "forbidden", message: "Forbidden" } })
    expect(await redeemSignInLink("token")).toEqual({ ok: false, error: "Forbidden" })
  })

  it("passes on no message of a server failure, so the page shows its own", async () => {
    answers(500, {})
    expect(await redeemSignInLink("token")).toEqual({ ok: false, error: undefined })
  })
})

describe("requestSignInLink", () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it("passes on no message of a server failure, and the API's words for a refusal", async () => {
    globalThis.fetch = () => Promise.resolve(new Response("Bad Gateway", { status: 502 }))
    expect(await requestSignInLink("ann@example.com", null)).toEqual({
      ok: false,
      error: undefined,
      field: false,
    })

    globalThis.fetch = () => Promise.resolve(Response.json({ error: "Too many" }, { status: 429 }))
    expect(await requestSignInLink("ann@example.com", null)).toEqual({
      ok: false,
      error: "Too many",
      field: false,
    })
  })
})
