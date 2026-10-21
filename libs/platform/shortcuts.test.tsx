/**
 * `useShortcuts` in a browser DOM (happy-dom): which key presses run a shortcut and which are left
 * alone, and the single-key switch kept on this device.
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

function Bindings({ rows }: { rows: readonly BoundShortcut[] }) {
  useShortcuts(rows)
  return null
}

/** Binds `n`, `?`, `g n` and `g g`, and returns what ran, by keys. */
async function mount(): Promise<string[]> {
  const ran: string[] = []
  const rows = ["n", "?", "g n", "g g"].map((keys) => ({ keys, run: () => void ran.push(keys) }))
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(<Bindings rows={[...rows, { keys: "esc" }]} />, root!))
  return ran
}

/** Presses `key` on `target` (the page by default), as a browser sends it. */
function press(
  key: string,
  target: EventTarget = document.body,
  init: { isComposing?: boolean } = {},
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

  it("does nothing while the person types in a field", async () => {
    const ran = await mount()
    const field = document.createElement("input")
    document.body.append(field)
    const event = press("n", field)
    press("g", field)
    press("n", field)
    expect(ran).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it("does nothing while an input method composes text", async () => {
    const ran = await mount()
    press("n", document.body, { isComposing: true })
    expect(ran).toEqual([])
  })

  it("does nothing inside another dialog or menu", async () => {
    const ran = await mount()
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    const button = document.createElement("button")
    dialog.append(button)
    document.body.append(dialog)
    press("?", button)
    press("n", button)
    const menu = document.createElement("div")
    menu.setAttribute("role", "menu")
    document.body.append(menu)
    press("n", menu)
    expect(ran).toEqual([])
  })

  it("does nothing for a key another handler already took", async () => {
    const ran = await mount()
    const taken = (event: Event) => event.preventDefault()
    document.body.addEventListener("keydown", taken)
    press("n")
    document.body.removeEventListener("keydown", taken)
    expect(ran).toEqual([])
  })

  it("binds nothing for a row that is only listed", async () => {
    const ran = await mount()
    const event = press("Escape")
    expect(ran).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it("stops listening once the rows that had a key are gone", async () => {
    const ran = await mount()
    await act(() =>
      render(<Bindings rows={[{ keys: "?", run: () => void ran.push("?") }]} />, root!)
    )
    press("n")
    press("?")
    expect(ran).toEqual(["?"])
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
