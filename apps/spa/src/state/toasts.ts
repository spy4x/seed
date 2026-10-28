import { createToastStore } from "@spy4x/preact-signals/toast"
import { languages } from "../i18n.ts"

/**
 * The app's one toast list. `App` renders it through `Toastr`; any view pushes with `.success()`.
 * Each toast's title ("Success", "Error") is read in the language shown when it appears.
 */
export const toasts = createToastStore({ translator: () => languages.translator.peek() })
