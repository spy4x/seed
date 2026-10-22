import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupRole } from "@domain/groups"
import {
  assertCanReadTags,
  assertCanWriteTags,
  assertTagRoom,
  parseTagExportEntry,
  parseTagRequest,
  TAG_MAX_PER_GROUP,
  TAG_NAME_MAX_LENGTH,
  tagCreatePayloadSchema,
  tagUpdatePayloadSchema,
} from "./+lib.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d112001"

describe("parsing a tag request", () => {
  it("trims the name and keeps the colour, in lower case", () => {
    const parsed = parseTagRequest(tagCreatePayloadSchema, {
      groupId,
      id,
      name: "  Work  ",
      color: "#1D4ED8",
    })

    expect(parsed.name).toBe("Work")
    expect(parsed.color).toBe("#1d4ed8")
  })

  it("counts an emoji as one character", () => {
    const name = "🙂".repeat(TAG_NAME_MAX_LENGTH)

    expect(parseTagRequest(tagCreatePayloadSchema, { groupId, id, name, color: "#4b5563" }).name)
      .toBe(name)
    expect(() =>
      parseTagRequest(tagCreatePayloadSchema, { groupId, id, name: name + "🙂", color: "#4b5563" })
    ).toThrow("Tag name must contain")
  })

  it("refuses a name with a NUL, a line break or an invisible character, on create and rename", () => {
    const base = { groupId, id, color: "#1d4ed8" }
    const message = "Tag name must not contain control or invisible characters"

    for (const name of ["a\u0000b", "a\nb", "a\u200bb", "a\u202eb"]) {
      expect(() => parseTagRequest(tagCreatePayloadSchema, { ...base, name })).toThrow(message)
      expect(() => parseTagRequest(tagUpdatePayloadSchema, { ...base, name, version: 1 }))
        .toThrow(message)
    }
    // A name people do type: letters of another script, an emoji family held by joiners.
    expect(parseTagRequest(tagCreatePayloadSchema, { ...base, name: "Zoë 👨‍👩‍👧 نقش‌ها" }).name)
      .toBe("Zoë 👨‍👩‍👧 نقش‌ها")
  })

  it("lets a group reach the cap and refuses the tag past it", () => {
    expect(() => assertTagRoom(TAG_MAX_PER_GROUP)).not.toThrow()
    expect(() => assertTagRoom(TAG_MAX_PER_GROUP + 1)).toThrow(
      `A group can hold at most ${TAG_MAX_PER_GROUP} tags`,
    )
  })

  it("refuses a blank name, a colour that is no #rrggbb and a missing version", () => {
    const base = { groupId, id, name: "Work", color: "#1d4ed8", version: 1 }

    expect(() => parseTagRequest(tagCreatePayloadSchema, { ...base, name: "  " })).toThrow()
    // The update payload, which takes `version`: the create payload would refuse that key first.
    expect(parseTagRequest(tagUpdatePayloadSchema, base).color).toBe("#1d4ed8")
    for (const color of ["blue", "#1d4ed", "#1d4ed8ff", "1d4ed8", "#gggggg"]) {
      expect(() => parseTagRequest(tagUpdatePayloadSchema, { ...base, color })).toThrow("color")
    }
    expect(() => parseTagRequest(tagUpdatePayloadSchema, { ...base, version: undefined })).toThrow()
  })
})

describe("who may use tags", () => {
  it("lets every member read and an editor write, and hides the group from a stranger", () => {
    expect(() => assertCanReadTags(GroupRole.VIEWER)).not.toThrow()
    expect(() => assertCanWriteTags(GroupRole.EDITOR)).not.toThrow()
    expect(() => assertCanWriteTags(GroupRole.VIEWER)).toThrow("Only an editor")
    expect(() => assertCanReadTags(null)).toThrow("Group not found")
  })
})

describe("reading a tag from an export file", () => {
  const entry = {
    id,
    name: "Home",
    color: "#1d4ed8",
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  }
  const problem = (value: unknown) => {
    try {
      parseTagExportEntry(value)
    } catch (error) {
      if (error instanceof Error) return error.message
      throw error
    }
    throw new Error(`The entry was accepted`)
  }

  it("names a missing field, a bad colour and a bad date in plain words", () => {
    const { name: _name, ...withoutName } = entry
    expect(problem(withoutName)).toBe(`the name is missing`)
    expect(problem({ ...entry, color: `pink` })).toBe(
      `the colour must be a hex colour like #1a2b3c`,
    )
    expect(problem({ ...entry, updatedAt: `soon` })).toBe(
      `the last change date must be a date and time`,
    )
    expect(problem({ ...entry, name: `x`.repeat(TAG_NAME_MAX_LENGTH + 1) })).toBe(
      `Tag name must contain 1 to ${TAG_NAME_MAX_LENGTH} characters`,
    )
  })
})
