/**
 * `useShortcuts` in a browser DOM (happy-dom): which rows it binds through preact-ui's
 * `useHotkeys`, what the single-key switch unbinds, and the switch kept on this device. Where a
 * press is left alone (fields, input methods, dialogs, menus) is `useHotkeys`'s own, tested there.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { memoryStorage } from "@spy4x/platform/browser/storage"
import { type BoundShortcut, createSingleKeysSetting, useShortcuts } from "./shortcuts.ts"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
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

function Bindings({ rows, singleKeys }: { rows: readonly BoundShortcut[]; singleKeys: boolean }) {
  useShortcuts(rows, singleKeys)
  return null
}

/**
 * Binds `n`, `?`, `g n`, `g g` and `mod+k`, lists `esc` without binding it, and returns what ran,
 * by keys.
 */
async function mount(singleKeys = true): Promise<string[]> {
  const ran: string[] = []
  const rows = ["n", "?", "g n", "g g", "mod+k"].map((keys) => ({
    keys,
    run: () => void ran.push(keys),
  }))
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(<Bindings rows={[...rows, { keys: "esc" }]} singleKeys={singleKeys} />, root!)
  )
  return ran
}

/** Presses `key` on `target` (the page by default), as a browser sends it. */
function press(
  key: string,
  target: EventTarget = document.body,
  init: { ctrlKey?: boolean } = {},
): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  }) as unknown as KeyboardEvent
  target.dispatchEvent(event)
  return event
}

describe("useShortcuts", () => {
  it("runs a single key and cancels its default action", async () => {
    const ran = await mount()
    const event = press("n")
    expect(ran).toEqual(["n"])
    expect(event.defaultPrevented).toBe(true)
    press("?")
    expect(ran).toEqual(["n", "?"])
  })

  it("runs a g sequence on its second key, and g alone does nothing", async () => {
    const ran = await mount()
    press("g")
    expect(ran).toEqual([])
    press("n")
    expect(ran).toEqual(["g n"])
    press("g")
    press("g")
    expect(ran).toEqual(["g n", "g g"])
  })

  it("binds no single key while single keys are off, and keeps Ctrl K", async () => {
    const ran = await mount(false)
    for (const key of ["n", "?", "g", "n", "g", "g"]) press(key)
    expect(ran).toEqual([])
    const event = press("k", document.body, { ctrlKey: true })
    expect(ran).toEqual(["mod+k"])
    expect(event.defaultPrevented).toBe(true)
  })

  it("binds nothing for a row that is only listed", async () => {
    const ran = await mount()
    const event = press("Escape")
    expect(ran).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })
})

describe("createSingleKeysSetting", () => {
  it("is on until turned off, and remembers off on this device only", () => {
    const storage = memoryStorage()
    const setting = createSingleKeysSetting(storage)
    expect(setting.on.value).toBe(true)
    setting.set(false)
    expect(setting.on.value).toBe(false)
    expect(createSingleKeysSetting(storage).on.value).toBe(false)
    setting.set(true)
    expect(createSingleKeysSetting(storage).on.value).toBe(true)
  })
})
