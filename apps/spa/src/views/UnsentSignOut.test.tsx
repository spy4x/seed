/**
 * The sign-out question driven in a browser DOM (happy-dom): what it says, what each button does,
 * and the sign-out that follows by itself once the queue is empty.
 */
import { computed, signal } from "@preact/signals"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import type { UnsentView, UnsentWait } from "../modules.ts"
import { UnsentSignOut } from "./UnsentSignOut.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle }

beforeAll(() => {
  // A dialog locks the page's scroll after reading its style.
  Object.assign(globalThis, {
    document: window.document,
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
  root?.remove()
  root = null
})

/** A wait whose view the test sets, recording how often `send` ran. */
function fakeWait(start: Partial<UnsentView> = {}) {
  const state = signal<UnsentView>({
    unsent: 3,
    conflicts: 0,
    reviewGroupId: null,
    sent: 0,
    state: "ask",
    ...start,
  })
  let sends = 0
  const wait: UnsentWait = {
    view: computed(() => state.value),
    send: () => void sends++,
    dispose: () => {},
  }
  return { wait, state, sends: () => sends }
}

/** Mounts the question with ports that record what they were called with. */
async function mount(wait: UnsentWait) {
  const calls: string[] = []
  root = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(root as never)
  await act(() =>
    render(
      <UnsentSignOut
        wait={wait}
        onSignOut={() => calls.push("sign out")}
        onCancel={() => calls.push("cancel")}
        onReview={(groupId) => calls.push(`review ${groupId}`)}
      />,
      root!,
    )
  )
  return calls
}

const button = (e2e: string) =>
  window.document.querySelector(`[data-e2e="${e2e}"]`) as unknown as HTMLButtonElement | null

describe("UnsentSignOut", () => {
  it("asks with the number of unsent changes", async () => {
    await mount(fakeWait().wait)

    expect(window.document.querySelector("[data-e2e=unsent-dialog] h2")?.textContent)
      .toBe("You have 3 unsent changes")
  })

  it("says that signing out now deletes the unsent changes, never that they stay", async () => {
    await mount(fakeWait().wait)

    const text = window.document.querySelector("[data-e2e=unsent-dialog]")?.textContent ?? ""
    expect(text).toContain(
      "If you sign out now, they're deleted from this browser and never reach the server.",
    )
    expect(text).not.toContain("stay on this browser")
  })

  it("starts sending on Send, then sign out, and does not sign out yet", async () => {
    const { wait, sends } = fakeWait()
    const calls = await mount(wait)

    await act(() => button("unsent-wait")!.click())

    expect([sends(), calls]).toEqual([1, []])
  })

  it("signs out by itself once nothing is left to send", async () => {
    const { wait, state } = fakeWait({ state: "sending" })
    const calls = await mount(wait)

    await act(() => {
      state.value = { ...state.value, unsent: 0, sent: 3 }
    })

    expect(calls).toEqual(["sign out"])
    expect(button("unsent-dialog")).toBeNull()
  })

  it("signs out at once on Sign out anyway, and stays on Cancel", async () => {
    const calls = await mount(fakeWait().wait)

    await act(() => button("unsent-sign-out-anyway")!.click())
    await act(() => button("unsent-cancel")!.click())

    expect(calls).toEqual(["sign out", "cancel"])
  })

  it("says Waiting… on the busy button while the device is offline", async () => {
    await mount(fakeWait({ state: "offline" }).wait)

    expect(button("unsent-wait")?.textContent).toBe("Waiting…")
  })

  it("says Sending… on the busy button while it sends", async () => {
    await mount(fakeWait({ state: "sending" }).wait)

    expect(button("unsent-wait")?.textContent).toBe("Sending…")
  })

  it("offers Review changes with the group to open once only changes needing a choice are left", async () => {
    const { wait } = fakeWait({ unsent: 1, conflicts: 1, reviewGroupId: "g-2", state: "sending" })
    const calls = await mount(wait)

    await act(() => button("unsent-review")!.click())

    expect(calls).toEqual(["review g-2"])
  })
})
