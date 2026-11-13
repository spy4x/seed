/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { NOTES_OFF, NOTES_ON } from "../notes/setup.ts"
import { DATA_EXPORT_SECTIONS, dataExportSectionsOf } from "./data-export-sections.ts"

const names = (sections: readonly { name: string }[]) => sections.map(({ name }) => name)

Deno.test("with the notes off, the export has no notes, attachments or tags, and every other section", () => {
  expect(names(dataExportSectionsOf(NOTES_OFF))).toEqual(
    names(DATA_EXPORT_SECTIONS).filter((name) =>
      ![`notes`, `note_attachments`, `tags`].includes(name)
    ),
  )
})

Deno.test("with the notes on, the export has every section", () => {
  expect(dataExportSectionsOf(NOTES_ON)).toBe(DATA_EXPORT_SECTIONS)
})
