import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { DEFAULT_PREFERENCES, UserRole, type VersionedPreferences } from "@domain/identity"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  sameOriginHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import { createAdminOwnPreferencesRoute } from "./own-preferences.ts"

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

function buildApp(role: UserRole) {
  const asked: number[] = []
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules: [
      createAdminOwnPreferencesRoute({
        limit: passThrough,
        read: (userId): Promise<VersionedPreferences> => {
          asked.push(userId)
          return Promise.resolve({
            version: 2,
            value: { ...DEFAULT_PREFERENCES, timeZone: `Europe/Berlin` },
          })
        },
      }),
    ],
  })
  const app = mountRoute(`/admin`, route, buildAuthData({ user: { id: 7, role } }))
  return { app, asked }
}

describe(`the operator's own preferences in the operator area`, () => {
  it(`answers the signed-in operator's own record, never another person's`, async () => {
    const { app, asked } = buildApp(UserRole.OPERATOR)

    const response = await app.request(`${API_URL}/admin/me/preferences`, {
      headers: sameOriginHeaders,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      version: 2,
      value: { ...DEFAULT_PREFERENCES, timeZone: `Europe/Berlin` },
    })
    expect(asked).toEqual([7])
  })

  it(`answers 404 to a viewer and reads nothing`, async () => {
    const { app, asked } = buildApp(UserRole.VIEWER)

    const response = await app.request(`${API_URL}/admin/me/preferences`, {
      headers: sameOriginHeaders,
    })

    expect(response.status).toBe(404)
    expect(asked).toEqual([])
  })
})
