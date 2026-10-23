import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import {
  type ApiToken,
  ApiTokenAccess,
  type ApiTokenCreateRequest,
  ApiTokenError,
} from "@domain/api-tokens"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../_testing/mutation-requests.ts"
import { createApiTokensRoute } from "./api-tokens.ts"
import { PasswordLockedError } from "../services/password-locked.ts"
import { apiError } from "../_testing/api-error.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const tokenId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111009"

const token: ApiToken = {
  id: tokenId,
  name: "Zapier",
  groupId,
  groupName: "Personal",
  access: ApiTokenAccess.READ,
  createdAt: "2026-10-04T10:00:00.000Z",
  expiresAt: "2027-01-02T10:00:00.000Z",
  lastUsedAt: null,
}

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

function buildApp(
  auth: APIContext["Variables"]["auth"] = buildAuthData({ user: { id: 7 } }),
  refusal: ApiTokenError | PasswordLockedError | null = null,
) {
  const calls: unknown[][] = []
  const route = createApiTokensRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    limit: passThrough,
    passwordLimit: async (c, next) => {
      calls.push(["passwordLimit", c.req.method])
      await next()
    },
    tokens: {
      list: (userId) => (calls.push(["list", userId]), Promise.resolve([token])),
      create: (_c, userId, request: ApiTokenCreateRequest) => {
        calls.push(["create", userId, request])
        return refusal ? Promise.reject(refusal) : Promise.resolve({ token, secret: "tpl_secret" })
      },
      revoke: (
        _c,
        userId,
        id,
      ) => (calls.push(["revoke", userId, id]), Promise.resolve(id === tokenId)),
    },
  })
  return { app: mountRoute("/tokens", route, auth), calls }
}

function post(app: ReturnType<typeof buildApp>["app"], body: unknown, headers = sameOriginHeaders) {
  return app.request(`${API_URL}/tokens`, {
    method: "POST",
    headers: { ...headers },
    body: JSON.stringify(body),
  })
}

const valid = {
  name: "  Zapier ",
  groupId,
  access: ApiTokenAccess.READ,
  expiresInDays: 90,
  password: "correct horse",
}

describe("API token routes", () => {
  it("lists the signed-in person's tokens", async () => {
    const { app, calls } = buildApp()
    const response = await app.request(`${API_URL}/tokens`, { headers: sameOriginHeaders })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ tokens: [token] })
    expect(calls).toEqual([["list", 7]])
  })

  it("creates a token for the signed-in person and answers its secret once, uncached, with 201", async () => {
    const { app, calls } = buildApp()
    const response = await post(app, valid)

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ token, secret: "tpl_secret" })
    expect(calls).toEqual([["passwordLimit", "POST"], ["create", 7, { ...valid, name: "Zapier" }]])
  })

  it("refuses a create without a password and creates nothing", async () => {
    const { app, calls } = buildApp()
    const { password: _password, ...withoutPassword } = valid
    const response = await post(app, withoutPassword)

    expect(response.status).toBe(400)
    expect((await apiError(response)).reason).toBe("INVALID_REQUEST")
    expect(calls.filter(([name]) => name === "create")).toEqual([])
  })

  it("answers a wrong password with 400 and the code the form ties to its field", async () => {
    const { app } = buildApp(undefined, new ApiTokenError("PASSWORD_INVALID", "Wrong password"))
    const response = await post(app, valid)

    expect(response.status).toBe(400)
    expect(await apiError(response)).toMatchObject({
      message: "Wrong password",
      reason: "PASSWORD_INVALID",
    })
  })

  it("answers a create while the account's wrong passwords lock it with 429 and the time to wait", async () => {
    const { app } = buildApp(undefined, new PasswordLockedError(90_500))
    const response = await post(app, valid)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("91")
    expect(await apiError(response)).toMatchObject({
      code: "rate_limited",
      message: "Too many wrong passwords. Try again in 2 minutes.",
      reason: "PASSWORD_LOCKED",
    })
  })

  it("spends the password limit on a create only, never on a list or a revoke", async () => {
    const { app, calls } = buildApp()
    await app.request(`${API_URL}/tokens`, { headers: sameOriginHeaders })
    await app.request(`${API_URL}/tokens/${tokenId}`, {
      method: "DELETE",
      headers: sameOriginHeaders,
    })
    expect(calls.filter(([name]) => name === "passwordLimit")).toEqual([])
  })

  it("refuses an invalid request with a message the web app shows, and creates nothing", async () => {
    const { app, calls } = buildApp()
    const response = await post(app, { ...valid, name: " " })

    expect(response.status).toBe(400)
    const error = await apiError(response)
    expect(typeof error.message).toBe("string")
    expect(error.reason).toBe("INVALID_REQUEST")
    expect(calls.filter(([name]) => name === "create")).toEqual([])
  })

  it("names each field a create request failed on, with its code", async () => {
    const { app, calls } = buildApp()
    const response = await post(app, { ...valid, name: 7 })

    expect(response.status).toBe(400)
    expect(await apiError(response)).toMatchObject({
      code: "bad_request",
      reason: "INVALID_REQUEST",
      fields: { name: { code: "domain" } },
    })
    expect(calls.filter(([name]) => name === "create")).toEqual([])
  })

  it("answers a group the person is not in with 404 and the cap with 409", async () => {
    const notMember = buildApp(undefined, new ApiTokenError("GROUP_NOT_FOUND", "Group not found"))
    expect((await post(notMember.app, valid)).status).toBe(404)

    const full = buildApp(undefined, new ApiTokenError("TOO_MANY_TOKENS", "Too many tokens"))
    const response = await post(full.app, valid)
    expect(response.status).toBe(409)
    expect(await apiError(response)).toMatchObject({
      message: "Too many tokens",
      reason: "TOO_MANY_TOKENS",
    })
  })

  it("revokes one of the person's tokens, and answers 404 for any other id", async () => {
    const { app, calls } = buildApp()
    const revoke = (id: string) =>
      app.request(`${API_URL}/tokens/${id}`, { method: "DELETE", headers: sameOriginHeaders })

    expect((await revoke(tokenId)).status).toBe(200)
    expect((await revoke("7b6d8d6c-1af5-4f04-8ae4-b1ee5d111010")).status).toBe(404)
    expect((await revoke("not-a-uuid")).status).toBe(404)
    expect(calls).toEqual([
      ["revoke", 7, tokenId],
      ["revoke", 7, "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111010"],
    ])
  })

  it("refuses a cross-site create with 403", async () => {
    const { app, calls } = buildApp()
    expect((await post(app, valid, crossSiteHeaders)).status).toBe(403)
    expect(calls).toEqual([])
  })

  it("answers 401 without a session, and while the session still owes its second factor", async () => {
    const signedOut = buildApp(null)
    expect((await signedOut.app.request(`${API_URL}/tokens`)).status).toBe(401)

    const pending = buildApp(buildAuthData({
      user: { mfa: UserMFAStatus.CONFIGURED },
      session: { secondFactor: SecondFactorStatus.Pending },
    }))
    expect((await post(pending.app, valid)).status).toBe(401)
    expect([...signedOut.calls, ...pending.calls]).toEqual([])
  })
})
