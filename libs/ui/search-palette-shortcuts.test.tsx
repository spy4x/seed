/**
 * What the keyboard shortcuts (spy4x/seed#220) change in `SearchPalette`, in a browser DOM
 * (happy-dom): `/` opens it only while the single-key shortcuts are on, and its "New note" action
 * asks for the New note dialog instead of a page.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { type SearchChoice, SearchPalette, type SearchPaletteProps } from "./search-palette.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
}

beforeAll(() => {
  // The palette locks the page's scroll after reading its style; its hotkey listener tests its
  // target with `instanceof Element` and `HTMLElement`.
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    Element: window.Element,
    HTMLElement: window.HTMLElement,
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

async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 260)))
}

async function mount(overrides: Partial<SearchPaletteProps> = {}): Promise<SearchChoice[]> {
  const picked: SearchChoice[] = []
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(
      <SearchPalette
        searchNotes={() => Promise.resolve({ notes: [], onDevice: false })}
        groups={[]}
        currentGroup={{ id: "group-home", name: "Home", canWrite: true }}
        online
        onSelect={(choice) => void picked.push(choice)}
        {...overrides}
      />,
      root!,
    )
  )
  return picked
}

function dialog(): HTMLDialogElement {
  return document.querySelector<HTMLDialogElement>("dialog[data-e2e=search]")!
}

async function press(init: { key: string; code: string; ctrlKey?: boolean }): Promise<void> {
  await act(() => {
    document.body.dispatchEvent(
      new window.KeyboardEvent("keydown", { ...init, bubbles: true }) as unknown as Event,
    )
  })
  await settle()
}

describe("SearchPalette and the keyboard shortcuts", () => {
  it("does not open on / while the single keys are off, and still opens on Ctrl K", async () => {
    await mount({ slashKey: false })
    await press({ key: "/", code: "Slash" })
    expect(dialog().open).toBe(false)
    await press({ key: "k", code: "KeyK", ctrlKey: true })
    expect(dialog().open).toBe(true)
  })

  it("asks the app for the New note dialog when New note is picked", async () => {
    const picked = await mount()
    await press({ key: "k", code: "KeyK", ctrlKey: true })
    const row = [...document.querySelectorAll("[role=option]")]
      .find((candidate) => candidate.textContent?.startsWith("New note"))!
    expect(row.textContent).toContain("In Home")
    await act(() => {
      row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
    })
    expect(picked).toEqual([{ kind: "new-note" }])
  })
})
