import { readBuildEnvVar } from "@spy4x/platform/browser/build-env"
// Preact DevTools bridge import must be FIRST for correct detection
if (readBuildEnvVar(import.meta.env, "ENV", { prefix: "VITE_", optional: true }) === "dev") {
  import("preact/debug").then(() => console.log("Preact DevTools bridge loaded"))
}
import { render } from "preact"
import { App } from "./app.tsx"
import { ErrorBoundary } from "@spy4x/preact-ui/error-boundary"
import { reportCaughtError, startErrorReporting } from "./error-reporting.ts"
import { loadRuntimeConfig } from "./runtime-config.ts"
import { install } from "./install.ts"
import { configureModules } from "./modules.ts"
import { themeStore } from "./state/theme.ts"
import { demoMode, guestMode, siteOrigin, siteOriginOf } from "./state/demo.ts"
import { kept, languages } from "./i18n.ts"
import { pickLanguage } from "@platform/i18n.ts"
import { LANGUAGES } from "@domain/identity"

// Follows the system light/dark setting until the person picks one in the account menu.
// `index.html` paints the stored choice before this runs.
themeStore.attach()

// The browser can offer the install dialog before the app renders, so listening starts here.
install.watch()

// Settings that differ per environment come from `/config.json`, written when the container
// starts, so one image serves any of them. The service worker keeps a copy for an offline start.
const config = await loadRuntimeConfig()

// Which optional modules run: the socket and the device copy, both on unless the file says no.
configureModules(config)
demoMode.value = config.demo === true
guestMode.value = config.guest !== false
siteOrigin.value = siteOriginOf(config.site, config.env)

// Without a DSN this does nothing and the page makes no request to any tracker.
startErrorReporting(
  { ERROR_REPORT_DSN: config.errorReportDsn, ENV: config.env },
  globalThis,
  () => location.href,
)

// The first frame is already in the person's language: the one this device keeps, else the
// browser's. The stored preference takes over once the person's preferences are read
// (`state/page-language.ts`). A language that cannot load (offline, not cached) leaves English.
await languages.use(pickLanguage(LANGUAGES, null, kept.read(), navigator.languages))

render(
  <ErrorBoundary onError={reportCaughtError} dataE2E="render-error">
    <App />
  </ErrorBoundary>,
  document.getElementById("app") as HTMLElement,
)
