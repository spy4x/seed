/** `clickAfterPalette`: a palette command's click, with focus left on the clicked control. */
import { expect } from "@std/expect"
import { afterAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { clickAfterPalette } from "./palette-attach.ts"

const window = new Window({ url: "http://app.localhost/" })
const doc = window.document as unknown as Document

afterAll(() => window.happyDOM.close())

/** Waits until the window's queued timers have run. */
const nextTask = () => new Promise((resolve) => window.setTimeout(resolve))

describe("clickAfterPalette", () => {
  it("clicks the button and leaves focus on it when the palette's close event comes after a timer", async () => {
    doc.body.innerHTML = `<button id="trigger">Search</button><button id="attach">Attach</button>` +
      `<dialog id="palette"></dialog>`
    const trigger = doc.getElementById("trigger")!
    const button = doc.getElementById("attach")!
    const palette = doc.getElementById("palette")!
    // The palette's own close handler sends focus back to its trigger.
    palette.addEventListener("close", () => trigger.focus())
    let clicks = 0
    button.addEventListener("click", () => clicks++)

    clickAfterPalette(doc, button)
    // A busy browser runs a timer before the dialog's queued close event.
    await nextTask()
    palette.dispatchEvent(new window.Event("close") as unknown as Event)
    await nextTask()

    expect(clicks).toBe(1)
    // By id: a failed match of two elements would print the whole page's object graph.
    expect(doc.activeElement?.id).toBe("attach")
  })
})
