import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import type { APIContext } from "../_types.ts"
import { apiError } from "../_testing/api-error.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import { API_URL, mountRoute, testSessionGuards } from "../_testing/mutation-requests.ts"
import { createPictureRoute, PICTURE_NOT_FOUND, PICTURE_REDIRECT_SECONDS } from "./pictures.ts"

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const MINE = `0190a000-0000-7000-8000-0000000000a1`
const THEIRS = `0190a000-0000-7000-8000-0000000000a2`

/** The route over a lookup that lets user 7 see only {@link MINE}. */
function buildApp(auth: APIContext["Variables"]["auth"] = buildAuthData({ user: { id: 7 } })) {
  const calls: unknown[][] = []
  const route = createPictureRoute({
    auth: testSessionGuards(),
    limit: passThrough,
    readable: (pictureId, viewerId) => {
      calls.push([`readable`, pictureId, viewerId])
      return Promise.resolve(
        pictureId === MINE && viewerId === 7
          ? { id: MINE, contentType: `image/webp`, objectKey: `pictures/${MINE}/480.webp` }
          : null,
      )
    },
    signDownload: (key, file) => {
      calls.push([`sign`, key, file])
      return Promise.resolve(`https://app.example.com/files/${key}?X-Amz-Signature=abc`)
    },
  })
  return { app: mountRoute(`/pictures`, route, auth), calls }
}

describe(`GET /api/pictures/:pictureId`, () => {
  it(`redirects a person who may see the picture to a signed URL of the object it is shown as`, async () => {
    const { app, calls } = buildApp()
    const response = await app.request(`${API_URL}/pictures/${MINE}`)
    expect(response.status).toBe(302)
    expect(response.headers.get(`location`)).toBe(
      `https://app.example.com/files/pictures/${MINE}/480.webp?X-Amz-Signature=abc`,
    )
    expect(response.headers.get(`cache-control`)).toBe(
      `private, max-age=${PICTURE_REDIRECT_SECONDS}`,
    )
    expect(calls).toContainEqual([`sign`, `pictures/${MINE}/480.webp`, {
      contentType: `image/webp`,
      filename: `picture`,
    }])
  })

  it(`answers the same 404 for a picture the person may not see and for an id that is no UUID`, async () => {
    const { app, calls } = buildApp()
    for (const id of [THEIRS, `not-an-id`]) {
      const response = await app.request(`${API_URL}/pictures/${id}`)
      expect(response.status).toBe(404)
      const { requestId: _, ...error } = await apiError(response)
      expect(error).toEqual({ code: `not_found`, message: PICTURE_NOT_FOUND })
    }
    expect(calls.filter(([kind]) => kind === `sign`)).toEqual([])
    // An id that is no UUID never reaches the database, where it would not cast.
    expect(calls.filter(([kind]) => kind === `readable`)).toEqual([[`readable`, THEIRS, 7]])
  })

  it(`answers 401 without a session and looks nothing up`, async () => {
    const { app, calls } = buildApp(null)
    expect((await app.request(`${API_URL}/pictures/${MINE}`)).status).toBe(401)
    expect(calls).toEqual([])
  })
})
