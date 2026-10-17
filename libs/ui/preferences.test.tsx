/**
 * "Language and region" (#163): the person's group on the profile page and the operator's read-only
 * copy. What a person does in a browser DOM (happy-dom): pick a theme, open the dialog from a row,
 * change the clock and save, see a refused save's notice, and switch to the device's zone.
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
  PreferencesGroup,
  type PreferencesGroupProps,
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

/** The group with every callback recorded, in the person's own format. */
function group(overrides: Partial<PreferencesGroupProps> = {}) {
  const calls: unknown[][] = []
  const props: PreferencesGroupProps = {
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
    onCloseDialog: () => calls.push([`close`]),
    ...overrides,
  }
  const format = createFormatters(props.value, { device: props.device })
  const node = (
    <FormatContext.Provider value={format}>
      <PreferencesGroup {...props} />
    </FormatContext.Provider>
  )
  return { node, calls, props }
}

describe(`PreferencesGroup`, () => {
  it(`shows Automatic rows with this device's values and an example in the person's format`, async () => {
    await mount(group().node)

    expect($(`[data-e2e="preferences-formats"]`)?.textContent).toContain(
      `Automatic: same as this device — English (United Kingdom)`,
    )
    expect($(`[data-e2e="preferences-time-zone"]`)?.textContent).toContain(
      `Automatic: same as this device — Berlin, Europe · GMT+2`,
    )
    expect($(`[data-e2e="preferences-theme"]`)?.textContent).toContain(
      `System (light on this device)`,
    )
    expect($(`[data-e2e="preferences-example"]`)?.textContent).toContain(`14:05`)
  })

  it(`changes the theme at once from its row's menu`, async () => {
    const { node, calls } = group()
    await mount(node)

    const trigger = [...document.querySelectorAll<HTMLButtonElement>(`button`)]
      .find((button) => button.textContent?.trim() === `Change theme`)
    await act(() => trigger!.click())
    await click(`[data-e2e="preferences-theme-dark"]`)

    expect(calls).toEqual([[`theme`, `dark`]])
  })

  it(`opens the dialog on the field of the row, and saves the clock picked`, async () => {
    const { node, calls } = group()
    await mount(node)

    await click(`[data-e2e="preferences-change-timeZone"]`)
    expect(document.activeElement?.id).toBe(`preferences-time-zone`)

    const select = $<HTMLSelectElement>(`[data-e2e="preferences-clock-select"]`)!
    select.value = `h12`
    await act(() =>
      void select.dispatchEvent(new window.Event(`change`, { bubbles: true }) as never)
    )
    expect($(`[data-e2e="preferences-preview"]`)?.textContent).toMatch(/2:05\s?pm/i)
    await click(`[data-e2e="preferences-save"]`)

    expect(calls).toEqual([[`save`, { locale: null, timeZone: null, hourCycle: `h12` }, 0]])
  })

  it(`shows the values that won and says why when another device saved first`, async () => {
    const first = group()
    await mount(first.node)
    await click(`[data-e2e="preferences-change-clock"]`)
    // The person picks 12-hour here while another device saves 24-hour and Tokyo.
    const select = $<HTMLSelectElement>(`[data-e2e="preferences-clock-select"]`)!
    select.value = `h12`
    await act(() =>
      void select.dispatchEvent(new window.Event(`change`, { bubbles: true }) as never)
    )

    const won: Preferences = { ...DEFAULT_PREFERENCES, hourCycle: `h23`, timeZone: `Asia/Tokyo` }
    await rerender(group({ conflict: { version: 1, value: won }, value: won, version: 1 }).node)

    expect($(`[data-e2e="preferences-conflict"]`)?.textContent).toContain(
      `These changed on another device while you were editing.`,
    )
    expect($<HTMLSelectElement>(`[data-e2e="preferences-clock-select"]`)?.value).toBe(`h23`)
  })

  it(`saves again on the version that won after a refused edited save`, async () => {
    await mount(group().node)
    await click(`[data-e2e="preferences-change-clock"]`)
    // An edited draft does not follow the record; only the refusal moves it to the winner.
    const select = $<HTMLSelectElement>(`[data-e2e="preferences-clock-select"]`)!
    select.value = `h12`
    await act(() =>
      void select.dispatchEvent(new window.Event(`change`, { bubbles: true }) as never)
    )
    const won: Preferences = { ...DEFAULT_PREFERENCES, hourCycle: `h23` }
    const refused = group({ conflict: { version: 4, value: won }, value: won, version: 4 })
    await rerender(refused.node)

    await click(`[data-e2e="preferences-save"]`)

    expect(refused.calls).toEqual([[`save`, { locale: null, timeZone: null, hourCycle: `h23` }, 4]])
  })

  it(`after a refused save, saves an edit on the newer version when only the theme changed since`, async () => {
    await mount(group().node)
    await click(`[data-e2e="preferences-change-clock"]`)
    const first = $<HTMLSelectElement>(`[data-e2e="preferences-clock-select"]`)!
    first.value = `h12`
    await act(() =>
      void first.dispatchEvent(new window.Event(`change`, { bubbles: true }) as never)
    )
    // The edited save is refused: another device had saved a 24-hour clock.
    const won: Preferences = { ...DEFAULT_PREFERENCES, hourCycle: `h23` }
    await rerender(group({ conflict: { version: 4, value: won }, value: won, version: 4 }).node)
    const select = $<HTMLSelectElement>(`[data-e2e="preferences-clock-select"]`)!
    select.value = `h12`
    await act(() =>
      void select.dispatchEvent(new window.Event(`change`, { bubbles: true }) as never)
    )

    // Another device picked Dark after the refusal: the values that won are unchanged.
    const later = group({ value: { ...won, theme: `dark` }, version: 5 })
    await rerender(later.node)
    await click(`[data-e2e="preferences-save"]`)

    expect(later.calls).toEqual([[`save`, { locale: null, timeZone: null, hourCycle: `h12` }, 5]])
  })

  it(`saves an edited draft on the version it was made on, though another device saved since`, async () => {
    const first = group()
    await mount(first.node)
    await click(`[data-e2e="preferences-change-clock"]`)
    const select = $<HTMLSelectElement>(`[data-e2e="preferences-clock-select"]`)!
    select.value = `h12`
    await act(() =>
      void select.dispatchEvent(new window.Event(`change`, { bubbles: true }) as never)
    )

    // Another device saved Formats; this draft was made on version 0 and stays so.
    const later = group({ value: { ...DEFAULT_PREFERENCES, locale: `it-IT` }, version: 1 })
    await rerender(later.node)
    await click(`[data-e2e="preferences-save"]`)

    expect(later.calls).toEqual([[`save`, { locale: null, timeZone: null, hourCycle: `h12` }, 0]])
  })

  it(`saves an edited draft on the newer version when another device changed only the theme`, async () => {
    await mount(group().node)
    await click(`[data-e2e="preferences-change-clock"]`)
    const select = $<HTMLSelectElement>(`[data-e2e="preferences-clock-select"]`)!
    select.value = `h12`
    await act(() =>
      void select.dispatchEvent(new window.Event(`change`, { bubbles: true }) as never)
    )

    // Another device picked Dark: nothing this dialog edits changed, so the save is not refused.
    const later = group({ value: { ...DEFAULT_PREFERENCES, theme: `dark` }, version: 1 })
    await rerender(later.node)
    await click(`[data-e2e="preferences-save"]`)

    expect(later.calls).toEqual([[`save`, { locale: null, timeZone: null, hourCycle: `h12` }, 1]])
  })

  it(`follows another device's save while nothing is edited, and saves on its version`, async () => {
    await mount(group().node)
    await click(`[data-e2e="preferences-change-clock"]`)

    const later = group({ value: { ...DEFAULT_PREFERENCES, locale: `it-IT` }, version: 1 })
    await rerender(later.node)
    await click(`[data-e2e="preferences-save"]`)

    expect(later.calls).toEqual([[`save`, { locale: `it-IT`, timeZone: null, hourCycle: null }, 1]])
  })

  it(`offers this device's zone when the person picked another, and reports either answer`, async () => {
    const { node, calls } = group({
      value: { ...DEFAULT_PREFERENCES, timeZone: `Europe/Berlin` },
      device: { locale: `en-GB`, timeZone: `Asia/Tokyo` },
      otherZone: `Asia/Tokyo`,
    })
    await mount(node)

    expect($(`[data-e2e="preferences-other-zone"]`)?.textContent).toContain(
      `This device is on Tokyo time (GMT+9).`,
    )
    expect($(`[data-e2e="preferences-use-device-zone"]`)?.textContent).toBe(`Use Tokyo time`)
    expect($(`[data-e2e="preferences-keep-zone"]`)?.textContent).toBe(`Keep Berlin time`)
    await click(`[data-e2e="preferences-use-device-zone"]`)
    // Both buttons remove themselves; the focus lands on the row's own button, not the page.
    expect(document.activeElement?.getAttribute(`data-e2e`)).toBe(`preferences-change-timeZone`)
    $(`[data-e2e="preferences-keep-zone"]`)!.focus()
    await click(`[data-e2e="preferences-keep-zone"]`)
    expect(document.activeElement?.getAttribute(`data-e2e`)).toBe(`preferences-change-timeZone`)

    expect(calls).toEqual([[`use`], [`keep`]])
  })

  it(`offers nothing when the device is in the person's zone`, async () => {
    await mount(group({ value: { ...DEFAULT_PREFERENCES, timeZone: `Europe/Berlin` } }).node)

    expect($(`[data-e2e="preferences-other-zone"]`)).toBeNull()
  })

  it(`says a change from another device to a screen reader`, async () => {
    await mount(group({ announcement: `Preferences updated from another device.` }).node)

    const live = $(`[data-e2e="preferences-announcement"]`)!
    expect(live.getAttribute(`aria-live`)).toBe(`polite`)
    expect(live.textContent).toBe(`Preferences updated from another device.`)
  })
})

describe(`AdminPreferencesGroup`, () => {
  it(`shows a person's preferences read-only, with their local time now`, async () => {
    await mount(
      <FormatContext.Provider value={createFormatters({ locale: `en-GB`, timeZone: `UTC` })}>
        <AdminPreferencesGroup
          now={NOW}
          preferences={{
            value: { theme: `dark`, locale: `de-DE`, timeZone: `Asia/Tokyo`, hourCycle: `h12` },
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
