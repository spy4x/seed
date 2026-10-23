import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createThemeStore, ThemeValue } from "@spy4x/preact-signals/theme"
import {
  saveSettings,
  type SettingsStore,
  type StoredSettings,
} from "@spy4x/platform/universal/settings"
import type { DeviceFormat } from "@spy4x/time/format"
import { DEFAULT_PREFERENCES, preferencesDefinition } from "@domain/identity"
import { createPreferencesState, PREFERENCES_UPDATED_ELSEWHERE } from "./preferences.ts"

const BERLIN: DeviceFormat = { locale: `en-GB`, timeZone: `Europe/Berlin` }
const AT = Date.UTC(2026, 9, 17, 12, 5) // 17 Oct 2026, 12:05 UTC

/**
 * The server in memory: one person's record behind the same compare-and-set the API runs, and the
 * hint it sends every open device after an accepted save. A device that is offline gets a rejected
 * call, like the socket's.
 */
function server({ lateHints = false, racingHints = false } = {}) {
  let row: StoredSettings | null = null
  const store: SettingsStore = {
    read: () => Promise.resolve(row),
    write: (_owner, expected, next) => {
      if ((row?.version ?? 0) !== expected) return Promise.resolve(false)
      row = next
      return Promise.resolve(true)
    },
  }
  const devices: { refresh(): Promise<void> }[] = []
  const told: unknown[] = []
  const hint = () => Promise.all(devices.map((device) => device.refresh()))
  return {
    devices,
    told,
    hint,
    get row() {
      return row
    },
    async call(name: string, payload: unknown): Promise<unknown> {
      if (name === `preferences.get`) {
        // A racing hint's read leaves before the save's answer and comes back after it.
        if (racingHints) await new Promise((resolve) => setTimeout(resolve, 0))
        return row
      }
      if (name === `preferences.save`) {
        const result = await saveSettings(preferencesDefinition, store, `7`, payload)
        // A late hint reaches the devices after the saving one has its answer.
        if (result.ok) {
          if (racingHints) void hint()
          else if (lateHints) setTimeout(() => void hint(), 0)
          else await hint()
        }
        return result
      }
      if (name === `preferences.device`) {
        told.push(payload)
        return null
      }
      throw new Error(`unexpected call ${name}`)
    },
  }
}

/** One device of the person: its own theme store and storage, on the shared server. */
function device(backend: ReturnType<typeof server>, here: DeviceFormat = BERLIN) {
  const stored = new Map<string, string>()
  const theme = createThemeStore({
    storage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => void stored.set(key, value),
    },
    media: null,
    apply: () => {},
  })
  let kept: string | null = null
  const online = { value: true }
  const reach = <T>(name: string, payload?: unknown) =>
    online.value ? backend.call(name, payload) as Promise<T> : Promise.reject(new Error(`offline`))
  const state = createPreferencesState({
    query: (name) => reach(name),
    command: (name, payload) => reach(name, payload),
    theme,
    device: () => here,
    keptZone: { read: () => kept, write: (zone) => void (kept = zone) },
    online: () => online.value,
  })
  backend.devices.push(state)
  return { state, theme, online, kept: () => kept }
}

