import { renderCatalogPage } from "./index.tsx"
import { define } from "../../../utils.ts"

/** One category's page, `/catalog/<category>`: its items as tiles (`renderCatalogPage`). */
export const handler = define.handlers({
  GET: (ctx) => renderCatalogPage(ctx, ctx.params.category ?? ``),
})
