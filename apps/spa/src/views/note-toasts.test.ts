/** `movedToast`: what the toast after a move says. */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { movedToast } from "./note-toasts.ts"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.json" with { type: "json" }

/** The `app` catalog's English, as a screen without a provider reads it. */
const EN = createTranslator({ language: `en`, catalogs: [{ source: app }] })

describe("movedToast", () => {
  it("names the group one note moved to", () => {
    expect(movedToast(EN, 1, "Home")).toEqual({
      title: "Note moved",
      body: "The note was moved to Home.",
    })
  })

  it("counts the notes when several moved together", () => {
    expect(movedToast(EN, 3, "Home")).toEqual({
      title: "Notes moved",
      body: "3 notes were moved to Home.",
    })
  })
})
