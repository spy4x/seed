import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { signal } from "@preact/signals"
import type { UnsentView, UnsentWait } from "../modules.ts"
import { createSignOutCheck } from "./sign-out-check.ts"

/** A wait that records whether it was stopped. */
function waitFor(): UnsentWait & { disposed: boolean } {
  const view = signal({ unsent: 1, conflicts: 0, state: "ask" } as UnsentView)
  return {
    view,
    send: () => {},
    disposed: false,
    dispose() {
      this.disposed = true
    },
  }
}

describe("the sign-out press", () => {
  it("reads the queue once and asks once when pressed twice while reading", async () => {
    let reads = 0
    let found: (wait: UnsentWait | null) => void = () => {}
    const asked: UnsentWait[] = []
    const press = createSignOutCheck({
      watch: () => (reads++, new Promise((resolve) => found = resolve)),
      ask: (wait) => asked.push(wait),
      signOutNow: () => {},
      mounted: () => true,
    })

    const first = press()
    const second = press()
    found(waitFor())
    await Promise.all([first, second])

    expect({ reads, asked: asked.length }).toEqual({ reads: 1, asked: 1 })
  })

  it("signs out at once when nothing waits", async () => {
    let signedOut = 0
    const press = createSignOutCheck({
      watch: () => Promise.resolve(null),
      ask: () => {
        throw new Error("nothing waits, so nothing is asked")
      },
      signOutNow: () => signedOut++,
      mounted: () => true,
    })

    await press()

    expect(signedOut).toBe(1)
  })

  it("stops the wait and shows nothing when the page is gone before the read ends", async () => {
    const wait = waitFor()
    let shown = 0
    const press = createSignOutCheck({
      watch: () => Promise.resolve(wait),
      ask: () => shown++,
      signOutNow: () => shown++,
      mounted: () => false,
    })

    await press()

    expect({ disposed: wait.disposed, shown }).toEqual({ disposed: true, shown: 0 })
  })

  it("reads again on a later press once the first read ended", async () => {
    let reads = 0
    const press = createSignOutCheck({
      watch: () => (reads++, Promise.resolve(null)),
      ask: () => {},
      signOutNow: () => {},
      mounted: () => true,
    })

    await press()
    await press()

    expect(reads).toBe(2)
  })
})
