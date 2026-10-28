import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { type Context, Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { apiError } from "../_testing/api-error.ts"
import {
  codeForStatus,
  errorResponse,
  libraryRefusals,
  unhandledErrorResponse,
  validationResponse,
} from "./error-response.ts"

/** An app whose `/` runs `handle`, with the request log's id set as the API's app sets it. */
function appWith(handle: (c: Context) => Response | Promise<Response>, requestId?: string) {
  const app = new Hono<{ Variables: { requestId?: string } }>()
  if (requestId) app.use(`*`, (c, next) => (c.set(`requestId`, requestId), next()))
  app.use(`*`, libraryRefusals)
  app.onError((error, c) => unhandledErrorResponse(c, error))
  app.get(`/`, handle)
  return app
}

describe(`errorResponse`, () => {
  it(`answers the status its code stands for, with the request's id and no empty parts`, async () => {
    const app = appWith((c) => errorResponse(c, `not_found`, { message: `Gone` }), `req-1`)

    const response = await app.request(`/`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: `not_found`, message: `Gone`, requestId: `req-1` },
    })
  })

  it(`keeps a status the route names, and the reason and details it gives`, async () => {
    const app = appWith((c) =>
      errorResponse(c, `forbidden`, {
        message: `The group's plan does not include this`,
        reason: `PLAN_FEATURE_MISSING`,
        details: { entitlement: `memberRoles` },
        status: 402,
      })
    )

    const response = await app.request(`/`)

    expect(response.status).toBe(402)
    expect(await apiError(response)).toEqual({
      code: `forbidden`,
      message: `The group's plan does not include this`,
      reason: `PLAN_FEATURE_MISSING`,
      details: { entitlement: `memberRoles` },
    })
  })
})

describe(`validationResponse`, () => {
  it(`names each failed field with its arktype code and rule, never the value sent`, async () => {
    const schema = type({ name: `string`, title: `string <= 3` })
    const app = appWith((c) => {
      const checked = schema({ name: 7, title: `secret-title` })
      return checked instanceof type.errors ? validationResponse(c, checked) : c.text(`ok`)
    })

    const response = await app.request(`/`)
    const error = await apiError(response)

    expect(response.status).toBe(400)
    expect(error).toMatchObject({
      code: `bad_request`,
      reason: `validation`,
      fields: { name: { code: `domain` }, title: { code: `maxLength`, values: { rule: 3 } } },
    })
    expect(JSON.stringify(error.fields)).not.toContain(`secret-title`)
  })
})

describe(`codeForStatus`, () => {
  it(`gives each status the code it stands for`, () => {
    const statuses = [400, 401, 402, 403, 404, 408, 409, 410, 413, 422, 429, 500, 502, 504]
    expect(statuses.map(codeForStatus)).toEqual([
      `bad_request`,
      `unauthorized`,
      `forbidden`,
      `forbidden`,
      `not_found`,
      `timeout`,
      `conflict`,
      `not_found`,
      `bad_request`,
      `bad_request`,
      `rate_limited`,
      `internal`,
      `internal`,
      `timeout`,
    ])
  })
})

describe(`an error no route handled`, () => {
  it(`answers internal with a sentence that names nothing of the failure`, async () => {
    const app = appWith(() => {
      throw new Error(`relation "users" does not exist at /srv/app/db.ts:12`)
    })

    const response = await app.request(`/`)
    const text = await response.clone().text()

    expect(response.status).toBe(500)
    expect(await apiError(response)).toEqual({ code: `internal`, message: `Request failed` })
    expect(text).not.toContain(`users`)
    expect(text).not.toContain(`/srv`)
  })

  it(`keeps an HTTPException's status, message and connection header`, async () => {
    const app = appWith(() => {
      throw new HTTPException(413, {
        message: `Payload Too Large`,
        res: new Response(null, { status: 413, headers: { connection: `close` } }),
      })
    })

    const response = await app.request(`/`)

    expect(response.status).toBe(413)
    expect(response.headers.get(`connection`)).toBe(`close`)
    expect(await apiError(response)).toEqual({ code: `bad_request`, message: `Payload Too Large` })
  })
})

describe(`libraryRefusals`, () => {
  it(`rewrites a shared middleware's { error } refusal, keeping its status, message and headers`, async () => {
    const app = appWith((c) => {
      c.header(`Retry-After`, `30`)
      return c.json({ error: `Too many requests` }, 429)
    }, `req-2`)

    const response = await app.request(`/`)

    expect(response.status).toBe(429)
    expect(response.headers.get(`retry-after`)).toBe(`30`)
    expect(await apiError(response)).toEqual({
      code: `rate_limited`,
      message: `Too many requests`,
      requestId: `req-2`,
    })
  })

  it(`leaves a success, a body that is not JSON and the one error body alone`, async () => {
    const answers = [
      appWith((c) => c.json({ error: `a field of a success` })),
      appWith((c) => c.text(`Not here`, 404)),
      appWith((c) => errorResponse(c, `conflict`, { message: `Taken`, reason: `SLUG_TAKEN` })),
    ]

    const [success, text, own] = await Promise.all(answers.map((app) => app.request(`/`)))

    expect(await success.json()).toEqual({ error: `a field of a success` })
    expect(await text.text()).toBe(`Not here`)
    expect(await apiError(own)).toEqual({
      code: `conflict`,
      message: `Taken`,
      reason: `SLUG_TAKEN`,
    })
  })
})
