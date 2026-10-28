import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { ConnectionLostError, RealtimeRequestError } from "@spy4x/realtime"
import type { AvailableCallPort } from "@spy4x/realtime/calls"
import type { User } from "@domain/identity"
import type { apiFetch as sendApi } from "@spy4x/platform/api"
import { apiFetch } from "./api.ts"
import { apiAsUser, canCallAs, createAppCallPort } from "./realtime-call.ts"
import { sessionState } from "./session.ts"
import { languages } from "../i18n.ts"

interface Sent {
  url: string
  headers: Record<string, string>
  body: unknown
}

/** A `fetch` that records each request and answers with the next scripted response. */
function server(answers: [number, unknown][]): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = []
  const fake = ((url: string, init: RequestInit = {}) => {
    sent.push({
      url,
      headers: Object.fromEntries(new Headers(init.headers)),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    })
    const [status, body] = answers.shift() ?? [500, {}]
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )
  }) as unknown as typeof fetch
  return { fetch: fake, sent }
}

const UNAUTHORIZED = { error: { code: "unauthorized", message: "another user" } }

/** A socket port whose calls are recorded and answered by `answer`. */
function socketPort(available: boolean, answer: () => Promise<unknown>) {
  const sent: string[] = []
  const port: AvailableCallPort = {
    isAvailable: () => available,
    command: (name) => (sent.push(name), answer()),
    query: (name) => (sent.push(name), answer()),
  }
  return { port, sent }
}

function signedInAs(id: number) {
  sessionState.value = { ...sessionState.value, user: { id } as User, isMfaRequired: false }
}

afterEach(() => {
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
})

describe("the app's calls port", () => {
  it("posts a command to the call route as the page's user, with its idempotency key", async () => {
    const { fetch, sent } = server([[200, { result: { created: true } }]])
    const port = createAppCallPort({ userId: 7, fetch })

    const result = await port.command("note.create", { title: "A" }, { idempotencyKey: "k-1" })

    expect(result).toEqual({ created: true })
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe("/api/call/note.create")
    expect(sent[0].headers).toMatchObject({ "x-realtime-user": "7", "idempotency-key": "k-1" })
    expect(sent[0].body).toEqual({ title: "A" })
  })

  it("signs the page out when a call over HTTP is answered unauthorized", async () => {
    signedInAs(7)
    const { fetch } = server([[401, UNAUTHORIZED]])
    const port = createAppCallPort({ userId: 7, fetch })

    await expect(port.query("group.list")).rejects.toBeInstanceOf(RealtimeRequestError)

    expect(sessionState.value.user).toBeNull()
  })

  it("signs the page out when a call over the socket is answered unauthorized, and does not ask HTTP", async () => {
    signedInAs(7)
    const { fetch, sent } = server([])
    const socket = socketPort(
      true,
      () => Promise.reject(new RealtimeRequestError("unauthorized", "another user")),
    )
    const port = createAppCallPort({ userId: 7, socket: socket.port, fetch })

    await expect(port.query("group.list")).rejects.toBeInstanceOf(RealtimeRequestError)

    expect(sessionState.value.user).toBeNull()
    expect(socket.sent).toEqual(["group.list"])
    expect(sent).toEqual([])
  })

  it("keeps the page signed in for any other refusal", async () => {
    signedInAs(7)
    const { fetch } = server([[403, { error: { code: "forbidden", message: "no" } }]])
    const port = createAppCallPort({ userId: 7, fetch })

    await expect(port.query("group.list")).rejects.toBeInstanceOf(RealtimeRequestError)

    expect(sessionState.value.user?.id).toBe(7)
  })

  it("calls over the socket while it is open, and over HTTP while it is not", async () => {
    const open = socketPort(true, () => Promise.resolve("over the socket"))
    const closed = socketPort(false, () => Promise.resolve("over the socket"))
    const http = server([[200, { result: "over HTTP" }]])

    const viaSocket = await createAppCallPort({ userId: 7, socket: open.port, fetch: http.fetch })
      .query("group.list")
    const viaHttp = await createAppCallPort({ userId: 7, socket: closed.port, fetch: http.fetch })
      .query("group.list")

    expect([viaSocket, viaHttp]).toEqual(["over the socket", "over HTTP"])
    expect(closed.sent).toEqual([])
    expect(http.sent).toHaveLength(1)
  })

  it("sends a command again over HTTP with the same key when the socket drops under it", async () => {
    const socket = socketPort(true, () => Promise.reject(new ConnectionLostError("dropped")))
    const http = server([[200, { result: { created: true } }]])
    const port = createAppCallPort({ userId: 7, socket: socket.port, fetch: http.fetch })

    const result = await port.command("note.create", { title: "A" }, { idempotencyKey: "k-1" })

    expect(result).toEqual({ created: true })
    expect(http.sent[0].headers["idempotency-key"]).toBe("k-1")
  })
})

