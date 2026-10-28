import { createToastStore, type ToastStore } from "@spy4x/preact-signals/toast"
import { adminText } from "./i18n.ts"

/**
 * The admin app's toast list. Each toast's title ("Success", "Error") is read in the language shown
 * when it appears.
 */
export function createAdminToasts(): ToastStore {
  return createToastStore({ translator: adminText })
}
