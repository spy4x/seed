import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { languages } from "./i18n.ts"
import { type User, UserMFAStatus, UserRole } from "@domain/identity"
import {
  type AdminApi,
  type AdminApiResult,
  adminFetch,
  createAdminStore,
  operatorName,
  readOperatorEmail,
} from "./state.ts"

const operator = {
  id: 7,
  firstName: "Olga",
  lastName: "Operator",
  role: UserRole.OPERATOR,
  mfa: UserMFAStatus.NOT_CONFIGURED,
} as User

const ok = <T>(data: T, status = 200) => ({ ok: true, status, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

/** An API that answers each call from `answers` and records what it was asked. */
function fakeApi(answers: Partial<AdminApi> = {}) {
  const calls: unknown[][] = []
  const api: AdminApi = {
    me: () => (calls.push(["me"]), answers.me?.() ?? Promise.resolve(ok(operator))),
    signIn: (
      credentials,
    ) => (calls.push(["signIn", credentials]),
      answers.signIn?.(credentials) ?? Promise.resolve(ok(operator))),
    oneTimeCode: (
      otp,
    ) => (calls.push(["oneTimeCode", otp]),
      answers.oneTimeCode?.(otp) ?? Promise.resolve(ok(operator))),
    signOut: () => (calls.push(["signOut"]), Promise.resolve(ok({}))),
    fetch: <T>(
      path: string,
      init?: RequestInit,
    ) => (calls.push(["fetch", path, init?.method]),
      (answers.fetch<T>?.(path, init) ?? Promise.resolve(ok({}))) as Promise<AdminApiResult<T>>),
  }
  return { api, calls }
}

it("a session the cookie holds signs the operator in at start", async () => {
  const store = createAdminStore(fakeApi().api)
  await store.start()
  expect(store.session.value).toEqual({
    step: "signed-in",
    user: operator,
    busy: false,
    error: null,
  })
})

it("a session that owes its code asks for it, and a missing one asks for the password", async () => {
  const pending = createAdminStore(
    fakeApi({ me: () => Promise.resolve(ok({ secondFactor: "Pending" as const }, 202)) }).api,
  )
  await pending.start()
  expect(pending.session.value.step).toBe("one-time-code")

  const none = createAdminStore(
    fakeApi({ me: () => Promise.resolve(fail(401, "Unauthorized")) }).api,
  )
  await none.start()
  expect(none.session.value.step).toBe("credentials")
})

it("a refused sign-in stays on the password step and shows the API's message", async () => {
  const { api } = fakeApi({ signIn: () => Promise.resolve(fail(401, "Invalid credentials")) })
  const store = createAdminStore(api)
  await store.start()
  store.session.value = { step: "credentials", user: null, busy: false, error: null }
  await store.signIn({ login: "ops@example.com", password: "wrong" })
  expect(store.session.value).toEqual({
    step: "credentials",
    user: null,
    busy: false,
    error: "Invalid credentials",
  })
})

it("a 401 from any module's call signs the page out, as when the operator was blocked", async () => {
  const { api } = fakeApi({ fetch: () => Promise.resolve(fail(401, "Unauthorized")) })
  const store = createAdminStore(api)
  await store.start()
  const result = await store.request(`/api/admin/stats`)
  expect(result.ok).toBe(false)
  expect(store.session.value.step).toBe("credentials")
  expect(store.session.value.user).toBe(null)
})

it("a module's failed call keeps the session and answers the API's message", async () => {
  const { api } = fakeApi({ fetch: () => Promise.resolve(fail(403, "Forbidden")) })
  const store = createAdminStore(api)
  await store.start()
  const result = await store.request(`/api/admin/users/42/block`, { method: "POST" })
  expect(result).toEqual(fail(403, "Forbidden"))
  expect(store.session.value.step).toBe("signed-in")
})

it("a module's call that cannot reach the server answers the general failure", async () => {
  const { api } = fakeApi({ fetch: () => Promise.reject(new TypeError("Failed to fetch")) })
  const store = createAdminStore(api)
  await store.start()
  const result = await store.request(`/api/admin/stats`)
  expect(result).toEqual(fail(0, "Something went wrong. Try again."))
  expect(store.session.value.step).toBe("signed-in")
})

it("signing out ends the session even when the server cannot be reached", async () => {
  const { api } = fakeApi()
  api.signOut = () => Promise.reject(new TypeError("Failed to fetch"))
  const store = createAdminStore(api)
  await store.start()
  await store.signOut()
  expect(store.session.value.step).toBe("credentials")
  expect(store.session.value.user).toBe(null)
})

it("names an operator with no name by their address, and Operator only without one", () => {
  expect(operatorName(operator, `olga@example.com`)).toBe(`Olga Operator`)
  const nameless = { ...operator, firstName: ``, lastName: `` }
  expect(operatorName(nameless, `olga@example.com`)).toBe(`olga@example.com`)
  expect(operatorName(nameless)).toBe(`Operator`)
})

it("reads the operator's address from the API, and none when the call fails", async () => {
  const status = { email: `olga@example.com`, proven: true, pending: null }
  const { api, calls } = fakeApi({ fetch: <T>() => Promise.resolve(ok(status as T)) })
  expect(await readOperatorEmail(api.fetch)).toBe(`olga@example.com`)
  expect(calls).toEqual([[`fetch`, `/api/auth/email`, undefined]])

  const down = fakeApi({ fetch: () => Promise.reject(new TypeError(`Failed to fetch`)) })
  expect(await readOperatorEmail(down.api.fetch)).toBe(null)
})

it("answers a refusal in the operator's language, by its reason", async () => {
  const real = globalThis.fetch
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: { code: "not_found", reason: "GROUP_NOT_FOUND", message: "Group not found" },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    )
  try {
    expect(await languages.use("de")).toBe(true)
    const answer = await adminFetch("/api/admin/groups/g-1")
    expect(answer.ok ? null : [answer.status, answer.error.reason, answer.error.message]).toEqual([
      404,
      "GROUP_NOT_FOUND",
      "Diese Gruppe gibt es nicht, oder du bist nicht mehr darin.",
    ])
  } finally {
    globalThis.fetch = real
    await languages.use("en")
  }
})

it("words a refusal with no reason by its code in Russian, and keeps the server's sentence in English", async () => {
  const real = globalThis.fetch
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { code: "not_found", message: "Group not found" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    )
  try {
    expect(await languages.use("ru")).toBe(true)
    const russian = await adminFetch("/api/admin/groups/g-1")
    expect(russian.ok ? null : russian.error.message).toBe(
      "Этого нет, или у вас нет к этому доступа.",
    )
    expect(await languages.use("en")).toBe(true)
    const english = await adminFetch("/api/admin/groups/g-1")
    expect(english.ok ? null : english.error.message).toBe("Group not found")
  } finally {
    globalThis.fetch = real
    await languages.use("en")
  }
})
