import { render } from "preact"
import { createThemeStore } from "@spy4x/preact-signals/theme"
import { ErrorBoundary } from "@spy4x/preact-ui/error-boundary"
import { App } from "./app.tsx"
import { adminHttp, createAdminStore } from "./state.ts"
import { kept, languages } from "./i18n.ts"
import { createAdminToasts } from "./toasts.ts"
import { pickLanguage } from "@platform/i18n.ts"
import { LANGUAGES } from "@domain/identity"

// Follows the system light/dark setting until the operator picks one in the top bar. `index.html`
// paints the stored choice before this runs.
const theme = createThemeStore()
theme.attach()

const store = createAdminStore(adminHttp)
store.start()

// The sign-in page is already in the operator's language: the one this device keeps, else the
// browser's. Signed in, their stored preference takes over (`app.tsx`).
await languages.use(pickLanguage(LANGUAGES, null, kept.read(), navigator.languages))

render(
  <ErrorBoundary dataE2E="render-error">
    <App store={store} theme={theme} toasts={createAdminToasts()} />
  </ErrorBoundary>,
  document.getElementById("app") as HTMLElement,
)
