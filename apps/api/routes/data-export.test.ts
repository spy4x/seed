import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { DataExportStatus, type DataExportView } from "@domain/identity"
import type { DataExportRequestResult } from "@server/auth/data-export.ts"
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
import { createDataExportRoute, DATA_EXPORT_TOO_SOON } from "./data-export.ts"
import { apiError } from "../_testing/api-error.ts"

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const preparing: DataExportView = {
  id: "019a1b2c-0000-7000-8000-000000000001",
  status: DataExportStatus.Preparing,
  requestedAt: new Date("2026-10-23T10:00:00.000Z"),
  readyAt: null,
  expiresAt: null,
  sizeBytes: null,
  nextRequestAt: new Date(Date.now() + 3_600_000),
}

function buildApp(
  options: {
    result?: DataExportRequestResult
    ready?: boolean
    auth?: APIContext["Variables"]["auth"]
  } = {},
) {
  const calls: unknown[][] = []
  const route = createDataExportRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    limit: passThrough,
    latest: (userId) => (calls.push(["latest", userId]), Promise.resolve(preparing)),
    request: (userId) => {
      calls.push(["request", userId])
      return Promise.resolve(options.result ?? { success: true, output: preparing })
    },
    readyFile: (userId) => {
      calls.push(["readyFile", userId])
      return Promise.resolve(
        options.ready ? { key: `data-exports/${preparing.id}.zip`, filename: "my-data.zip" } : null,
      )
    },
    signDownload: (key, file) => {
      calls.push(["sign", key, file])
      return Promise.resolve(`https://app.example.com/files/${key}?X-Amz-Signature=abc`)
    },
  })
  const auth = options.auth === undefined ? buildAuthData({ user: { id: 7 } }) : options.auth
  return { app: mountRoute("/account/data-export", route, auth), calls }
}

const URL_ = `${API_URL}/account/data-export`

describe("data export route", () => {
  it("asks for an export of the signed-in person only, and answers it with 201", async () => {
    const { app, calls } = buildApp()
    const response = await app.request(URL_, { method: "POST", headers: { ...sameOriginHeaders } })
    expect(response.status).toBe(201)
    expect((await response.json()).export.status).toBe(DataExportStatus.Preparing)
    expect(calls).toEqual([["request", 7]])
  })

  it("refuses a second export within a day with 429, Retry-After and the one already asked for", async () => {
    const { app } = buildApp({ result: { success: false, output: preparing, error: "TOO_SOON" } })
    const response = await app.request(URL_, { method: "POST", headers: { ...sameOriginHeaders } })
    expect(response.status).toBe(429)
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(3500)
    const error = await apiError(response)
    expect(error).toMatchObject({
      code: "rate_limited",
      message: DATA_EXPORT_TOO_SOON,
      reason: "TOO_SOON",
    })
    expect((error.details as { export: { id: string } }).export.id).toBe(preparing.id)
  })

  it("refuses a cross-site request for an export", async () => {
    const { app, calls } = buildApp()
    const response = await app.request(URL_, { method: "POST", headers: { ...crossSiteHeaders } })
    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it("answers 401 without a session and reads nothing", async () => {
    const { app, calls } = buildApp({ auth: null })
    expect((await app.request(URL_)).status).toBe(401)
    expect(calls).toEqual([])
  })

  it("redirects a download of the person's ready file to a signed ZIP URL", async () => {
    const { app, calls } = buildApp({ ready: true })
    const response = await app.request(`${URL_}/download`, { headers: { ...sameOriginHeaders } })
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toContain(`data-exports/${preparing.id}.zip`)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(calls).toEqual([
      ["readyFile", 7],
      ["sign", `data-exports/${preparing.id}.zip`, {
        contentType: "application/zip",
        filename: "my-data.zip",
      }],
    ])
  })

  it("answers 404 for a download when no file is ready, and signs nothing", async () => {
    const { app, calls } = buildApp({ ready: false })
    const response = await app.request(`${URL_}/download`, { headers: { ...sameOriginHeaders } })
    expect(response.status).toBe(404)
    expect(calls).toEqual([["readyFile", 7]])
  })

  it("refuses a download another site starts, before it reads anything", async () => {
    const { app, calls } = buildApp({ ready: true })
    const response = await app.request(`${URL_}/download`, { headers: { ...crossSiteHeaders } })
    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })
})
