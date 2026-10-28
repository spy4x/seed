import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../_testing/mutation-requests.ts"
import { MALFORMED_JSON, oversizedJson } from "../_testing/json-bodies.ts"
import { createUsersRoute } from "./users.ts"
import { AccessError } from "@domain/identity"
import { SECOND_FACTOR_REQUIRED } from "@spy4x/server/sign-in"
import { apiError } from "../_testing/api-error.ts"

function buildApp(
  auth: APIContext["Variables"]["auth"] = buildAuthData(),
  getProfileError: Error | null = null,
) {
  const calls: string[] = []
  const route = createUsersRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    getProfile: () => (
      calls.push("getProfile"),
        getProfileError
          ? Promise.reject(getProfileError)
          : Promise.resolve({ user: buildAuthData().user })
    ),
    updateProfile: () => (
      calls.push("updateProfile"), Promise.resolve({ user: buildAuthData().user })
    ),
  })
  return { app: mountRoute("/users", route, auth), calls }
}

function patchProfile(
  app: ReturnType<typeof buildApp>["app"],
  headers: Readonly<Record<string, string>>,
) {
  return app.request(`${API_URL}/users/me`, {
    method: "PATCH",
    headers: { ...headers },
    body: JSON.stringify({ firstName: "Ada", lastName: "Lovelace" }),
  })
}

describe("users routes", () => {
  it("refuses a cross-site PATCH /users/me with 403", async () => {
    const { app, calls } = buildApp()
    const response = await patchProfile(app, crossSiteHeaders)

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it("accepts a same-origin PATCH /users/me through the TLS proxy", async () => {
    const { app, calls } = buildApp()
    const response = await patchProfile(app, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(calls).toEqual(["updateProfile"])
  })

  it("answers 400 naming the field for a NUL or half a surrogate pair in a name", async () => {
    for (const [field, value] of [["firstName", "A\u0000da"], ["lastName", "Love\ud800lace"]]) {
      const { app, calls } = buildApp()
      const response = await app.request(`${API_URL}/users/me`, {
        method: "PATCH",
        headers: { ...sameOriginHeaders },
        body: JSON.stringify({ firstName: "Ada", lastName: "Lovelace", [field]: value }),
      })

      expect(response.status).toBe(400)
      expect((await apiError(response)).message).toContain(
        `${field} must be free of NUL and broken characters`,
      )
      expect(calls).toEqual([])
    }
  })

  it("answers PATCH /users/me without a session with 401, not 403", async () => {
    const { app, calls } = buildApp(null)
    const response = await patchProfile(app, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })

  it("answers GET /users/me with 401 when the session gate refuses the query", async () => {
    const { app } = buildApp(
      buildAuthData(),
      new AccessError("MFA_REQUIRED", "Second factor has not been completed for this session"),
    )
    const response = await app.request(`${API_URL}/users/me`)

    expect(response.status).toBe(401)
    expect((await apiError(response)).message).toBe(SECOND_FACTOR_REQUIRED)
  })

  it("still answers GET /users/me with 500 for any other failure", async () => {
    const { app } = buildApp(buildAuthData(), new Error("database down"))
    const response = await app.request(`${API_URL}/users/me`)

    expect(response.status).toBe(500)
  })
})

describe("users routes cap the JSON body", () => {
  for (
    const [name, body, status] of [
      ["an oversized body", oversizedJson({ firstName: "Ada", lastName: "Lovelace" }), 413],
      ["malformed JSON", MALFORMED_JSON, 400],
    ] as const
  ) {
    it(`answers ${name} on PATCH /users/me with ${status}`, async () => {
      const { app, calls } = buildApp()
      const response = await app.request(`${API_URL}/users/me`, {
        method: "PATCH",
        headers: { ...sameOriginHeaders },
        body,
      })

      expect(response.status).toBe(status)
      expect(calls).toEqual([])
    })
  }
})