describe("refusals in the page's language", () => {
  afterEach(async () => {
    await languages.use("en")
  })

  it("words a call's refusal by its failed field and keeps its code, reason and fields", async () => {
    const fields = { name: { code: "maxLength", values: { rule: 100 } } }
    const socket = socketPort(true, () =>
      Promise.reject(
        new RealtimeRequestError("not_found", "Group not found", { code: "GROUP_NOT_FOUND" }, {
          reason: "GROUP_NOT_FOUND",
          fields,
        }),
      ))
    const port = createAppCallPort({ userId: 7, socket: socket.port, fetch: server([]).fetch })
    expect(await languages.use("ru")).toBe(true)

    const refused: RealtimeRequestError = await port.query("group.list").then(
      () => {
        throw new Error("The call went through")
      },
      (error) => error,
    )

    expect(refused).toBeInstanceOf(RealtimeRequestError)
    expect(refused.message).toBe("Не больше 100 символов.")
    expect([refused.code, refused.reason, refused.fields, refused.details]).toEqual([
      "not_found",
      "GROUP_NOT_FOUND",
      fields,
      { code: "GROUP_NOT_FOUND" },
    ])
  })

  it("words a REST refusal by its reason, and a reasonless one by its code", async () => {
    const answer = (error: { code: string; message: string; reason?: string }) =>
      (() =>
        Promise.resolve({
          ok: false,
          status: 409,
          error: { status: 409, ...error },
        })) as unknown as typeof sendApi
    expect(await languages.use("ru")).toBe(true)

    const named = await apiAsUser(
      "/api/tags",
      {},
      answer({
        code: "conflict",
        reason: "TAG_NAME_TAKEN",
        message: "A tag with this name exists",
      }),
    )
    const plain = await apiAsUser(
      "/api/tags",
      {},
      answer({
        code: "conflict",
        message: "Enter another name",
      }),
    )

    expect(named.ok ? null : named.error.message).toBe("Тег с таким названием уже есть.")
    expect(plain.ok ? null : plain.error.message).toBe(
      "За это время здесь что-то изменилось. Обновите страницу и попробуйте ещё раз.",
    )
  })
})

describe("canCallAs", () => {
  it("is true only for the user the page is signed in as, with a network", () => {
    signedInAs(1)

    expect([canCallAs(1, () => true), canCallAs(2, () => true)]).toEqual([true, false])
  })

  it("is false with no network, and while the second factor is owed", () => {
    signedInAs(1)
    const offline = canCallAs(1, () => false)
    sessionState.value = { ...sessionState.value, isMfaRequired: true }

    expect([offline, canCallAs(1, () => true)]).toEqual([false, false])
  })
})

describe("a read of a REST route", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it("names the user the page was started for", async () => {
    signedInAs(7)
    const { fetch, sent } = server([[200, { groups: [] }]])
    globalThis.fetch = fetch

    const result = await apiAsUser<{ groups: unknown[] }>("/api/groups?limit=50")

    expect(result.ok).toBe(true)
    expect(sent[0].url).toBe("/api/groups?limit=50")
    expect(sent[0].headers["x-realtime-user"]).toBe("7")
  })

  it("signs the page out when the server answers that the session is another user's", async () => {
    signedInAs(7)
    globalThis.fetch = server([[401, UNAUTHORIZED]]).fetch

    const result = await apiAsUser("/api/groups?limit=50")

    expect(result.ok).toBe(false)
    expect(sessionState.value.user).toBeNull()
  })

  it("keeps the page signed in when a read fails for another reason", async () => {
    signedInAs(7)
    globalThis.fetch = server([[404, { error: { code: "GROUP_NOT_FOUND", message: "gone" } }]])
      .fetch

    await apiAsUser("/api/groups/x/notes")

    expect(sessionState.value.user?.id).toBe(7)
  })

  it("names nobody and leaves the second-factor step alone while nobody is signed in", async () => {
    sessionState.value = { ...sessionState.value, user: null, isMfaRequired: true }
    const { fetch, sent } = server([[401, UNAUTHORIZED]])
    globalThis.fetch = fetch

    await apiAsUser("/api/auth/me")

    expect(sent[0].headers["x-realtime-user"]).toBeUndefined()
    expect(sessionState.value.isMfaRequired).toBe(true)
  })

  it("keeps the headers the caller gave beside the user's", async () => {
    signedInAs(7)
    const { fetch, sent } = server([[200, {}]])
    globalThis.fetch = fetch

    await apiAsUser("/api/tokens", { headers: { "x-test": "kept" } })

    expect([sent[0].headers["x-test"], sent[0].headers["x-realtime-user"]]).toEqual(["kept", "7"])
  })
})

describe("the SPA's one REST function", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it("sends every read as the page's user, and signs the page out when one is refused as unauthorized", async () => {
    signedInAs(7)
    const { fetch, sent } = server([[200, {}], [200, {}], [401, UNAUTHORIZED]])
    globalThis.fetch = fetch

    await apiFetch("/api/notifications")
    await apiFetch("/api/tokens", { method: "get" })
    const refused = await apiFetch("/api/auth/sessions")

    expect(sent.map((request) => request.headers["x-realtime-user"])).toEqual(["7", "7", "7"])
    expect(refused.ok).toBe(false)
    expect(sessionState.value.user).toBeNull()
  })

  it("sends every write as the page's user, and signs the page out when one is refused as unauthorized", async () => {
    signedInAs(7)
    const { fetch, sent } = server([[200, {}], [200, {}], [401, UNAUTHORIZED]])
    globalThis.fetch = fetch

    await apiFetch("/api/tokens", { method: "POST", body: "{}" })
    await apiFetch("/api/notifications/read", { method: "put", body: "{}" })
    expect(sessionState.value.user?.id).toBe(7)
    const refused = await apiFetch("/api/tokens/1", { method: "DELETE" })

    expect(sent.map((request) => request.headers["x-realtime-user"])).toEqual(["7", "7", "7"])
    expect(refused.ok).toBe(false)
    expect(sessionState.value.user).toBeNull()
  })

  it("names nobody on a write while nobody is signed in", async () => {
    sessionState.value = { ...sessionState.value, user: null }
    const { fetch, sent } = server([[200, {}]])
    globalThis.fetch = fetch

    await apiFetch("/api/auth/password/check", { method: "POST", body: "{}" })

    expect(sent[0].headers["x-realtime-user"]).toBeUndefined()
  })
})
