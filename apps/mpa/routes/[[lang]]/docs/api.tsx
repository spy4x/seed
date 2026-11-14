// deno-lint-ignore-file ui-text/no-literal
// This page is English at every language's address: a translated reference could say something the
// English does not, so it is not translated. The frame around it is.
import { HttpError } from "@spy4x/preact-server"
import { Prose, PROSE_LABELS } from "@spy4x/preact-ui/prose"
import CodeCopy from "../../../islands/code-copy.tsx"
import { API_DOCS_HEAD, API_DOCS_PATH, API_DOCS_SOURCE, renderApiDocs } from "../../../api-docs.ts"
import { LegalPage, REPOSITORY_URL } from "../../../site.tsx"
import { define } from "../../../utils.ts"

/** With the notes off (`NOTES=false`) the tokens reach no endpoint, so the page is the site's 404. */
export const handler = define.handlers({
  GET(ctx) {
    if (!ctx.state.notes) throw new HttpError(404)
    return { data: undefined }
  },
})

/**
 * The API reference: how a personal API token reaches a group's notes. Its text is
 * `docs/token-api.md`, so the repository and the website say the same thing.
 */
export default define.page(function ApiDocs({ state }) {
  const { html, headings } = renderApiDocs(state.spaOrigin)
  const sections = headings
    .filter((heading) => heading.depth === 2)
    .map((heading) => ({ label: heading.text, href: `#${heading.id}` }))
  return (
    <LegalPage
      state={state}
      path={API_DOCS_PATH}
      title="API reference"
      headTitle={API_DOCS_HEAD.title}
      description={API_DOCS_HEAD.description}
      updated="23 October 2026"
      sections={sections}
      lead={
        <p class="text-sm text-muted">
          This page is{" "}
          <a
            href={`${REPOSITORY_URL}/blob/main/${API_DOCS_SOURCE}`}
            class="text-primary underline"
          >
            {API_DOCS_SOURCE}
          </a>{" "}
          in the repository.
        </p>
      }
    >
      <Prose html={html} copyCode labels={PROSE_LABELS} />
      <CodeCopy />
    </LegalPage>
  )
})
