import { API_DOCS_PATH } from "../../api-docs.ts"
import { define } from "../../utils.ts"

/** `/docs` has no page of its own yet, so it answers a permanent redirect to the API reference. */
export const handler = define.handlers({
  GET() {
    return new Response(null, { status: 301, headers: { Location: API_DOCS_PATH } })
  },
})
