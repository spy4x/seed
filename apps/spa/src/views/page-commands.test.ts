import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.json" with { type: "json" }
import appRu from "@i18n/app/ru.json" with { type: "json" }
import { pageCommands } from "./page-commands.ts"

/** The `app` catalog in Russian, as the SPA reads it for a person who chose Russian. */
const RU = createTranslator({ language: `ru`, catalogs: [{ source: app, translation: appRu }] })

describe("the open page's commands in the search palette", () => {
  it("label the overview's commands in the person's language and keep their English as aliases", () => {
    expect(pageCommands(RU, { overview: true, noteEditor: false })).toEqual([
      { id: "overview-range", label: RU.t(`Shortcuts.dateRange`), aliases: ["Change date range"] },
      {
        id: "overview-customise",
        label: RU.t(`Shortcuts.customise`),
        aliases: ["Customise overview"],
      },
    ])
    expect(RU.t(`Shortcuts.dateRange`)).not.toBe("Change date range")
  })

  it("offer the note page's attach command, and nothing on another page", () => {
    expect(pageCommands(RU, { overview: false, noteEditor: true })?.map((c) => c.aliases))
      .toEqual([["Attach files to this note"]])
    expect(pageCommands(RU, { overview: false, noteEditor: false })).toBeUndefined()
  })
})
