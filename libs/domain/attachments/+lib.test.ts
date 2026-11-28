import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  ATTACHMENT_NAME_MAX_LENGTH,
  AttachmentError,
  attachmentListPayloadSchema,
  attachmentSignPayloadSchema,
  parseAttachmentRequest,
} from "./+lib.ts"

describe("parseAttachmentRequest", () => {
  const sign = (name: string, extra: Record<string, unknown> = {}) =>
    parseAttachmentRequest(attachmentSignPayloadSchema, {
      groupId: uuidV7(),
      recordId: uuidV7(),
      name,
      contentType: "image/png",
      size: 10,
      ...extra,
    })

  it("trims a file name and keeps one of the longest length", () => {
    expect(sign("  scan.png ").name).toBe("scan.png")
    const longest = "й".repeat(ATTACHMENT_NAME_MAX_LENGTH)
    expect(sign(longest).name).toBe(longest)
  })

  it("refuses an empty, too long or invisible name, an unknown field and a size below one", () => {
    for (
      const bad of [
        () => sign("   "),
        () => sign("a".repeat(ATTACHMENT_NAME_MAX_LENGTH + 1)),
        () => sign("scan\u0000.png"),
        () => sign("scan‮.png"),
        () => sign("scan.png", { extra: true }),
        () => sign("scan.png", { size: 0 }),
      ]
    ) {
      expect(bad).toThrow(AttachmentError)
    }
  })

  it("reads a kind's own record field as the record's id", () => {
    const groupId = uuidV7()
    const noteId = uuidV7()
    const parsed = parseAttachmentRequest(
      attachmentListPayloadSchema,
      { groupId, noteId },
      `noteId`,
    )
    expect(parsed).toEqual({ groupId, recordId: noteId })
  })

  it("refuses a recordId sent beside the kind's own record field, or in its place", () => {
    const groupId = uuidV7()
    expect(() =>
      parseAttachmentRequest(
        attachmentListPayloadSchema,
        { groupId, noteId: uuidV7(), recordId: uuidV7() },
        `noteId`,
      )
    ).toThrow(AttachmentError)
    expect(() =>
      parseAttachmentRequest(attachmentListPayloadSchema, { groupId, recordId: uuidV7() }, `noteId`)
    ).toThrow(AttachmentError)
  })
})
