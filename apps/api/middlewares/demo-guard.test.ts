/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import type { APIContext } from "../_types.ts"
import type { AppAuthState } from "../services/sign-in.ts"
import {
  createDemoGuard,
  DEMO_ACCOUNT_REFUSAL,
  DEMO_ADDRESS_REFUSAL,
  DEMO_INVITATION_MAIL_REFUSAL,
  DEMO_SIGN_UP_REFUSAL,
  DEMO_TARGET_REFUSAL,
} from "./demo-guard.ts"
import { MAX_JSON_BODY_BYTES } from "../services/json-body.ts"

const DEMO_ID = 7
const PERSON_ID = 8

/** An API with the guard, signed in as `userId`, where every route answers 200. */
function app(userId: number | null) {
  const api = new Hono<APIContext>().basePath("/api")
  api.use("*", async (c, next) => {
    c.set("auth", userId === null ? null : { user: { id: userId } } as unknown as AppAuthState)
    await next()
  })
  api.use(
    "*",
    createDemoGuard((ids) => Promise.resolve(new Set(ids.filter((id) => id === DEMO_ID)))),
  )
  api.all("*", async (c) => {
    // The route can still read the body the guard looked at.
    const body = c.req.method === "POST" ? await c.req.text() : ""
    return c.json({ ok: true, body })
  })
  return api
}

async function call(userId: number | null, method: string, path: string, body?: unknown) {
  const response = await app(userId).request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
  return { status: response.status, body: await response.json() }
}

const OWN_ACCOUNT: [string, string][] = [
  ["POST", "/api/auth/password/change"],
  ["POST", "/api/auth/password/set"],
  ["POST", "/api/auth/email/change"],
  ["POST", "/api/auth/email/send"],
  ["POST", "/api/auth/email/verify"],
  ["POST", "/api/auth/totp/connect/start"],
  ["POST", "/api/auth/totp/connect/finish"],
  ["POST", "/api/auth/totp/disconnect"],
  ["DELETE", "/api/auth/sessions/others"],
  ["DELETE", "/api/auth/sessions/12"],
  ["POST", "/api/auth/account/delete"],
  ["POST", "/api/auth/methods/google/link"],
  ["DELETE", "/api/auth/methods/3"],
]

Deno.test("a shared demo account cannot lock the next visitor out", async () => {
  for (const [method, path] of OWN_ACCOUNT) {
    expect({ method, path, ...(await call(DEMO_ID, method, path)) }).toEqual({
      method,
      path,
      status: 403,
      body: { error: DEMO_ACCOUNT_REFUSAL },
    })
    // Anyone else may.
    expect((await call(PERSON_ID, method, path)).status).toBe(200)
  }
})

Deno.test("a shared demo account still signs out, edits its profile and writes notes", async () => {
  for (
    const [method, path] of [
      ["POST", "/api/auth/sign-out"],
      ["PATCH", "/api/users/me"],
      ["POST", "/api/groups/abc/notes"],
      ["GET", "/api/auth/sessions"],
    ]
  ) {
    expect({ path, status: (await call(DEMO_ID, method, path)).status }).toEqual({
      path,
      status: 200,
    })
  }
})

Deno.test("an operator cannot act on a shared demo account, only on others", async () => {
  for (
    const action of ["role", "block", "unblock", "password-reset", "sessions/end", "sessions/4/end"]
  ) {
    const path = `/api/admin/users/${DEMO_ID}/${action}`
    expect({ action, ...(await call(PERSON_ID, "POST", path)) }).toEqual({
      action,
      status: 403,
      body: { error: DEMO_TARGET_REFUSAL },
    })
    expect((await call(PERSON_ID, "POST", `/api/admin/users/${PERSON_ID}/${action}`)).status)
      .toBe(200)
  }
})

Deno.test("a shared demo account may create an invitation link but not mail one", async () => {
  const path = "/api/groups/abc/invitations"
  expect(await call(DEMO_ID, "POST", path, { sendEmail: true, email: "a@example.com" })).toEqual({
    status: 403,
    body: { error: DEMO_INVITATION_MAIL_REFUSAL },
  })
  const link = await call(DEMO_ID, "POST", path, { sendEmail: false, email: null })
  expect(link.status).toBe(200)
  expect(JSON.parse(link.body.body)).toEqual({ sendEmail: false, email: null })
  expect((await call(PERSON_ID, "POST", path, { sendEmail: true })).status).toBe(200)
})

Deno.test("nobody can give the demo a real address, which its public operator could read", async () => {
  const cases: [number | null, string, string][] = [
    [null, "/api/auth/password/sign-up", DEMO_SIGN_UP_REFUSAL],
    [PERSON_ID, "/api/auth/email/change", DEMO_ADDRESS_REFUSAL],
    [null, "/api/subscribers", DEMO_ADDRESS_REFUSAL],
    [PERSON_ID, "/api/groups/abc/invitations", DEMO_ADDRESS_REFUSAL],
  ]
  for (const [userId, path, error] of cases) {
    for (const email of ["ada@gmail.com", " Ada@Example.org ", "ada@mail.example.com"]) {
      expect({ path, email, ...(await call(userId, "POST", path, { email })) }).toEqual({
        path,
        email,
        status: 403,
        body: { error },
      })
    }
    for (const email of ["ada@example.com", " Ada@EXAMPLE.com "]) {
      expect({ path, email, status: (await call(userId, "POST", path, { email })).status })
        .toEqual({ path, email, status: 200 })
    }
  }
  // An invitation without an address is a link, and passes.
  expect((await call(PERSON_ID, "POST", "/api/groups/abc/invitations", { email: null })).status)
    .toBe(200)
})

Deno.test("reads no more of a huge body than the routes' own cap", async () => {
  const api = new Hono<APIContext>().basePath("/api")
  api.use("*", async (c, next) => {
    c.set("auth", null)
    await next()
  })
  api.use("*", createDemoGuard(() => Promise.resolve(new Set())))
  // The route would accept anything: the 413 must come from the guard.
  api.post("*", (c) => c.json({ ok: true }))

  let pulled = 0
  const chunk = new TextEncoder().encode(`{"email":"${"a".repeat(16 * 1024)}`)
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= 8 * 1024 * 1024) return controller.close()
      pulled += chunk.length
      controller.enqueue(chunk)
    },
  })
  const response = await api.request("/api/auth/password/sign-up", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
    duplex: "half",
  } as RequestInit)
  expect(response.status).toBe(413)
  await response.body?.cancel()
  expect(pulled).toBeLessThan(MAX_JSON_BODY_BYTES * 4)
})

Deno.test("a visitor who is not signed in passes", async () => {
  expect((await call(null, "POST", "/api/auth/password/change")).status).toBe(200)
})
