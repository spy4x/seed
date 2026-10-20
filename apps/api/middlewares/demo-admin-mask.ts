import type { MiddlewareHandler } from "hono"
import { maskEmail } from "@spy4x/platform/universal/text"
import type { APIContext } from "../_types.ts"
import { isExampleAddress } from "./demo-guard.ts"

/**
 * Anything shaped like an address: a run of characters an address may hold, `@`, then a domain.
 * It is wider than a real address on purpose, so a mask hides too much rather than too little.
 */
const ADDRESS = /[\p{L}\p{N}._%+\-!#$&'*/=?^`{|}~]+@[\p{L}\p{N}.\-]+/gu

/** Masks every address in `text` that is not at example.com: `ada@gmail.com` gives `a***@g***.com`. */
export function maskRealAddresses(text: string): string {
  return text.replace(
    ADDRESS,
    (address) => isExampleAddress(address) ? address : maskEmail(address, { domain: true }),
  )
}

/** The answers that can carry an address: JSON and CSV. */
const MASKED_TYPES = /^(application\/json|text\/csv)\b/i

/**
 * Hides real people's addresses from the public demo's operator (docs/demo.md), mounted only while
 * `DEMO_MODE` is on. The operator's password is printed on the sign-in page, so every answer of
 * the admin API, the CSV exports included, has each address outside example.com masked. It works
 * on the whole answer, so a new admin screen needs no change. The demo's made-up people stay
 * readable, and `createDemoGuard` keeps the operator from acting on the hidden ones.
 */
export function createDemoAdminMask(): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    await next()
    if (!c.req.path.startsWith(`/api/admin/`)) return
    const type = c.res.headers.get(`content-type`) ?? ``
    if (!MASKED_TYPES.test(type)) return
    const headers = new Headers(c.res.headers)
    headers.delete(`content-length`)
    const { status, statusText } = c.res
    const text = await c.res.text()
    c.res = undefined
    c.res = new Response(maskRealAddresses(text), { status, statusText, headers })
  }
}
