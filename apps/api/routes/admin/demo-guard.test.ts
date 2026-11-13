/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { isRefusedInDemo } from "./demo-guard.ts"

Deno.test("isRefusedInDemo refuses the actions that reach past the demo's own data", () => {
  for (
    const path of [
      `/api/admin/blog/posts`,
      `/api/admin/blog/posts/0190f5a1-0000-7000-8000-000000000001`,
      `/api/admin/contact-links`,
      `/api/admin/contact-links/0190f5a1-0000-7000-8000-000000000001`,
      `/api/admin/newsletter/subscribers/remove`,
      `/api/admin/newsletter/subscribers/resend`,
      `/api/admin/jobs/0190f5a1-0000-7000-8000-000000000001/retry`,
      `/api/admin/users/42/role`,
      `/api/admin/users/42/password-reset`,
    ]
  ) {
    for (const method of [`POST`, `PUT`, `PATCH`, `DELETE`]) {
      expect(isRefusedInDemo(method, path), `${method} ${path}`).toBe(true)
    }
  }
})

Deno.test("isRefusedInDemo sees through encoded, doubled, trailing and upper-case slashes", () => {
  for (
    const path of [
      `/api/admin//blog/posts`,
      `/api/admin/blog%2Fposts`,
      `/api/admin/users/42/role/`,
      `/api/admin/Contact-Links`,
      `/api/admin/users/42/%72ole`,
    ]
  ) {
    expect(isRefusedInDemo(`POST`, path), path).toBe(true)
  }
})

Deno.test("isRefusedInDemo lets the demo's own data be read and changed", () => {
  for (
    const [method, path] of [
      [`GET`, `/api/admin/blog/posts`],
      [`HEAD`, `/api/admin/contact-links`],
      [`GET`, `/api/admin/jobs/0190f5a1-0000-7000-8000-000000000001`],
      [`POST`, `/api/admin/users/42/block`],
      [`POST`, `/api/admin/users/42/sessions/end`],
      [`POST`, `/api/admin/billing/subscriptions/1/refund`],
      [`PATCH`, `/api/admin/groups/1`],
      [`POST`, `/api/admin/catalog/items`],
      [`POST`, `/api/admin/newsletter/subscribers/export`],
      [`POST`, `/api/auth/password/check`],
    ]
  ) {
    expect(isRefusedInDemo(method, path), `${method} ${path}`).toBe(false)
  }
})
