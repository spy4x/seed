/**
 * "Language and region" (#163) and "Appearance": the person's profile sections and the operator's
 * read-only copy. What a person does in a browser DOM (happy-dom): pick a theme, pick a clock that
 * saves at once, see a refused save's notice, and switch to the device's zone.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { DEFAULT_PREFERENCES, type Preferences } from "@domain/identity"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters } from "@spy4x/time/format"
import {
  AdminPreferencesGroup,
  AppearanceSection,
  type PreferencesProps,
  RegionSection,
} from "./preferences.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

async function mount(node: VNode): Promise<void> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
}

async function rerender(node: VNode): Promise<void> {
  await act(() => render(node, root!))
}

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T & HTMLElement>(selector)

async function click(selector: string): Promise<void> {
  const element = $(selector)
  if (!element) throw new Error(`no ${selector}`)
  await act(() => element.click())
}

const NOW = new Date(Date.UTC(2026, 9, 17, 12, 5))
const BERLIN = { locale: `en-GB`, timeZone: `Europe/Berlin` }

/** The section's props with every callback recorded, in the person's own format. */
function setup(overrides: Partial<PreferencesProps> = {}) {
  const calls: unknown[][] = []
  const props: PreferencesProps = {
    value: DEFAULT_PREFERENCES,
    device: BERLIN,
    systemTheme: `light`,
    otherZone: null,
    conflict: null,
    version: 0,
    pending: false,
    error: null,
    announcement: ``,
    now: NOW,
    onTheme: (theme) => calls.push([`theme`, theme]),
    onSave: (next, base) => calls.push([`save`, next, base]),
    onUseDeviceZone: () => calls.push([`use`]),
    onKeepZone: () => calls.push([`keep`]),
    ...overrides,
  }
  const format = createFormatters(props.value, { device: props.device })
  const wrap = (node: VNode) => (
    <FormatContext.Provider value={format}>{node}</FormatContext.Provider>
  )
  return {
    region: wrap(<RegionSection {...props} />),
    appearance: wrap(<AppearanceSection {...props} />),
    calls,
  }
}

const input = (selector: string) => $<HTMLInputElement>(selector)!

