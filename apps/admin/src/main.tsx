import { render } from "preact"
import { createThemeStore } from "@spy4x/preact-signals/theme"
import { createToastStore } from "@spy4x/preact-signals/toast"
import { ErrorBoundary } from "@spy4x/preact-ui/error-boundary"
import { App } from "./app.tsx"
import { adminHttp, createAdminStore } from "./state.ts"

// Follows the system light/dark setting until the operator picks one in the top bar. `index.html`
// paints the stored choice before this runs.
const theme = createThemeStore()
theme.attach()

const store = createAdminStore(adminHttp)
store.start()

render(
  <ErrorBoundary dataE2E="render-error">
    <App store={store} theme={theme} toasts={createToastStore()} />
  </ErrorBoundary>,
  document.getElementById("app") as HTMLElement,
)
