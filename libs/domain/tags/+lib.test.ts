import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupRole } from "@domain/groups"
import {
  assertCanReadTags,
  assertCanWriteTags,
  assertTagRoom,
  parseTagRequest,
  TAG_MAX_PER_GROUP,
  TAG_NAME_MAX_LENGTH,
  tagCreatePayloadSchema,
  tagUpdatePayloadSchema,
} from "./+lib.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d112001"

describe("parsing a tag request", () => {
  it("trims the name and keeps the colour", () => {
    const parsed = parseTagRequest(tagCreatePayloadSchema, {
      groupId,
      id,
      name: "  Work  ",
      color: "blue",
    })

    expect(parsed.name).toBe("Work")
    expect(parsed.color).toBe("blue")
  })

  it("counts an emoji as one character", () => {
    const name = "🙂".repeat(TAG_NAME_MAX_LENGTH)

    expect(parseTagRequest(tagCreatePayloadSchema, { groupId, id, name, color: "gray" }).name)
      .toBe(name)
    expect(() =>
      parseTagRequest(tagCreatePayloadSchema, { groupId, id, name: name + "🙂", color: "gray" })
    ).toThrow("Tag name must contain")
  })

  it("refuses a name with a NUL, a line break or an invisible character, on create and rename", () => {
    const base = { groupId, id, color: "blue" }
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

  it("refuses a blank name, a colour outside the palette and a missing version", () => {
    const base = { groupId, id, name: "Work", color: "blue", version: 1 }

    expect(() => parseTagRequest(tagCreatePayloadSchema, { ...base, name: "  " })).toThrow()
    expect(() => parseTagRequest(tagCreatePayloadSchema, { ...base, color: "pink" })).toThrow()
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
