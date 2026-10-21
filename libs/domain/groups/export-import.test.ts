import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupError, groupExportFileName, parseGroupImportBody } from "./+lib.ts"

describe("groupExportFileName", () => {
  const at = new Date("2026-10-21T23:30:00.000Z")

  it("names the file after the group and the UTC date", () => {
    expect(groupExportFileName("Family & Friends", at)).toBe("family-friends-2026-10-21.json")
    expect(groupExportFileName("Café Noël", at)).toBe("cafe-noel-2026-10-21.json")
  })

  it("falls back to group for a name with no letter or digit", () => {
    expect(groupExportFileName("🏡 ✨", at)).toBe("group-2026-10-21.json")
  })
})

describe("parseGroupImportBody", () => {
  it("takes the file and an optional name", () => {
    expect(parseGroupImportBody({ file: { a: 1 } })).toEqual({ name: null, file: { a: 1 } })
    expect(parseGroupImportBody({ file: 1, name: "Ours" })).toEqual({ name: "Ours", file: 1 })
  })

  it("refuses a body without the file, with another field, or with a name that is not text", () => {
    for (const body of [null, [], {}, { file: 1, extra: 2 }, { file: 1, name: 5 }]) {
      expect(() => parseGroupImportBody(body)).toThrow(GroupError)
    }
  })
})
