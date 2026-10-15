import { render } from "preact"
import { createThemeStore } from "@spy4x/preact-signals/theme"
import { ErrorBoundary } from "@spy4x/preact-ui/error-boundary"
import { App } from "./app.tsx"
import { adminHttp, createAdminStore } from "./state.ts"

// Follows the system light/dark setting. `index.html` paints the stored choice before this runs.
createThemeStore().attach()

const store = createAdminStore(adminHttp)
store.start()

render(
  <ErrorBoundary dataE2E="render-error">
    <App store={store} />
  </ErrorBoundary>,
  document.getElementById("app") as HTMLElement,
)
