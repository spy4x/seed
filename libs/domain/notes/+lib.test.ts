import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupRole } from "@domain/groups"
import {
  assertCanReadNotes,
  assertCanWriteNotes,
  NOTE_BODY_MAX_LENGTH,
  NOTE_MOVE_MAX,
  NOTE_TAG_MAX,
  NOTE_TITLE_MAX_LENGTH,
  noteCreatePayloadSchema,
  noteCreateRequestSchema,
  noteDeleteRequestSchema,
  NoteError,
  noteListPayloadSchema,
  noteMovePayloadSchema,
  noteMoveRequestSchema,
  noteRestorePayloadSchema,
  noteRestoreRequestSchema,
  noteUpdateRequestSchema,
  NoteVersionConflictError,
  parseNoteMoveRequest,
  parseNoteRequest,
} from "./+lib.ts"
import { isUuid, uuidV7 } from "@spy4x/platform/universal/uuid"

const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof NoteError ? error.code : `not a NoteError: ${error}`
  }
}

describe("note requests", () => {
  it("accepts a create with a UUID id of version 4 or version 7 and trims the title", () => {
    expect(isUuid(id, 4)).toBe(true)
    expect(
      parseNoteRequest(noteCreateRequestSchema, { id: uuidV7(), title: "New", body: "" }).title,
    ).toBe("New")

    const parsed = parseNoteRequest(
      noteCreateRequestSchema,
      { id, title: "  Groceries  ", body: "milk" },
    )
    expect(parsed).toEqual({ id, title: "Groceries", body: "milk" })
  })

  for (
    const [name, schema, value] of [
      ["a create that names a user", noteCreateRequestSchema, {
        id,
        title: "a",
        body: "",
        userId: 1,
      }],
      ["a create with an uppercase id", noteCreateRequestSchema, {
        id: id.toUpperCase(),
        title: "a",
        body: "",
      }],
      ["a create with a blank title", noteCreateRequestSchema, { id, title: "   ", body: "" }],
      ["a create with a title one character too long", noteCreateRequestSchema, {
        id,
        title: "é".repeat(NOTE_TITLE_MAX_LENGTH + 1),
        body: "",
      }],
      ["a create with a body one character too long", noteCreateRequestSchema, {
        id,
        title: "a",
        body: "x".repeat(NOTE_BODY_MAX_LENGTH + 1),
      }],
      ["an update without a version", noteUpdateRequestSchema, { title: "a", body: "" }],
      ["an update with version zero", noteUpdateRequestSchema, {
        title: "a",
        body: "",
        version: 0,
      }],
      ["an update with a fractional version", noteUpdateRequestSchema, {
        title: "a",
        body: "",
        version: 1.5,
      }],
      ["a delete with a string version", noteDeleteRequestSchema, { version: "2" }],
      ["a socket create without a group", noteCreatePayloadSchema, { id, title: "a", body: "" }],
      ["a list above the largest page", noteListPayloadSchema, { groupId, limit: 101 }],
      ["a list with an empty cursor", noteListPayloadSchema, { groupId, cursor: "" }],
      ["a list of deleted notes with a string flag", noteListPayloadSchema, {
        groupId,
        deleted: "true",
      }],
      ["a restore with a field of its own", noteRestoreRequestSchema, { version: 2 }],
      ["a socket restore without a note", noteRestorePayloadSchema, { groupId }],
    ] as const
  ) {
    it(`rejects ${name}`, () => {
      expect(codeOf(() => parseNoteRequest(schema, value))).toBe("INVALID_REQUEST")
    })
  }

  it("accepts an empty restore body, a socket restore and a list of deleted notes", () => {
    expect(parseNoteRequest(noteRestoreRequestSchema, {})).toEqual({})
    expect(parseNoteRequest(noteRestorePayloadSchema, { groupId, id })).toEqual({ groupId, id })
    expect(parseNoteRequest(noteListPayloadSchema, { groupId, deleted: true }).deleted).toBe(true)
  })

  it("counts an emoji as one character of the title", () => {
    const title = "😀".repeat(NOTE_TITLE_MAX_LENGTH)
    expect(parseNoteRequest(noteCreateRequestSchema, { id, title, body: "" }).title)
      .toBe(title)
  })

  it("refuses a NUL or half a surrogate pair in the title, on create and update", () => {
    for (const title of ["a\u0000b", "a\ud800b"]) {
      expect(codeOf(() => parseNoteRequest(noteCreateRequestSchema, { id, title, body: "" })))
        .toBe("INVALID_REQUEST")
      expect(
        codeOf(() => parseNoteRequest(noteUpdateRequestSchema, { title, body: "", version: 1 })),
      ).toBe("INVALID_REQUEST")
    }
    expect(() => parseNoteRequest(noteCreateRequestSchema, { id, title: "a\u0000b", body: "" }))
      .toThrow("Note title must not contain a NUL or a broken character")
  })

  it("refuses a NUL or half a surrogate pair in the body, on create and update", () => {
    for (const body of ["a\u0000b", "a\ud800b"]) {
      expect(codeOf(() => parseNoteRequest(noteCreateRequestSchema, { id, title: "T", body })))
        .toBe("INVALID_REQUEST")
      expect(
        codeOf(() => parseNoteRequest(noteUpdateRequestSchema, { title: "T", body, version: 1 })),
      ).toBe("INVALID_REQUEST")
    }
    expect(() => parseNoteRequest(noteCreateRequestSchema, { id, title: "T", body: "a\u0000b" }))
      .toThrow("Note body must not contain a NUL or a broken character")
  })

  it("keeps a line break, a tab and an emoji in the title and the body", () => {
    const text = "one\ttwo\nthree 😀"
    expect(parseNoteRequest(noteCreateRequestSchema, { id, title: text, body: text }))
      .toEqual({ id, title: text, body: text })
  })
})

