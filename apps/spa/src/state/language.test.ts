import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { signal } from "@preact/signals"
import { createThemeStore, ThemeValue } from "@spy4x/preact-signals/theme"
import {
  saveSettings,
  type SettingsStore,
  type StoredSettings,
} from "@spy4x/platform/universal/settings"
import {
  DEFAULT_PREFERENCES,
  type Language,
  type Preferences,
  preferencesDefinition,
} from "@domain/identity"
import { syncLanguage } from "./language.ts"
import { createPreferencesState } from "./preferences.ts"

/** A preferences slice, a device copy and a page switch, all recorded. */
function setup(
  { kept = null, requested = [] as string[], blocked = false }: {
    kept?: string | null
    requested?: string[]
    /** The device's storage is blocked: it keeps nothing written. */
    blocked?: boolean
  } = {},
) {
  const loaded = signal(false)
  const value = signal<Preferences>(DEFAULT_PREFERENCES)
  const version = signal(0)
  const saves: Partial<Preferences>[] = []
  const shown: Language[] = []
  const device = { value: kept }
  const sync = syncLanguage({
    preferences: {
      loaded,
      value,
      version,
      save: (patch) => {
        saves.push(patch)
        value.value = { ...value.value, ...patch }
        return Promise.resolve({ ok: true, settings: { version: 1, value: value.value } } as never)
      },
    },
    use: (language) => {
      shown.push(language)
      return Promise.resolve(true)
    },
    kept: {
      read: () => device.value,
      write: (language) => {
        if (!blocked) device.value = language
      },
    },
    requested: () => requested,
    numberLocale: signal(`en-GB`),
    setNumberLocale: () => {},
  })
  /** The person's record arrives, as the pull reads it after sign-in. */
  const signIn = (record: Partial<Preferences>, at = 3) => {
    value.value = { ...DEFAULT_PREFERENCES, ...record }
    version.value = at
    loaded.value = true
  }
  return { sync, saves, shown, device, signIn, loaded, value, version }
}

describe(`syncLanguage`, () => {
  it(`signed out, shows the device's choice, else the browser's languages`, () => {
    expect(setup({ kept: `ar`, requested: [`de`] }).shown).toEqual([`ar`])
    expect(setup({ requested: [`ru-RU`] }).shown).toEqual([`ru`])
  })

  it(`shows the stored language once the record loads, and the device keeps a copy`, () => {
    const { signIn, shown, device } = setup({ kept: `ru`, requested: [`ar`] })
    signIn({ language: `de` })
    expect(shown.at(-1)).toBe(`de`)
    expect(device.value).toBe(`de`)

    // A device whose storage is blocked still shows the stored language.
    const blocked = setup({ kept: `ru`, blocked: true })
    blocked.signIn({ language: `de` })
    expect(blocked.shown.at(-1)).toBe(`de`)
  })

  it(`follows the browser when the stored language is automatic, and forgets the device's copy`, () => {
    const { signIn, shown, device } = setup({ kept: `ru`, requested: [`es`] })
    signIn({ language: null })
    expect(device.value).toBeNull()
    expect(shown.at(-1)).toBe(`es`)
  })

  it(`writes a choice made before sign-in to a record never saved, once`, () => {
    const { signIn, saves, shown } = setup({ kept: `pt-BR` })
    signIn({ language: null }, 0)
    expect(saves).toEqual([{ language: `pt-BR` }])
    expect(shown.at(-1)).toBe(`pt-BR`)
  })

  it(`does not resend that choice when its save was refused`, () => {
    const { signIn, saves, value } = setup({ kept: `de` })
    signIn({ language: null }, 0)
    // The store took the save back (offline): the record is automatic again on version 0.
    value.value = { ...value.value, language: null }
    expect(saves).toEqual([{ language: `de` }])
  })

  it(`never offers a device value off the list`, () => {
    const { signIn, saves, shown } = setup({ kept: `../../x` })
    signIn({ language: null }, 0)
    expect(saves).toEqual([])
    expect(shown.every((language) => language === `en`)).toBe(true)
  })

  it(`choosing saves for every device while signed in, and only on this device while signed out`, async () => {
    const out = setup()
    await out.sync.choose(`ar`)
    expect(out.saves).toEqual([])
    expect(out.device.value).toBe(`ar`)
    expect(out.shown.at(-1)).toBe(`ar`)

    const signedIn = setup()
    signedIn.signIn({ language: null })
    await signedIn.sync.choose(`de`)
    expect(signedIn.saves).toEqual([{ language: `de` }])
    expect(signedIn.shown.at(-1)).toBe(`de`)
  })

  it(`offers as chosen the device's choice while signed out, the stored one once signed in, and each new choice`, async () => {
    const out = setup({ kept: `ar` })
    expect(out.sync.current.value).toBe(`ar`)
    await out.sync.choose(`ru`)
    expect(out.sync.current.value).toBe(`ru`)

    // A device that keeps nothing: signed in, the account's choice; signed out again, the device's.
    const blocked = setup({ kept: `ar`, blocked: true })
    blocked.signIn({ language: `de` })
    expect(blocked.sync.current.value).toBe(`de`)
    blocked.loaded.value = false
    expect(blocked.sync.current.value).toBe(`ar`)

    expect(setup({ kept: `../x` }).sync.current.value).toBeNull()
  })
})

