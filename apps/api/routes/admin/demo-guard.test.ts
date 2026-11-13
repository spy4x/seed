/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { isRefusedInDemo } from "./demo-guard.ts"

const ID = `0190f5a1-0000-7000-8000-000000000001`

/** Every operator-area action the public demo's admin account is refused, one real route each. */
const REFUSED: readonly string[] = [
  // The blog: posts, preview, sharing channels and shares (the real website, real social networks).
  `/blog/posts`,
  `/blog/posts/${ID}`,
  `/blog/posts/${ID}/publish`,
  `/blog/posts/${ID}/unschedule`,
  `/blog/posts/${ID}/unpublish`,
  `/blog/posts/${ID}/change-url`,
  `/blog/posts/${ID}/delete`,
  `/blog/preview`,
  `/blog/posts/${ID}/shares`,
  `/blog/posts/${ID}/shares/${ID}/results`,
  `/blog/posts/${ID}/shares/${ID}/retry`,
  `/blog/channels`,
  `/blog/channels/${ID}`,
  `/blog/channels/${ID}/archive`,
  `/blog/channels/${ID}/restore`,
  `/blog/channels/${ID}/delete`,
  // The contact links (the real website's footer).
  `/contact-links`,
  `/contact-links/order`,
  `/contact-links/${ID}`,
  `/contact-links/${ID}/delete`,
  // The catalog (published on the public website, tracking links redirect from it).
  `/catalog/items`,
  `/catalog/items/${ID}`,
  `/catalog/items/${ID}/status`,
  `/catalog/items/${ID}/delete`,
  `/catalog/items/${ID}/links`,
  `/catalog/items/${ID}/photos`,
  `/catalog/items/${ID}/photos/order`,
  `/catalog/items/${ID}/photos/${ID}`,
  `/catalog/items/${ID}/photos/${ID}/delete`,
  `/catalog/categories`,
  `/catalog/categories/order`,
  `/catalog/categories/${ID}`,
  `/catalog/categories/${ID}/delete`,
  `/catalog/sources`,
  `/catalog/sources/order`,
  `/catalog/sources/${ID}`,
  `/catalog/sources/${ID}/delete`,
  // Billing (acts through the server's real provider).
  `/billing/${ID}/refund`,
  `/billing/${ID}/time`,
  `/billing/${ID}/cancel`,
  `/billing/${ID}/undo-cancel`,
  // The newsletter's actions on real subscribers.
  `/newsletter/subscribers/remove`,
  `/newsletter/subscribers/resend`,
  // Jobs (they send mail).
  `/jobs/${ID}/retry`,
  `/jobs/${ID}/run-now`,
  `/jobs/${ID}/cancel`,
  `/jobs/retry-failed`,
  `/jobs/repeating/billing.seat-sync/run-now`,
  // People: role changes and password-reset mail.
  `/users/42/role`,
  `/users/42/password-reset`,
]

/** Operator-area actions on the demo's own data, which the nightly wipe puts back. */
const ALLOWED: readonly string[] = [
  `/users/42/block`,
  `/users/42/unblock`,
  `/users/42/sessions/end`,
  `/users/42/sessions/7/end`,
  `/users/42/guest/delete`,
  `/users/42/telegram/unlink`,
  `/users/42/picture/remove`,
  `/users/42/devices/7/remove`,
  `/api-tokens/${ID}/revoke`,
  `/groups/${ID}/files/${ID}/remove`,
  `/groups/${ID}/invitations/${ID}/revoke`,
  `/groups/${ID}/members/42/remove`,
  `/groups/${ID}/transfer`,
  `/newsletter/subscribers/search`,
  `/newsletter/subscribers/export`,
]

Deno.test("isRefusedInDemo refuses every action that reaches past the demo's own data", () => {
  for (const path of REFUSED) {
    for (const method of [`POST`, `PUT`, `PATCH`, `DELETE`]) {
      expect(isRefusedInDemo(method, `/api/admin${path}`), `${method} ${path}`).toBe(true)
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
      `/api/admin/%62illing/${ID}/refund`,
    ]
  ) {
    expect(isRefusedInDemo(`POST`, path), path).toBe(true)
  }
})

Deno.test("isRefusedInDemo lets the demo's own data be read and changed", () => {
  for (const path of ALLOWED) {
    expect(isRefusedInDemo(`POST`, `/api/admin${path}`), `POST ${path}`).toBe(false)
  }
  for (const path of [`/blog/posts`, `/billing/${ID}`, `/catalog/items`, `/jobs/${ID}`]) {
    expect(isRefusedInDemo(`GET`, `/api/admin${path}`), `GET ${path}`).toBe(false)
    expect(isRefusedInDemo(`HEAD`, `/api/admin${path}`), `HEAD ${path}`).toBe(false)
  }
  expect(isRefusedInDemo(`POST`, `/api/auth/password/check`)).toBe(false)
})
