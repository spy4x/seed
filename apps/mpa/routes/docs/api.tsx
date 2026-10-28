import { Prose } from "@spy4x/preact-ui/prose"
import { API_DOCS_HEAD, API_DOCS_PATH, API_DOCS_SOURCE, renderApiDocs } from "../../api-docs.ts"
import { LegalPage, REPOSITORY_URL } from "../../site.tsx"
import { define } from "../../utils.ts"

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
      <Prose html={html} />
    </LegalPage>
  )
})