/** The page opens signed in: it tells the device's zone, and the start's pull reads. */
function open(on: ReturnType<typeof device>): Promise<void> {
  on.state.start()
  return on.state.refresh()
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`preferences across devices`, () => {
  it(`a theme changed on one device changes it on the other`, async () => {
    const backend = server()
    const laptop = device(backend)
    const phone = device(backend)
    await open(laptop)
    await open(phone)

    laptop.theme.set(ThemeValue.DARK)
    await settle()
    await settle()

    expect(backend.row?.value).toEqual({ ...DEFAULT_PREFERENCES, theme: `dark` })
    expect(phone.theme.preference.value).toBe(`dark`)
  })

  it(`a time zone changed on one device changes every date on the other`, async () => {
    const backend = server()
    const laptop = device(backend)
    const phone = device(backend)
    await open(laptop)
    await open(phone)
    expect(phone.state.format.value.time(AT)).toBe(`14:05`)

    const outcome = await laptop.state.save({ timeZone: `Asia/Tokyo` })

    expect(outcome.ok).toBe(true)
    expect(phone.state.format.value.timeZone).toBe(`Asia/Tokyo`)
    expect(phone.state.format.value.time(AT)).toBe(`21:05`)
    expect(phone.state.announcement.value).toBe(PREFERENCES_UPDATED_ELSEWHERE)
    // The device that saved announces nothing: the change is its own.
    expect(laptop.state.announcement.value).toBe(``)
  })

  it(`a save made on an older version is refused and shows the record that won`, async () => {
    const backend = server()
    const laptop = device(backend)
    const phone = device(backend)
    await open(laptop)
    await open(phone)
    // The phone misses the hint: it still holds version 0 when it saves.
    phone.online.value = false
    await laptop.state.save({ timeZone: `Asia/Tokyo` })
    phone.online.value = true

    const outcome = await phone.state.save({ hourCycle: `h12` })

    expect(outcome.ok).toBe(false)
    expect(phone.state.conflict.value?.value.timeZone).toBe(`Asia/Tokyo`)
    expect(phone.state.value.value).toEqual({ ...DEFAULT_PREFERENCES, timeZone: `Asia/Tokyo` })
    expect(backend.row?.value).toEqual({ ...DEFAULT_PREFERENCES, timeZone: `Asia/Tokyo` })
  })

  it(`a theme picked offline paints at once and reaches the server on the next read`, async () => {
    const backend = server()
    const phone = device(backend)
    await open(phone)
    phone.online.value = false

    phone.theme.set(ThemeValue.DARK)
    await settle()

    expect(phone.theme.preference.value).toBe(`dark`)
    expect(backend.row).toBeNull()
    phone.online.value = true
    await phone.state.refresh()
    await settle()
    expect(backend.row?.value).toEqual({ ...DEFAULT_PREFERENCES, theme: `dark` })
  })
})

describe(`saving from the dialog`, () => {
  it(`refuses a draft made before another device saved a different field, and shows the record that won`, async () => {
    const backend = server()
    const laptop = device(backend)
    const phone = device(backend)
    await open(laptop)
    await open(phone)
    // Both open the dialog on version 0; the phone saves Formats first.
    const laptopBase = laptop.state.version.value
    const phoneSaved = await phone.state.saveDraft(phone.state.version.value, {
      locale: `it-IT`,
      timeZone: null,
      hourCycle: null,
    })
    expect(phoneSaved.ok).toBe(true)
    expect(laptop.state.value.value.locale).toBe(`it-IT`)

    const outcome = await laptop.state.saveDraft(laptopBase, {
      locale: null,
      timeZone: null,
      hourCycle: `h12`,
    })

    expect(outcome.ok).toBe(false)
    expect(laptop.state.conflict.value?.value.locale).toBe(`it-IT`)
    expect(backend.row?.value).toEqual({ ...DEFAULT_PREFERENCES, locale: `it-IT` })
  })

  it(`keeps a second change made while the first is on its way, and shows both at once`, async () => {
    const backend = server()
    const laptop = device(backend)
    await open(laptop)
    // The person picks Formats, then the clock before the first answer is back: the screen builds
    // each change on what it shows and on the version it holds.
    const base = laptop.state.version.value
    const first = laptop.state.saveDraft(base, {
      locale: `de-DE`,
      timeZone: null,
      hourCycle: null,
    })
    expect(laptop.state.value.value.locale).toBe(`de-DE`)
    const shown = laptop.state.value.value
    const second = laptop.state.saveDraft(laptop.state.version.value, {
      locale: shown.locale,
      timeZone: shown.timeZone,
      hourCycle: `h12`,
    })
    expect(laptop.state.value.value.hourCycle).toBe(`h12`)

    expect(await first).toEqual({ ok: true })
    expect(await second).toEqual({ ok: true })
    expect(laptop.state.conflict.value).toBe(null)
    expect(backend.row?.value).toEqual({
      ...DEFAULT_PREFERENCES,
      locale: `de-DE`,
      hourCycle: `h12`,
    })
    expect(laptop.state.value.value).toEqual(backend.row?.value)
  })

  it(`saves a draft made on the version held, and announces nothing on the saving device`, async () => {
    const backend = server({ lateHints: true })
    const laptop = device(backend)
    const phone = device(backend)
    await open(laptop)
    await open(phone)

    const outcome = await laptop.state.saveDraft(laptop.state.version.value, {
      locale: `de-DE`,
      timeZone: `Europe/Berlin`,
      hourCycle: null,
    })
    await settle()
    await settle()

    expect(outcome.ok).toBe(true)
    expect(backend.row?.version).toBe(1)
    expect(laptop.state.announcement.value).toBe(``)
    expect(phone.state.announcement.value).toBe(PREFERENCES_UPDATED_ELSEWHERE)
  })

  it(`announces nothing after this device's own "Use Tokyo time"`, async () => {
    const backend = server({ lateHints: true })
    const traveller = device(backend, { locale: `en-GB`, timeZone: `Asia/Bangkok` })
    await open(traveller)
    await traveller.state.saveDraft(0, { locale: null, timeZone: `Europe/Berlin`, hourCycle: null })
    await settle()

    await traveller.state.useDeviceZone()
    await settle()
    await settle()

    expect((backend.row?.value as { timeZone?: string })?.timeZone).toBe(`Asia/Bangkok`)
    expect(traveller.state.announcement.value).toBe(``)
  })

  it(`announces nothing when a hint's read returns after this device's own saves`, async () => {
    const backend = server({ racingHints: true })
    const laptop = device(backend)
    const phone = device(backend)
    await open(laptop)
    await open(phone)

    await laptop.state.saveDraft(0, { locale: `de-DE`, timeZone: null, hourCycle: null })
    await settle()
    await settle()
    expect(backend.row?.version).toBe(1)
    expect(laptop.state.announcement.value).toBe(``)
    expect(phone.state.announcement.value).toBe(PREFERENCES_UPDATED_ELSEWHERE)

    phone.state.announcement.value = ``
    laptop.theme.set(ThemeValue.DARK)
    await settle()
    await settle()
    await settle()
    expect(backend.row?.version).toBe(2)
    expect(laptop.state.announcement.value).toBe(``)
    expect(phone.state.announcement.value).toBe(PREFERENCES_UPDATED_ELSEWHERE)
  })

  it(`refuses at once without a connection, and sends nothing`, async () => {
    const backend = server()
    const phone = device(backend)
    await open(phone)
    phone.online.value = false

    const outcome = await phone.state.saveDraft(0, {
      locale: `de-DE`,
      timeZone: null,
      hourCycle: null,
    })

    expect(outcome).toEqual({ ok: false, reason: `offline` })
    expect(backend.row).toBeNull()
  })
})

