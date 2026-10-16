import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type ApiToken, ApiTokenAccess } from "@domain/api-tokens"
import {
  type ApiTokensDependencies,
  CREATE_FAILURE,
  createApiTokensStore,
  NAME_MISSING,
  PASSWORD_MISSING,
} from "./api-tokens.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"

const token: ApiToken = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111009",
  name: "Zapier",
  groupId,
  groupName: "Personal",
  access: ApiTokenAccess.READ,
  createdAt: "2026-10-04T10:00:00.000Z",
  expiresAt: "2027-01-02T10:00:00.000Z",
  lastUsedAt: null,
}

function store(overrides: Partial<ApiTokensDependencies> = {}, calls: unknown[][] = []) {
  return createApiTokensStore({
    list: () => (calls.push(["list"]), Promise.resolve({ ok: true, data: { tokens: [token] } })),
    create: (request) => (
      calls.push(["create", request]),
        Promise.resolve({ ok: true, data: { token, secret: "tpl_secret" } })
    ),
    revoke: (id) => (calls.push(["revoke", id]), Promise.resolve({ ok: true, data: null })),
    ...overrides,
  })
}

describe("API tokens store", () => {
  it("opens the form empty for the given group, read only, for 90 days", () => {
    const tokens = store()
    tokens.setValue("name", "Old")
    tokens.setValue("password", "typed before")
    tokens.startCreate(groupId)

    expect(tokens.values.value).toEqual({
      name: "",
      password: "",
      groupId,
      access: ApiTokenAccess.READ,
      expiresInDays: 90,
    })
  })

  it("sends a trimmed request, keeps the secret until it is dismissed and lists the new token", async () => {
    const calls: unknown[][] = []
    const tokens = store({}, calls)
    tokens.startCreate(groupId)
    tokens.setValue("name", " Zapier ")
    tokens.setValue("password", "correct horse")
    tokens.setValue("access", ApiTokenAccess.WRITE)
    tokens.setValue("expiresInDays", null)
    await tokens.create()

    expect(calls).toEqual([[
      "create",
      {
        name: "Zapier",
        password: "correct horse",
        groupId,
        access: ApiTokenAccess.WRITE,
        expiresInDays: null,
      },
    ]])
    expect(tokens.created.value?.secret).toBe("tpl_secret")
    expect(tokens.tokens.value).toEqual([token])

    tokens.dismissSecret()
    expect(tokens.created.value).toBe(null)
  })

  it("asks for a name when it is blank, and sends nothing", async () => {
    const calls: unknown[][] = []
    const tokens = store({}, calls)
    tokens.startCreate(groupId)
    tokens.setValue("name", "   ")
    tokens.setValue("password", "correct horse")
    await tokens.create()

    expect(calls).toEqual([])
    expect(tokens.errors.value.name).toBe(NAME_MISSING)
  })

  it("keeps a name that is too long on the page with its message as a sentence, and sends nothing", async () => {
    const calls: unknown[][] = []
    const tokens = store({}, calls)
    tokens.startCreate(groupId)
    tokens.setValue("name", "x".repeat(500))
    tokens.setValue("password", "correct horse")
    await tokens.create()

    expect(calls).toEqual([])
    expect(tokens.errors.value.name).toMatch(/^Name must be .*characters\.$/)
  })

  it("asks for the password on its field and sends nothing without one", async () => {
    const calls: unknown[][] = []
    const tokens = store({}, calls)
    tokens.startCreate(groupId)
    tokens.setValue("name", "Zapier")
    await tokens.create()

    expect(calls).toEqual([])
    expect(tokens.errors.value).toEqual({
      list: null,
      name: null,
      password: PASSWORD_MISSING,
      form: null,
    })
  })

  it("names an empty name and a missing password together, on the first try", async () => {
    const calls: unknown[][] = []
    const tokens = store({}, calls)
    tokens.startCreate(groupId)
    await tokens.create()

    expect(calls).toEqual([])
    expect(tokens.errors.value.name).toBe(NAME_MISSING)
    expect(tokens.errors.value.password).toBe(PASSWORD_MISSING)
  })

  it("shows a wrong password on its field, keeps what was typed and clears it on the next try", async () => {
    let wrong = true
    const tokens = store({
      create: () =>
        Promise.resolve(
          wrong
            ? { ok: false, error: "Wrong password", status: 400, code: "PASSWORD_INVALID" }
            : { ok: true, data: { token, secret: "tpl_secret" } },
        ),
    })
    tokens.startCreate(groupId)
    tokens.setValue("name", "Zapier")
    tokens.setValue("password", "not it")
    await tokens.create()

    expect(tokens.errors.value.password).toBe("Wrong password")
    expect(tokens.errors.value.form).toBe(null)
    expect(tokens.values.value.password).toBe("not it")
    expect(tokens.created.value).toBe(null)

    wrong = false
    tokens.setValue("password", "correct horse")
    await tokens.create()
    expect(tokens.errors.value.password).toBe(null)
    expect(tokens.created.value?.secret).toBe("tpl_secret")
  })

  it("forgets the password once the token exists", async () => {
    const tokens = store()
    tokens.startCreate(groupId)
    tokens.setValue("name", "Zapier")
    tokens.setValue("password", "correct horse")
    await tokens.create()

    expect(tokens.values.value.password).toBe("")
  })

  it("shows the API's refusal under the form and keeps no secret", async () => {
    const tokens = store({ create: () => Promise.resolve({ ok: false, error: "Too many tokens" }) })
    tokens.startCreate(groupId)
    tokens.setValue("name", "Zapier")
    tokens.setValue("password", "correct horse")
    await tokens.create()

    expect(tokens.errors.value.form).toBe("Too many tokens")
    expect(tokens.errors.value.password).toBe(null)
    expect(tokens.created.value).toBe(null)
    expect(tokens.pending.value.create).toBe(false)
  })

  it("says the create failed when the API gave no message of its own", async () => {
    const tokens = store({ create: () => Promise.resolve({ ok: false, error: "" }) })
    tokens.startCreate(groupId)
    tokens.setValue("name", "Zapier")
    tokens.setValue("password", "correct horse")
    await tokens.create()

    expect(tokens.errors.value.form).toBe(CREATE_FAILURE)
  })

  it("reads the list again after a revoke, and keeps a failed revoke's message", async () => {
    const calls: unknown[][] = []
    const tokens = store({}, calls)
    expect(await tokens.revoke(token.id)).toBe(true)
    expect(calls).toEqual([["revoke", token.id], ["list"]])

    const failing = store({
      revoke: () => Promise.resolve({ ok: false, error: "Token not found" }),
    })
    expect(await failing.revoke(token.id)).toBe(false)
    expect(failing.errors.value.list).toBe("Token not found")
    expect(failing.pending.value.revoke).toBe(false)
  })
})
