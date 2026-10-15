import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import {
  ADMIN_NO_FILTER,
  type AdminUserDetail,
  type AdminUserFilter,
  type User,
  UserMFAStatus,
  UserRole,
} from "@domain/identity"
import { type AdminApi, type AdminApiResult, createAdminStore } from "./state.ts"

const operator = {
  id: 7,
  firstName: "Olga",
  lastName: "Operator",
  role: UserRole.OPERATOR,
  mfa: UserMFAStatus.NOT_CONFIGURED,
} as User

const detail = { user: { id: 42 } } as AdminUserDetail

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
    list: (filter) => (calls.push(["list", filter]),
      answers.list?.(filter) ??
        Promise.resolve(ok({ users: [], total: 0, page: filter.page, pageSize: 25 }))),
    detail: (
      userId,
    ) => (calls.push(["detail", userId]), answers.detail?.(userId) ?? Promise.resolve(ok(detail))),
    act: (
      userId,
      action,
    ) => (calls.push(["act", userId, action]),
      answers.act?.(userId, action) ?? Promise.resolve(ok({ user: detail.user }))),
  }
  return { api, calls }
}

/** A store signed in as the operator, with person 42 open and the block dialog showing. */
async function withDialog(api: AdminApi) {
  const store = createAdminStore(api)
  store.session.value = { step: "signed-in", user: operator, busy: false, error: null }
  await store.loadPerson(42)
  store.openDialog("block")
  return store
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

it("a 401 from the list signs the page out, as when the operator was blocked", async () => {
  const { api } = fakeApi({ list: () => Promise.resolve(fail(401, "Unauthorized")) })
  const store = createAdminStore(api)
  await store.start()
  await store.loadList(ADMIN_NO_FILTER)
  expect(store.session.value.step).toBe("credentials")
  expect(store.session.value.user).toBe(null)
})

it("an answer for a filter the page has left is dropped", async () => {
  let answerFirst: (value: AdminApiResult<never>) => void = () => {}
  const first: AdminUserFilter = { ...ADMIN_NO_FILTER, query: "ada" }
  const { api } = fakeApi({
    list: (filter) =>
      filter === first
        ? new Promise((resolve) => answerFirst = resolve)
        : Promise.resolve(ok({ users: [], total: 3, page: 1, pageSize: 25 })),
  })
  const store = createAdminStore(api)
  const late = store.loadList(first)
  await store.loadList(ADMIN_NO_FILTER)
  answerFirst(ok({ users: [], total: 99, page: 1, pageSize: 25 }) as never)
  await late
  expect(store.list.value.list?.total).toBe(3)
  expect(store.list.value.filter).toBe(ADMIN_NO_FILTER)
})

it("a confirmed action asks for no password, closes the dialog and reads the person again", async () => {
  const { api, calls } = fakeApi()
  const store = await withDialog(api)
  await store.act()
  expect(calls.filter(([name]) => name === "act" || name === "detail")).toEqual([
    ["detail", 42],
    ["act", 42, "block"],
    ["detail", 42],
  ])
  expect(store.dialog.value).toEqual({ action: null, error: null, pending: false })
})

it("a refused action keeps the dialog open with the API's message", async () => {
  const message = "You cannot do this to someone whose role is yours or higher"
  const { api } = fakeApi({ act: () => Promise.resolve(fail(403, message)) })
  const store = await withDialog(api)
  await store.act()
  expect(store.dialog.value).toEqual({ action: "block", error: message, pending: false })
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
