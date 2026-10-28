import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { signal } from "@preact/signals"
import { DEFAULT_PREFERENCES, type Language, type Preferences } from "@domain/identity"
import { syncLanguage } from "./language.ts"

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
