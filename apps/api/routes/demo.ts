import { Hono } from "hono"
import type { DemoInfo } from "@domain/identity"
import { DEMO_USER_EMAIL } from "@server/auth/demo-accounts.ts"

/**
 * `GET /` answers the public demo's shared account and password (docs/demo.md), which the
 * product's sign-in page prints. The password is public by design. With the demo off it answers 404, so a
 * product started from the template shows nothing.
 */
export function createDemoRoute(
  demo: { password: string | null },
): Hono {
  return new Hono().get("/", (c) => {
    if (demo.password === null) return c.json({ error: "Not found" }, 404)
    const body: DemoInfo = {
      userLogin: DEMO_USER_EMAIL,
      password: demo.password,
    }
    return c.json(body, 200, { "cache-control": "no-store" })
  })
}