/** The server in memory: one record (`row` at first) behind the API's compare-and-set. */
function server(row: StoredSettings | null = null) {
  let record = row
  const settings: SettingsStore = {
    read: () => Promise.resolve(record),
    write: (_owner, expected, next) => {
      if ((record?.version ?? 0) !== expected) return Promise.resolve(false)
      record = next
      return Promise.resolve(true)
    },
  }
  return {
    row: () => record,
    save: (payload: unknown) => saveSettings(preferencesDefinition, settings, `7`, payload),
  }
}

/** One device's storage, shared by its tabs: a theme and a language kept from before sign-in. */
function deviceStorage({ theme = `dark`, language = `de` } = {}) {
  const items = new Map<string, string | null>([[`theme`, theme], [`language`, language]])
  return { items, language: () => items.get(`language`) ?? null }
}

/**
 * One page of the SPA on the real preferences store, theme sync and language sync. `unloads`: the
 * page goes away once its first save has left, as sign-in loads the page again; any later save
 * never leaves it.
 */
function tab(
  backend: ReturnType<typeof server>,
  storage: ReturnType<typeof deviceStorage>,
  { unloads = false } = {},
) {
  let sent = 0
  const call = (name: string, payload: unknown): Promise<unknown> => {
    if (name === `preferences.get`) return Promise.resolve(backend.row())
    if (name !== `preferences.save`) return Promise.resolve(null)
    if (unloads && ++sent > 1) return new Promise(() => {})
    return backend.save(payload)
  }
  const write = (key: string, value: string | null) => void storage.items.set(key, value)
  const theme = createThemeStore({
    storage: { getItem: (key) => storage.items.get(key) ?? null, setItem: write },
    media: null,
    apply: () => {},
  })
  theme.attach()
  const kept = {
    read: storage.language,
    write: (language: string | null) => write(`language`, language),
  }
  const state = createPreferencesState({
    query: (name) => call(name, undefined) as never,
    command: (name, payload) => call(name, payload) as never,
    theme,
    language: kept,
    device: () => ({ locale: `en-GB`, timeZone: `Europe/Berlin` }),
    requested: () => [],
    keptZone: { read: () => null, write: () => {} },
    online: () => true,
  })
  const shown: Language[] = []
  const sync = syncLanguage({
    preferences: state,
    use: (language) => {
      shown.push(language)
      return Promise.resolve(true)
    },
    kept,
    requested: () => [`en-GB`],
    numberLocale: signal(`en-GB`),
    setNumberLocale: () => {},
  })
  return { state, theme, sync, shown }
}

/** Signs every tab in at once and lets every save and its answer land. */
async function signInAll(...tabs: ReturnType<typeof tab>[]) {
  await Promise.all(tabs.map((page) => page.state.refresh()))
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe(`a new account on a device that kept a language and a theme`, () => {
  it(`keeps the device's language when the page loads again right after the theme's save, as sign-in does`, async () => {
    const backend = server()
    const storage = deviceStorage()
    await signInAll(tab(backend, storage, { unloads: true }))
    const next = tab(backend, storage)
    await signInAll(next)
    expect(backend.row()?.value).toMatchObject({ theme: `dark`, language: `de` })
    expect(storage.language()).toBe(`de`)
    expect(next.shown.every((language) => language === `de`)).toBe(true)
    expect(next.sync.current.value).toBe(`de`)
  })

  it(`keeps it in a second tab whose first save lost to the first tab's`, async () => {
    const backend = server()
    const storage = deviceStorage()
    const first = tab(backend, storage)
    const second = tab(backend, storage)
    await signInAll(first, second)
    expect(backend.row()?.value).toMatchObject({ theme: `dark`, language: `de` })
    expect(storage.language()).toBe(`de`)
    expect(second.shown.every((language) => language === `de`)).toBe(true)
  })

  it(`saves the theme without a device language off the list`, async () => {
    const backend = server()
    await signInAll(tab(backend, deviceStorage({ language: `../x` })))
    expect(backend.row()?.value).toMatchObject({ theme: `dark`, language: null })
  })

  it(`never adds the device's language to a record saved before, even with a theme change`, async () => {
    // Saved on another device with "follow this device": a later save here keeps that.
    const saved = { version: 3, value: { ...DEFAULT_PREFERENCES, theme: `light` } }
    const backend = server(saved)
    const storage = deviceStorage()
    const page = tab(backend, storage)
    await signInAll(page)
    page.theme.set(ThemeValue.DARK)
    await signInAll()
    expect(backend.row()).toMatchObject({ version: 4, value: { theme: `dark`, language: null } })
    expect(storage.language()).toBeNull()
  })
})
