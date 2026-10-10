// Preact DevTools bridge import must be FIRST for correct detection
if (getEnvVar("ENV") === "dev") {
  import("preact/debug").then(() => console.log("Preact DevTools bridge loaded"))
}
import { render } from "preact"
import { App } from "./app.tsx"
import { getEnvVar } from "@client/vite/env.ts"
import { createThemeStore } from "@spy4x/preact-signals/theme"
import { ErrorBoundary } from "@spy4x/preact-ui/error-boundary"
import { reportCaughtError, startErrorReporting } from "./error-reporting.ts"
import { loadRuntimeConfig } from "./runtime-config.ts"
import { install } from "./install.ts"
import { configureModules } from "./modules.ts"

// Follows the system light/dark setting. `index.html` paints the stored choice before this runs.
createThemeStore().attach()

// The browser can offer the install dialog before the app renders, so listening starts here.
install.watch()

// Settings that differ per environment come from `/config.json`, written when the container
// starts, so one image serves any of them. The service worker keeps a copy for an offline start.
const config = await loadRuntimeConfig()

// Which optional modules run: the socket and the device copy, both on unless the file says no.
configureModules(config)

// Without a DSN this does nothing and the page makes no request to any tracker.
startErrorReporting(
  { ERROR_REPORT_DSN: config.errorReportDsn, ENV: config.env },
  globalThis,
  () => location.href,
)

render(
  <ErrorBoundary onError={reportCaughtError} dataE2E="render-error">
    <App />
  </ErrorBoundary>,
  document.getElementById("app") as HTMLElement,
)
