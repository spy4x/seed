import type { BrowserContext } from "@playwright/test"

/**
 * Records everything the browser refuses under a page's content security policy, in every page of
 * `context` opened after this call. Returns the list, which fills as the pages run: one line per
 * refusal, naming the directive, what was blocked, the page and, when the browser knows it, the
 * place in a script that caused it (` at <file>:<line>:<column>`, as {@link refusalSource} reads
 * it). A spec walks the app and then expects the list to be empty.
 *
 * Two sources feed it. The page's own `securitypolicyviolation` event covers what a document
 * loads or runs. Chromium's console message covers a page whose JavaScript is turned off, where no
 * listener can run.
 */
export async function watchCspViolations(context: BrowserContext): Promise<string[]> {
  const violations: string[] = []
  await context.exposeFunction("__reportCspViolation", (line: string) => violations.push(line))
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (globalThis as unknown as { __reportCspViolation: (line: string) => void })
        .__reportCspViolation
      const sample = event.sample ? ` (${event.sample})` : ""
      const source = event.sourceFile
        ? ` at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`
        : ""
      report(
        `${event.effectiveDirective} blocked ${event.blockedURI}${sample} on ` +
          `${event.documentURI}${source}`,
      )
    })
  })
  context.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      violations.push(message.text())
    }
  })
  return violations
}

/** Where in a script a refusal recorded by {@link watchCspViolations} came from. */
export interface RefusalSource {
  file: string
  /** Both count from 1, as the browser reports them. */
  line: number
  column: number
}

/** The script position at the end of a recorded refusal, or `undefined` when it names none. */
export function refusalSource(violation: string): RefusalSource | undefined {
  const match = violation.match(/ at (\S+):(\d+):(\d+)$/)
  return match ? { file: match[1], line: Number(match[2]), column: Number(match[3]) } : undefined
}
