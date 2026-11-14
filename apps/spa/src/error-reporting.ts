import {
  createErrorReporter,
  type ErrorEventTarget,
  type ErrorReporter,
} from "@spy4x/platform/universal/error-reporter"

/** What the SPA reads from its build environment (`VITE_` prefix optional). */
export interface ErrorReportingEnv {
  ERROR_REPORT_DSN?: string
  ENV?: string
  /**
   * The commit the bundle was built from (`VITE_RELEASE`). The tracker reads the source maps
   * uploaded for this release, so a report shows source lines. Empty sends no release.
   */
  RELEASE?: string
}

/** Off until `startErrorReporting` finds a DSN, so a render error before then reports nothing. */
const OFF: ErrorReporter = createErrorReporter({ dsn: undefined })
let reporter: ErrorReporter = OFF

/**
 * Starts reporting the page's uncaught errors and unhandled rejections to the tracker named by
 * `ERROR_REPORT_DSN`. With no DSN it does nothing and makes no request. The page address is sent
 * without its query, and `/invite/<token>` without the token.
 */
export function startErrorReporting(
  env: ErrorReportingEnv,
  target: ErrorEventTarget,
  page: () => string,
  fetcher?: typeof fetch,
): ErrorReporter {
  reporter = createErrorReporter({
    dsn: env.ERROR_REPORT_DSN,
    environment: env.ENV,
    release: env.RELEASE || undefined,
    pageUrl: page,
    redactPathAfter: ["invite"],
    // A runaway loop must not flood the tracker.
    maxPerSession: 20,
    fetch: fetcher,
  })
  reporter.install(target)
  return reporter
}

/** Reports an error the render caught, which never reaches `window`'s `error` event. */
export function reportCaughtError(error: unknown): void {
  void reporter.report(error)
}
