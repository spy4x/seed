/** `movedToast`: what the toast after a move says. */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { movedToast } from "./note-toasts.ts"

describe("movedToast", () => {
  it("names the group one note moved to", () => {
    expect(movedToast(1, "Home")).toEqual({
      title: "Note moved",
      body: "The note was moved to Home.",
    })
  })

  it("counts the notes when several moved together", () => {
    expect(movedToast(3, "Home")).toEqual({
      title: "Notes moved",
      body: "3 notes were moved to Home.",
    })
  })
})
