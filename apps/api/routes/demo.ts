import { Hono } from "hono"
import type { DemoInfo } from "@domain/identity"
import { DEMO_ADMIN_EMAIL, DEMO_USER_EMAIL } from "@server/auth/demo-accounts.ts"

/**
 * `GET /` answers the public demo's shared accounts and password (docs/demo.md), which both
 * sign-in pages print. The password is public by design. With the demo off it answers 404, so a
 * product started from the template shows nothing.
 */
export function createDemoRoute(
  demo: { password: string | null; appUrl: string; adminUrl: string | null },
): Hono {
  return new Hono().get("/", (c) => {
    if (demo.password === null) return c.json({ error: "Not found" }, 404)
    const body: DemoInfo = {
      userLogin: DEMO_USER_EMAIL,
      adminLogin: DEMO_ADMIN_EMAIL,
      password: demo.password,
      appUrl: demo.appUrl,
      adminUrl: demo.adminUrl,
    }
    return c.json(body, 200, { "cache-control": "no-store" })
  })
}
