import { API_DOCS_PATH } from "../../../api-docs.ts"
import { localePath } from "../../../languages.ts"
import { define } from "../../../utils.ts"

/**
 * `/docs` has no page of its own yet, so it answers a permanent redirect to the API reference, in
 * the same language.
 */
export const handler = define.handlers({
  GET(ctx) {
    return new Response(null, {
      status: 301,
      headers: { Location: localePath(ctx.state.language, API_DOCS_PATH) },
    })
  },
})
