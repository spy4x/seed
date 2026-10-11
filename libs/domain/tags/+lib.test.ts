import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupRole } from "@domain/groups"
import {
  assertCanReadTags,
  assertCanWriteTags,
  parseTagRequest,
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
