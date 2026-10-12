import { createStoredInstallPrompt } from "@spy4x/preact-signals/install-prompt"

/**
 * Whether the app can be installed here, and whether the person said "not now". The library keeps
 * that answer in `localStorage` as the text `1` under `install-prompt-dismissed`, the key and text
 * this app has always written, so an earlier "Not now" still holds. `main.tsx` calls `watch()`
 * before the first render, because the browser can offer the install dialog early.
 */
export const install = createStoredInstallPrompt()
