import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { GroupError, groupExportFileName, parseGroupImportBody, plainEntryProblem } from "./+lib.ts"

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

describe("plainEntryProblem", () => {
  const schema = type({
    id: /^[0-9a-f]+$/,
    body: "string",
    tagIds: type(/^[0-9a-f]+$/).array(),
    createdAt: "string.date.iso",
    "+": "reject",
  })
  const labels = { body: "text", tagIds: "tags", "tagIds[]": "tag id", createdAt: "creation date" }
  const valid = {
    id: "ab",
    body: "",
    tagIds: [],
    createdAt: "2026-10-01T09:00:00.000Z",
  }
  const wording = (value: unknown) => {
    const result = schema(value)
    if (!(result instanceof type.errors)) throw new Error("The value was accepted")
    return plainEntryProblem(result, "note", labels)
  }

  it("says a missing field, a wrong type and an unknown field in plain words", () => {
    const { body: _body, ...withoutBody } = valid
    expect(wording(withoutBody)).toBe("the text is missing")
    expect(wording({ ...valid, body: 5 })).toBe("the text must be text")
    expect(wording({ ...valid, tagIds: "x" })).toBe("the tags must be a list")
    expect(wording({ ...valid, extra: 1 })).toBe(`it holds "extra", which a note does not have`)
    expect(wording(5)).toBe("it is not a note")
  })

  it("says a bad date, and a bad id in a list in plain words", () => {
    expect(wording({ ...valid, createdAt: "yesterday" })).toBe(
      "the creation date must be a date and time",
    )
    expect(wording({ ...valid, tagIds: ["zz"] })).toBe("the tag id is not valid")
  })
})
