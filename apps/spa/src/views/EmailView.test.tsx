import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { Router } from "wouter-preact"
import { EMAIL_FAILURES } from "@ui/email-screen.tsx"
import { emailStore } from "../state/email.ts"
import { EmailView } from "./EmailView.tsx"

/** The view on the server: the router needs a path, because there is no `location`. */
const render = () =>
  renderToString(
    <Router ssrPath="/email">
      <EmailView />
    </Router>,
  )

describe("EmailView", () => {
  afterEach(() => emailStore.reset())

  it("shows the error and a retry, not a spinner, when the first read failed", () => {
    emailStore.loadFailed.value = true

    const html = render()

    expect(html).toContain(EMAIL_FAILURES.load)
    expect(html).toContain(`data-e2e="email-retry"`)
    expect(html).not.toContain("Loading…")
  })

  it("shows the spinner while the first read is still under way", () => {
    const html = render()

    expect(html).toContain("Loading…")
    expect(html).not.toContain(EMAIL_FAILURES.load)
  })
})
