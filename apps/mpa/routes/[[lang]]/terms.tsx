// Seed's own site: see docs/start-a-product.md
import { AUTHOR_URL, LegalPage, REPOSITORY_URL } from "../site.tsx"
import { define } from "../utils.ts"

const TERMS_SECTIONS = [
  { label: `What the demo is`, href: `#what` },
  { label: `Your data`, href: `#data` },
  { label: `What is not allowed`, href: `#not-allowed` },
  { label: `The code`, href: `#code` },
  { label: `Changes`, href: `#changes` },
] as const

/** The terms page's title, summary and the date its text last changed. */
export const TERMS_HEAD = {
  title: `Terms of the free Seed demo`,
  description: `The rules of the free Seed demo: what it is, what it is not, and what is not ` +
    `allowed in it.`,
  updated: `2026-10-21`,
} as const

/** The few rules of the live demo. A product built on Seed writes its own. */
export default define.page(function Terms({ state }) {
  return (
    <LegalPage
      state={state}
      path="/terms"
      title="Terms"
      headTitle={TERMS_HEAD.title}
      description={TERMS_HEAD.description}
      updated="21 October 2026"
      sections={TERMS_SECTIONS}
    >
      <h2 id="what">What the demo is</h2>
      <p>
        The demo shows the app that ships with Seed, an open-source project. It is free, run by me,
        Anton Shubin, and offered as it is: there is no promise that it is always up, and no
        warranty of any kind.
      </p>
      <h2 id="data">Your data</h2>
      <p>
        What you put in the demo stays yours. Its data may be reset, so keep nothing important in
        it. The <a href="/privacy">privacy page</a> says what is stored.
      </p>
      <p>
        You can try the demo without an account. A guest account lives only in the browser that made
        it: if that browser's data is cleared, or you sign out before adding a sign-in method, the
        account is gone and cannot be restored, not even by support.
      </p>
      <h2 id="not-allowed">What is not allowed</h2>
      <ul>
        <li>Breaking the law, or storing content that does.</li>
        <li>Sending spam, for example through invitations.</li>
        <li>Attacking the service or other people's accounts.</li>
      </ul>
      <p>I may remove accounts and data that break these rules.</p>
      <h2 id="code">The code</h2>
      <p>
        The source is on <a href={REPOSITORY_URL}>GitHub</a>{" "}
        under the MIT licence, and that licence, not this page, governs what you may do with the
        code.
      </p>
      <h2 id="changes">Changes</h2>
      <p>
        When these terms change, the new text appears on this page. Questions go to{" "}
        <a href={AUTHOR_URL}>antonshubin.com</a>.
      </p>
    </LegalPage>
  )
})
