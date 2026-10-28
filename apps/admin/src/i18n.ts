/**
 * The admin app's languages (#216): its English catalogs, bundled, and one loader per other language.
 * Each loader is a fixed `import()`, so the build makes one chunk per language and loads only the
 * one shown. Only a member of `LANGUAGES` reaches a loader (`createLanguages`).
 *
 * @module
 */
import ui from "@spy4x/preact-ui/i18n/en"
import system from "@spy4x/preact-system/i18n/en"
import signals from "@spy4x/preact-signals/i18n/en"
import charts from "@spy4x/preact-charts/i18n/en"
import own from "@i18n/admin/en.json" with { type: "json" }
import errors from "@i18n/errors/en.json" with { type: "json" }
import { LANGUAGES } from "@domain/identity"
import { type CatalogList, createLanguages, keptLanguage } from "@platform/i18n.ts"

/** The English catalogs, in the order every language module lists its own. */
export const ENGLISH: CatalogList = [ui, system, signals, charts, own, errors]

/** The page's languages: the translator every screen reads, and the switch. */
export const languages = createLanguages({
  languages: LANGUAGES,
  english: ENGLISH,
  loaders: {
    ru: () => import("./i18n/ru.ts"),
    es: () => import("./i18n/es.ts"),
    de: () => import("./i18n/de.ts"),
    "pt-BR": () => import("./i18n/pt-BR.ts"),
    ar: () => import("./i18n/ar.ts"),
  },
  root: () => globalThis.document?.documentElement,
})

/** The language chosen on this device, kept for the next start and the sign-in page. */
export const kept = keptLanguage(() => globalThis.localStorage)