describe(`the device's own zone`, () => {
  it(`is offered when the person pinned another zone, and not once they keep theirs`, async () => {
    const backend = server()
    const traveller = device(backend, { locale: `en-GB`, timeZone: `Asia/Bangkok` })
    await open(traveller)
    expect(traveller.state.otherZone.value).toBeNull()

    await traveller.state.save({ timeZone: `Europe/Berlin` })
    expect(traveller.state.otherZone.value).toBe(`Asia/Bangkok`)

    traveller.state.keepZone()
    expect(traveller.state.otherZone.value).toBeNull()
    expect(traveller.kept()).toBe(`Asia/Bangkok`)
  })

  it(`"Use it" makes this device's zone the person's zone`, async () => {
    const backend = server()
    const traveller = device(backend, { locale: `en-GB`, timeZone: `Asia/Bangkok` })
    await open(traveller)
    await traveller.state.save({ timeZone: `Europe/Berlin` })

    await traveller.state.useDeviceZone()

    expect(backend.row?.value).toEqual({ ...DEFAULT_PREFERENCES, timeZone: `Asia/Bangkok` })
    expect(traveller.state.otherZone.value).toBeNull()
  })
})

describe(`starting a session`, () => {
  it(`tells the server this device's zone and region format`, async () => {
    const backend = server()
    const phone = device(backend, { locale: `th-TH`, timeZone: `Asia/Bangkok` })

    phone.state.start()
    await settle()

    expect(backend.told).toEqual([{ locale: `th-TH`, timeZone: `Asia/Bangkok` }])
  })
})

describe(`signing out`, () => {
  it(`forgets the person's preferences and what this device kept`, async () => {
    const backend = server()
    const laptop = device(backend, { locale: `en-GB`, timeZone: `Asia/Bangkok` })
    await open(laptop)
    await laptop.state.save({ timeZone: `Europe/Berlin`, locale: `de-DE` })
    laptop.state.keepZone()

    laptop.state.reset()

    expect(laptop.state.value.value).toEqual(DEFAULT_PREFERENCES)
    expect(laptop.state.loaded.value).toBe(false)
    expect(laptop.kept()).toBeNull()
  })
})
