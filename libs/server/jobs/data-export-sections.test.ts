/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { NOTES_OFF, NOTES_ON } from "../notes/setup.ts"
import { DATA_EXPORT_SECTIONS, dataExportSectionsOf } from "./data-export-sections.ts"

const names = (sections: readonly { name: string }[]) => sections.map(({ name }) => name)

Deno.test("with the notes off, the export has no notes or attachments, and every other section, tags included", () => {
  const off = names(dataExportSectionsOf(NOTES_OFF))
  expect(off).toEqual(
    names(DATA_EXPORT_SECTIONS).filter((name) => ![`notes`, `note_attachments`].includes(name)),
  )
  expect(off).toContain(`tags`)
})

Deno.test("with the notes on, the export has every section", () => {
  expect(dataExportSectionsOf(NOTES_ON)).toBe(DATA_EXPORT_SECTIONS)
})