describe(`RegionSection`, () => {
  it(`shows Automatic values from this device and a sample in the person's format`, async () => {
    await mount(setup().region)

    expect(input(`#preferences-formats`).value).toBe(`Automatic: English (United Kingdom)`)
    expect(input(`#preferences-time-zone`).value).toContain(`Automatic: Berlin`)
    expect(input(`[data-e2e="preferences-clock-format"]`).checked).toBe(true)
    expect($(`[data-e2e="preferences-example"]`)?.textContent).toContain(`14:05`)
  })

  it(`saves a picked clock at once, with no Save button`, async () => {
    const { region, calls } = setup()
    await mount(region)

    await click(`[data-e2e="preferences-clock-h12"]`)

    expect(calls).toEqual([[`save`, { locale: null, timeZone: null, hourCycle: `h12` }, 0]])
    expect($(`[data-e2e="preferences-save"]`)).toBeNull()
  })

  it(`keeps the saved region values when only the clock changes`, async () => {
    const { region, calls } = setup({
      value: { ...DEFAULT_PREFERENCES, locale: `it-IT`, timeZone: `Asia/Tokyo` },
      version: 3,
    })
    await mount(region)

    await click(`[data-e2e="preferences-clock-h23"]`)

    expect(calls).toEqual([[
      `save`,
      { locale: `it-IT`, timeZone: `Asia/Tokyo`, hourCycle: `h23` },
      3,
    ]])
  })

  it(`shows the values that won and says why when another device saved first`, async () => {
    await mount(setup().region)

    const won: Preferences = { ...DEFAULT_PREFERENCES, hourCycle: `h23`, timeZone: `Asia/Tokyo` }
    await rerender(setup({ conflict: { version: 1, value: won } }).region)

    expect($(`[data-e2e="preferences-conflict"]`)?.textContent).toContain(
      `These changed on another device a moment ago.`,
    )
    expect(input(`[data-e2e="preferences-clock-h23"]`).checked).toBe(true)
    expect(input(`#preferences-time-zone`).value).toContain(`Tokyo`)
  })

  it(`after a refused save, saves the next change on the version and values that won`, async () => {
    const won: Preferences = { ...DEFAULT_PREFERENCES, timeZone: `Asia/Tokyo`, hourCycle: `h23` }
    const refused = setup({ conflict: { version: 4, value: won } })
    await mount(refused.region)

    await click(`[data-e2e="preferences-clock-h12"]`)

    expect(refused.calls).toEqual([
      [`save`, { locale: null, timeZone: `Asia/Tokyo`, hourCycle: `h12` }, 4],
    ])
  })

  it(`offers this device's zone when the person picked another, and reports either answer`, async () => {
    const { region, calls } = setup({
      value: { ...DEFAULT_PREFERENCES, timeZone: `Europe/Berlin` },
      device: { locale: `en-GB`, timeZone: `Asia/Tokyo` },
      otherZone: `Asia/Tokyo`,
    })
    await mount(region)

    expect($(`[data-e2e="preferences-other-zone"]`)?.textContent).toContain(
      `This device is on Tokyo time (GMT+9).`,
    )
    expect($(`[data-e2e="preferences-use-device-zone"]`)?.textContent).toBe(`Use Tokyo time`)
    expect($(`[data-e2e="preferences-keep-zone"]`)?.textContent).toBe(`Keep Berlin time`)
    await click(`[data-e2e="preferences-use-device-zone"]`)
    // Both buttons remove themselves; the focus goes on to the clock's choice, not the page.
    expect(document.activeElement?.getAttribute(`data-e2e`)).toBe(`preferences-clock-format`)
    await click(`[data-e2e="preferences-keep-zone"]`)
    expect(document.activeElement?.getAttribute(`data-e2e`)).toBe(`preferences-clock-format`)

    expect(calls).toEqual([[`use`], [`keep`]])
  })

  it(`offers nothing when the device is in the person's zone`, async () => {
    await mount(setup({ value: { ...DEFAULT_PREFERENCES, timeZone: `Europe/Berlin` } }).region)

    expect($(`[data-e2e="preferences-other-zone"]`)).toBeNull()
  })

  it(`says a change from another device to a screen reader`, async () => {
    await mount(setup({ announcement: `Preferences updated from another device.` }).region)

    const live = $(`[data-e2e="preferences-announcement"]`)!
    expect(live.getAttribute(`aria-live`)).toBe(`polite`)
    expect(live.textContent).toBe(`Preferences updated from another device.`)
  })
})

describe(`AppearanceSection`, () => {
  it(`shows the saved theme checked and what System means on this device`, async () => {
    await mount(setup().appearance)

    expect(input(`[data-e2e="preferences-theme-system"]`).checked).toBe(true)
    expect(document.body.textContent).toContain(`System (light on this device)`)
  })

  it(`changes the theme at once when a choice is picked`, async () => {
    const { appearance, calls } = setup()
    await mount(appearance)

    await click(`[data-e2e="preferences-theme-dark"]`)

    expect(calls).toEqual([[`theme`, `dark`]])
  })
})

describe(`AdminPreferencesGroup`, () => {
  it(`shows a person's preferences read-only, with their local time now`, async () => {
    await mount(
      <FormatContext.Provider value={createFormatters({ locale: `en-GB`, timeZone: `UTC` })}>
        <AdminPreferencesGroup
          now={NOW}
          preferences={{
            value: {
              theme: `dark`,
              locale: `de-DE`,
              timeZone: `Asia/Tokyo`,
              hourCycle: `h12`,
              overview: [],
            },
            version: 3,
            updatedAt: `2026-10-12T09:00:00.000Z`,
            firstTimeZone: `Europe/Berlin`,
          }}
        />
      </FormatContext.Provider>,
    )

    expect($(`[data-e2e="admin-user-preferences-theme"]`)?.textContent).toContain(`Dark`)
    expect($(`[data-e2e="admin-user-preferences-formats"]`)?.textContent).toContain(
      `German (Germany)`,
    )
    expect(document.body.textContent).toContain(`Tokyo, Asia · GMT+9`)
    expect(document.body.textContent).toContain(`21:05 there now`)
    expect(document.querySelector(`button`)).toBeNull()
  })
})
