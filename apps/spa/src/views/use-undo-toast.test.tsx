import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { signal } from "@preact/signals"
import type { notesStore, UndoOffer } from "../state/notes.ts"
import { toasts } from "../state/toasts.ts"
import { useUndoToast } from "./use-undo-toast.ts"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document }
const ownNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
  // A PC, so `mod` is Control and the key reads "Ctrl+Z" on every machine that runs the tests.
  Object.defineProperty(globalThis, "navigator", {
    value: { platform: "Linux x86_64" },
    configurable: true,
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  if (ownNavigator) Object.defineProperty(globalThis, "navigator", ownNavigator)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  root = null
  toasts.clear()
})

/** A store with only what the hook reads: the offer and the Undo that takes it back. */
function fakeStore() {
  const undone: string[] = []
  const undo = signal<UndoOffer | null>(null)
  const store = {
    undo,
    dismissUndo: () => {
      undo.value = null
    },
    undoDelete: () => {
      undone.push(undo.value?.id ?? "")
      return Promise.resolve(true)
    },
  } as unknown as typeof notesStore
  return { store, undo, undone }
}

/** Presses a key the way a person does, with Control held (`mod` outside Apple platforms). */
async function pressCtrl(
  key: string,
  target: { dispatchEvent(event: Event): boolean } = window.document.body as never,
): Promise<void> {
  await act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    )
  })
}

function Host({ store }: { store: typeof notesStore }) {
  useUndoToast(store)
  return null
}

async function mount(store: typeof notesStore): Promise<void> {
  root = window.document.createElement("div") as unknown as HTMLElement
  await act(() => render(<Host store={store} />, root!))
}

describe("useUndoToast", () => {
  it("offers Undo in the app's toast list for as long as the delete can be taken back", async () => {
    const { store, undo, undone } = fakeStore()
    await mount(store)

    await act(() => {
      undo.value = { id: "n1", title: "Milk", until: Date.now() + 10_000 }
    })

    const [toast] = toasts.list.value
    expect(toasts.list.value).toHaveLength(1)
    expect(toast.body).toBe(`"Milk" was deleted. Press Ctrl+Z to undo.`)
    expect(toast.dataE2E).toBe("note-undo-toast")
    expect(toast.duration).toBeGreaterThan(9_000)
    expect(toast.duration).toBeLessThanOrEqual(10_000)
    expect(toast.action?.label).toBe("Undo")
    expect(toast.action?.dataE2E).toBe("note-undo")
    toast.action?.onAction()
    expect(undone).toEqual(["n1"])
  })

  it("takes the note back with Ctrl Z while the offer lasts, and not in a text field or after", async () => {
    const { store, undo, undone } = fakeStore()
    await mount(store)
    await pressCtrl("z")
    expect(undone).toEqual([])

    await act(() => {
      undo.value = { id: "n1", title: "Milk", until: Date.now() + 10_000 }
    })
    const field = window.document.createElement("input")
    window.document.body.appendChild(field)
    await pressCtrl("z", field as never)
    field.remove()
    expect(undone).toEqual([])

    await pressCtrl("z")
    expect(undone).toEqual(["n1"])

    await act(() => {
      undo.value = null
    })
    await pressCtrl("z")
    expect(undone).toEqual(["n1"])
  })

  it("takes the toast away once the offer ends", async () => {
    const { store, undo } = fakeStore()
    await mount(store)
    await act(() => {
      undo.value = { id: "n1", title: "", until: Date.now() + 10_000 }
    })
    expect(toasts.list.value[0].body).toBe("The note was deleted. Press Ctrl+Z to undo.")

    await act(() => {
      undo.value = null
    })

    expect(toasts.list.value).toHaveLength(0)
  })

  it("takes the toast away when the notes list leaves the screen", async () => {
    const { store, undo } = fakeStore()
    await mount(store)
    await act(() => {
      undo.value = { id: "n1", title: "Milk", until: Date.now() + 10_000 }
    })

    await act(() => render(null, root!))

    expect(toasts.list.value).toHaveLength(0)
  })

  it("does not show an offer that ended while another page was open", async () => {
    const { store, undo } = fakeStore()
    undo.value = { id: "n1", title: "Milk", until: Date.now() - 1 }

    await mount(store)

    expect(toasts.list.value).toHaveLength(0)
  })

  it("does not bring back a toast the person dismissed when they return to the list", async () => {
    const { store, undo } = fakeStore()
    await mount(store)
    await act(() => {
      undo.value = { id: "n1", title: "Milk", until: Date.now() + 10_000 }
    })

    // What Toastr's Dismiss does: onDismiss={toasts.remove}.
    await act(() => toasts.remove("n1"))
    await act(() => render(null, root!))
    await mount(store)

    expect(toasts.list.value).toHaveLength(0)
  })
})
