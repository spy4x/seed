/**
 * The install offer driven in a browser DOM (happy-dom): where keyboard focus is after the card
 * leaves the page.
 */
import "@preact/signals"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { type ComponentChildren, render } from "preact"
import { act } from "preact/test-utils"
import { memoryStorage } from "@spy4x/platform/browser/storage"
import {
  createStoredInstallPrompt,
  type InstallPromptEvent,
  type InstallPromptStore,
  type InstallPromptTarget,
} from "@spy4x/preact-signals/install-prompt"
import { InstallOffer } from "./InstallOffer.tsx"

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
  root?.remove()
  root = null
})

/**
 * A store on a desktop browser that has just allowed install, as Chromium does by firing
 * `beforeinstallprompt`. `answer` is what the person picks in the browser's own dialog.
 */
function offeredStore(answer: "accepted" | "dismissed" = "accepted"): InstallPromptStore {
  let offer: (event: InstallPromptEvent) => void = () => {}
  const target: InstallPromptTarget = {
    addEventListener: (type, listener) => {
      if (type === "beforeinstallprompt") offer = listener
    },
    removeEventListener: () => {},
  }
  const store = createStoredInstallPrompt({
    storage: memoryStorage(),
    target,
    navigator: {},
    matchMedia: () => ({ matches: false }),
  })
  store.watch()
  offer({
    preventDefault: () => {},
    prompt: () => Promise.resolve(),
    userChoice: Promise.resolve({ outcome: answer }),
  })
  return store
}

/** The offer above a page, inside the `<main>` the app's shell draws. */
async function mount(store: InstallPromptStore, page: ComponentChildren): Promise<void> {
  root = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(root as never)
  await act(() =>
    render(
      <main>
        <InstallOffer store={store} />
        {page}
      </main>,
      root!,
    )
  )
}

/** Focuses the offer's button with this name and presses it, as Tab then Enter does. */
async function press(name: string): Promise<void> {
  const button = [...root!.querySelectorAll("button")].find((b) => b.textContent?.trim() === name)
  if (!button) throw new Error(`The offer has no "${name}" button`)
  button.focus()
  await act(async () => {
    button.click()
    // The browser's dialog answers through promises.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Whether the card is on the page. A boolean, because printing a DOM node in a failure takes over a minute. */
const offerShown = () => root!.querySelector(`section[aria-label="Install this app"]`) !== null
const focused = () => window.document.activeElement as unknown as HTMLElement

describe("InstallOffer", () => {
  it("moves focus to the page's heading after Not now", async () => {
    await mount(offeredStore(), <h1>Notes</h1>)
    expect(offerShown()).toBe(true)

    await press("Not now")

    expect(offerShown()).toBe(false)
    expect(focused().tagName).toBe("H1")
    expect(focused().textContent).toBe("Notes")
  })

  it("moves focus to the page's heading after the person accepts the install", async () => {
    await mount(offeredStore("accepted"), <h1>Notes</h1>)

    await press("Install")

    expect(offerShown()).toBe(false)
    expect(focused().tagName).toBe("H1")
  })

  it("moves focus to the page's heading when the person closes the browser's dialog", async () => {
    await mount(offeredStore("dismissed"), <h1>Notes</h1>)

    await press("Install")

    expect(offerShown()).toBe(false)
    expect(focused().tagName).toBe("H1")
  })
})
