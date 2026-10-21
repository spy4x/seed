// Seed's own site: see docs/start-a-product.md
import { HIRE_PAGE_URL } from "../hire.ts"
import { define } from "../utils.ts"

/**
 * The founders page moved to antonshubin.com, the one home for hiring Anton (spy4x/seed#264), so
 * the old address answers a permanent redirect there.
 */
export const handler = define.handlers({
  GET() {
    return new Response(null, { status: 301, headers: { Location: HIRE_PAGE_URL } })
  },
})
