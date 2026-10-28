/**
 * The translator Seed's own screens read (#216). Inside an app it is the app's, from the nearest
 * `I18nContext`. Without a provider, as in a test that renders one screen, the preact-components
 * default knows no key and would show the keys themselves, so the screens fall back to Seed's
 * English catalog of their namespace instead.
 *
 * Each namespace's English is built on first use, in a function of its own, so a bundle that never
 * draws an admin screen leaves the admin catalog out.
 *
 * @module
 */

import { createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import { ENGLISH, useT } from "@spy4x/preact-ui/i18n"
import app from "@i18n/app/en.json" with { type: "json" }
import admin from "@i18n/admin/en.json" with { type: "json" }

let appEnglish: Translator<string> | undefined
let adminEnglish: Translator<string> | undefined

/** The translator of the product's screens (the `app` namespace). */
export function useAppText(): Translator<string> {
  const translator = useT()
  if (translator !== ENGLISH) return translator
  appEnglish ??= createTranslator({ language: `en`, catalogs: [{ source: app }] })
  return appEnglish
}

/** The translator of the operator area's screens (the `admin` namespace). */
export function useAdminText(): Translator<string> {
  const translator = useT()
  if (translator !== ENGLISH) return translator
  adminEnglish ??= createTranslator({ language: `en`, catalogs: [{ source: admin }] })
  return adminEnglish
}
