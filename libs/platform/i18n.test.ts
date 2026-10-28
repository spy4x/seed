import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  createLanguages,
  keptLanguage,
  LANGUAGE_STORAGE_KEY,
  languageSetting,
  pickLanguage,
} from "./i18n.ts"

const LANGUAGES = [`en`, `ru`, `de`, `ar`] as const

describe(`pickLanguage`, () => {
  it(`takes the stored choice, then this device's, then the browser's, then English`, () => {
    expect(pickLanguage(LANGUAGES, `de`, `ru`, [`ar`])).toBe(`de`)
    expect(pickLanguage(LANGUAGES, null, `ru`, [`ar`])).toBe(`ru`)
    expect(pickLanguage(LANGUAGES, null, null, [`fr-FR`, `ru-RU`])).toBe(`ru`)
    expect(pickLanguage(LANGUAGES, null, null, [`fr`])).toBe(`en`)
    expect(pickLanguage(LANGUAGES, null, null, undefined)).toBe(`en`)
  })

  it(`treats a stored or kept value off the list as no choice`, () => {
    for (const value of [`../../etc/passwd`, `__proto__`, `constructor`, `DE`, `de-DE`, ``]) {
      expect(pickLanguage(LANGUAGES, value, value, [])).toBe(`en`)
    }
  })
})

describe(`keptLanguage`, () => {
  it(`keeps a choice under its key, forgets it on null, and reads a blocked storage as none`, () => {
    const items = new Map<string, string>()
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    } as Storage
    const kept = keptLanguage(() => storage)
    kept.write(`de`)
    expect(items.get(LANGUAGE_STORAGE_KEY)).toBe(`de`)
    expect(kept.read()).toBe(`de`)
    kept.write(null)
    expect(kept.read()).toBeNull()

    const blocked = keptLanguage(() => {
      throw new DOMException(`blocked`, `SecurityError`)
    })
    expect(blocked.read()).toBeNull()
    blocked.write(`de`)
  })
})

/** Catalog loaders that record each language they load, and can be told to fail or wait. */
function setup() {
  const calls: string[] = []
  const gates = new Map<string, Promise<void>>()
  const failing = new Set<string>()
  const loader = (language: string, text: string) => async () => {
    calls.push(language)
    await gates.get(language)
    if (failing.has(language)) throw new TypeError(`Failed to fetch dynamically imported module`)
    return { default: [{ "Frame.signOut": text }] }
  }
  const root = { lang: `en`, dir: `ltr` } as HTMLElement
  const languages = createLanguages({
    languages: LANGUAGES,
    english: [{ "Frame.signOut": `Sign out` }],
    loaders: {
      ru: loader(`ru`, `Выйти`),
      de: loader(`de`, `Abmelden`),
      ar: loader(`ar`, `تسجيل الخروج`),
    },
    root: () => root,
  })
  return { languages, calls, gates, failing, root }
}

describe(`createLanguages`, () => {
  it(`loads only the language asked for, and switches the words and <html lang dir> to it`, async () => {
    const { languages, calls, root } = setup()
    expect(await languages.use(`ar`)).toBe(true)
    expect(calls).toEqual([`ar`])
    expect(languages.translator.value.t(`Frame.signOut`)).toBe(`تسجيل الخروج`)
    expect(root.lang).toBe(`ar`)
    expect(root.dir).toBe(`rtl`)

    await languages.use(`en`)
    expect(calls).toEqual([`ar`])
    expect(languages.translator.value.t(`Frame.signOut`)).toBe(`Sign out`)
    expect([root.lang, root.dir]).toEqual([`en`, `ltr`])
  })

  it(`loads a language once, however often it is shown`, async () => {
    const { languages, calls } = setup()
    await languages.use(`de`)
    await languages.use(`en`)
    await languages.use(`de`)
    expect(calls).toEqual([`de`])
  })

  it(`never calls a loader for a value off the list: it shows English`, async () => {
    const { languages, calls } = setup()
    for (const value of [`__proto__`, `toString`, `../de`, `es`]) {
      expect(await languages.use(value)).toBe(true)
      expect(languages.translator.value.language).toBe(`en`)
    }
    expect(calls).toEqual([])
  })

  it(`keeps the language shown when the new one cannot load, and names it as failed`, async () => {
    const { languages, failing, root } = setup()
    await languages.use(`de`)
    failing.add(`ru`)
    expect(await languages.use(`ru`)).toBe(false)
    expect(languages.translator.value.t(`Frame.signOut`)).toBe(`Abmelden`)
    expect(root.lang).toBe(`de`)
    expect(languages.failed.value).toBe(`ru`)
    expect(languages.loading.value).toBeNull()
  })

  it(`shows the last language asked for when an earlier one loads after it`, async () => {
    const { languages, gates } = setup()
    let open = () => {}
    gates.set(`ru`, new Promise((resolve) => open = resolve))
    const slow = languages.use(`ru`)
    expect(languages.loading.value).toBe(`ru`)
    await languages.use(`de`)
    open()
    expect(await slow).toBe(false)
    expect(languages.translator.value.language).toBe(`de`)
    expect(languages.loading.value).toBeNull()
  })

  it(`writes the numbers inside messages in the region format`, async () => {
    const languages = createLanguages({
      languages: [`en`],
      english: [{ count: `{count} notes` }],
      loaders: {} as never,
    })
    languages.setNumberLocale(`de-DE`)
    expect(languages.translator.value.t(`count`, { count: 1234.5 })).toBe(`1.234,5 notes`)
  })
})

describe(`languageSetting`, () => {
  /** A setting over `LANGUAGES`, recording what reaches `choose`. */
  function setup(loading: (typeof LANGUAGES)[number] | null = null) {
    const chosen: (string | null)[] = []
    const setting = languageSetting({
      languages: LANGUAGES,
      current: `de`,
      automatic: `ru`,
      loading,
      failed: null,
      choose: (language) => void chosen.push(language),
    })
    return { setting, chosen }
  }

  it(`passes a listed language or Automatic on, and nothing else`, () => {
    const { setting, chosen } = setup()
    for (const tag of [`ar`, null, `__proto__`, `../de`, `DE`, `fr`]) setting.onSelect(tag)
    expect(chosen).toEqual([`ar`, null])
  })

  it(`says nothing is loading when nothing is, rather than "Automatic is loading"`, () => {
    expect(setup().setting.pending).toBeUndefined()
    expect(setup(`ar`).setting.pending).toBe(`ar`)
  })
})