describe("note tags", () => {
  const tagId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d112001"

  it("accepts tag ids on a create and an update, and drops a repeated id", () => {
    const created = parseNoteRequest(
      noteCreateRequestSchema,
      { id, title: "a", body: "", tagIds: [tagId, tagId] },
    )
    const updated = parseNoteRequest(
      noteUpdateRequestSchema,
      { title: "a", body: "", tagIds: [tagId], version: 1 },
    )

    expect(created.tagIds).toEqual([tagId])
    expect(updated.tagIds).toEqual([tagId])
  })

  it("leaves tag ids out when the request names none, so an update keeps the tags", () => {
    const parsed = parseNoteRequest(noteUpdateRequestSchema, { title: "a", body: "", version: 1 })

    expect("tagIds" in parsed).toBe(false)
  })

  it("refuses a tag id that is not a UUID and more tags than a note may carry", () => {
    const tooMany = Array.from({ length: NOTE_TAG_MAX + 1 }, () => uuidV7())

    expect(
      codeOf(() =>
        parseNoteRequest(noteCreateRequestSchema, { id, title: "a", body: "", tagIds: ["nope"] })
      ),
    ).toBe("INVALID_REQUEST")
    expect(
      codeOf(() =>
        parseNoteRequest(noteCreateRequestSchema, { id, title: "a", body: "", tagIds: tooMany })
      ),
    ).toBe("INVALID_REQUEST")
  })
})

describe("note authorization", () => {
  it("lets every member read and answers a stranger as if the group did not exist", () => {
    for (const role of [GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN, GroupRole.OWNER]) {
      expect(codeOf(() => assertCanReadNotes(role))).toBe(null)
    }
    expect(codeOf(() => assertCanReadNotes(null))).toBe("GROUP_NOT_FOUND")
  })

  it("lets an editor and above write, and refuses a viewer", () => {
    for (const role of [GroupRole.EDITOR, GroupRole.ADMIN, GroupRole.OWNER]) {
      expect(codeOf(() => assertCanWriteNotes(role))).toBe(null)
    }
    expect(codeOf(() => assertCanWriteNotes(GroupRole.VIEWER))).toBe("ROLE_INSUFFICIENT")
    expect(codeOf(() => assertCanWriteNotes(null))).toBe("GROUP_NOT_FOUND")
  })
})

describe("note version conflict", () => {
  it("is a VERSION_CONFLICT that carries the note's current version", () => {
    const error = new NoteVersionConflictError(4)
    expect(error).toBeInstanceOf(NoteError)
    expect(error.code).toBe("VERSION_CONFLICT")
    expect(error.currentVersion).toBe(4)
  })
})

describe("note move request", () => {
  const toGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"

  it("accepts the target group and one to NOTE_MOVE_MAX distinct note ids", () => {
    const one = parseNoteMoveRequest(noteMoveRequestSchema, { toGroupId, noteIds: [id] }, groupId)
    const many = Array.from({ length: NOTE_MOVE_MAX }, () => uuidV7())

    expect(one).toEqual({ toGroupId, noteIds: [id] })
    expect(parseNoteMoveRequest(noteMoveRequestSchema, { toGroupId, noteIds: many }, groupId))
      .toEqual({ toGroupId, noteIds: many })
  })

  it("refuses an empty list, too many notes, a repeated note and a field it does not know", () => {
    const tooMany = Array.from({ length: NOTE_MOVE_MAX + 1 }, () => uuidV7())
    const refused = [
      { toGroupId, noteIds: [] },
      { toGroupId, noteIds: tooMany },
      { toGroupId, noteIds: [id, id] },
      { toGroupId, noteIds: [id], extra: 1 },
      { toGroupId: "not-a-uuid", noteIds: [id] },
    ]

    for (const value of refused) {
      expect(codeOf(() => parseNoteMoveRequest(noteMoveRequestSchema, value, groupId))).toBe(
        "INVALID_REQUEST",
      )
    }
  })

  it("answers SAME_GROUP when the target is the group the notes are in", () => {
    expect(
      codeOf(() =>
        parseNoteMoveRequest(noteMoveRequestSchema, { toGroupId: groupId, noteIds: [id] }, groupId)
      ),
    ).toBe("SAME_GROUP")
  })

  it("reads the source group from the socket payload, not from the body's own claim", () => {
    const parsed = parseNoteMoveRequest(
      noteMovePayloadSchema,
      { groupId, toGroupId, noteIds: [id] },
      groupId,
    )

    expect(parsed.groupId).toBe(groupId)
  })
})
