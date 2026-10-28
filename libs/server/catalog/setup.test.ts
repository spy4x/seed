import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { CATALOG_OFF, readCatalogSetup } from "./setup.ts"

/** An environment holding `values` only. */
const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] })

it(`keeps the catalog off unless CATALOG is true, whatever the other settings hold`, () => {
  expect(readCatalogSetup(env({}))).toEqual(CATALOG_OFF)
  expect(readCatalogSetup(env({ CATALOG: `1`, CATALOG_CURRENCY: `nope` }))).toEqual(CATALOG_OFF)
})

it(`turns the catalog on in US dollars and English when nothing else is set`, () => {
  expect(readCatalogSetup(env({ CATALOG: `true`, CATALOG_CURRENCY: ``, CATALOG_LANGUAGES: `` })))
    .toEqual({ on: true, settings: { currency: `USD`, languages: [`en`] } })
})

it(`reads the currency and the languages, the default first`, () => {
  const setup = readCatalogSetup(
    env({ CATALOG: `true`, CATALOG_CURRENCY: `vnd`, CATALOG_LANGUAGES: `vi,en` }),
  )
  expect(setup.settings).toEqual({ currency: `VND`, languages: [`vi`, `en`] })
})

it(`stops on a bad setting, naming it`, () => {
  expect(() => readCatalogSetup(env({ CATALOG: `true`, CATALOG_CURRENCY: `dong` }))).toThrow(
    `CATALOG_CURRENCY`,
  )
  expect(() => readCatalogSetup(env({ CATALOG: `true`, CATALOG_LANGUAGES: `vi,vi` }))).toThrow(
    `CATALOG_LANGUAGES`,
  )
})
