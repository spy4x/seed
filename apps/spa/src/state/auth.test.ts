import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import { type User, UserMFAStatus } from "@domain/identity"
import {
  bootstrapSession,
  deleteAccount,
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

    expect(await totpDisconnect()).toEqual({ ok: true })

    expect(sessionState.value.user?.mfa).toBe(UserMFAStatus.NOT_CONFIGURED)
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
