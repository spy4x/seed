import {
  CATALOG_DEFAULT_SETTINGS,
  type CatalogSettings,
  parseCatalogCurrency,
  parseCatalogLanguages,
} from "@domain/catalog"

/** Whether the catalog is on, and how it is set up. */
export interface CatalogSetup {
  /** `CATALOG=true`. Off, no catalog route answers and the admin app shows no Catalog entry. */
  on: boolean
  settings: CatalogSettings
}

/** The catalog of a product that does not turn it on. */
export const CATALOG_OFF: CatalogSetup = { on: false, settings: CATALOG_DEFAULT_SETTINGS }

/**
 * Reads the catalog's switch and settings (#466, docs/catalog.md): `CATALOG=true` turns it on,
 * `CATALOG_CURRENCY` (default `USD`) is the currency of every price, and `CATALOG_LANGUAGES`
 * (default `en`) the languages its texts are kept in, the default first. Off, the two settings are
 * not read. On, a bad one stops the process, naming it.
 */
export function readCatalogSetup(env: { get(name: string): string | undefined }): CatalogSetup {
  if (env.get(`CATALOG`)?.trim() !== `true`) return CATALOG_OFF
  const currency = env.get(`CATALOG_CURRENCY`)?.trim() || CATALOG_DEFAULT_SETTINGS.currency
  const languages = env.get(`CATALOG_LANGUAGES`)?.trim() || CATALOG_DEFAULT_SETTINGS.languages[0]
  return {
    on: true,
    settings: {
      currency: parseCatalogCurrency(currency),
      languages: parseCatalogLanguages(languages),
    },
  }
}
