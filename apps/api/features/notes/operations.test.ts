import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import {
  type NoteCreateCommand,
  NoteError,
  type NoteListQuery,
  type NoteLocateQuery,
  type NoteMoveCommand,
  type NoteRestoreCommand,
} from "@domain/notes"
import { createNoteOperations } from "./operations.ts"
import { DEFAULT_NOTE_LIST_LIMIT } from "./list.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const actor = {
  userId: 7,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
}
const signal = new AbortController().signal

function harness() {
  const seen: {
    create: NoteCreateCommand | null
    list: NoteListQuery | null
    locate: NoteLocateQuery | null
    move: NoteMoveCommand | null
    restore: NoteRestoreCommand | null
  } = { create: null, list: null, locate: null, move: null, restore: null }
  const unused = () => Promise.reject(new Error("not used"))
  const requests = createNoteOperations({
    create(command) {
      seen.create = command
      return unused()
    },
    update: unused,
    delete: unused,
    restore(command) {
      seen.restore = command
      return unused()
    },
    move(command) {
      seen.move = command
      return unused()
    },
    get: unused,
    locate(query) {
      seen.locate = query
      return Promise.resolve({ groupId })
    },
    list(query) {
      seen.list = query
      return Promise.resolve({ notes: [], nextPageKey: null })
    },
    cursor: { encode: unused, decode: unused },
  })
  return { requests, seen }
}

describe("note socket requests", () => {
  it("declares the writes as commands and the reads as queries", () => {
    const { requests } = harness()

    expect(Object.fromEntries(Object.entries(requests).map(([name, r]) => [name, r.kind])))
      .toEqual({
        "note.create": "command",
        "note.update": "command",
        "note.delete": "command",
        "note.restore": "command",
        "note.move": "command",
        "note.list": "query",
        "note.get": "query",
        "note.locate": "query",
      })
  })

  it("dispatches a create with the socket's actor, request id and idempotency key", async () => {
    const { requests, seen } = harness()

    await Promise.resolve(requests["note.create"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { groupId, id, title: " Plan ", body: "b" },
    })).catch(() => {})

    expect(seen.create?.data).toEqual({
      actor,
      groupId,
      id,
      title: "Plan",
      body: "b",
      requestId: "req-1",
      idempotencyKey: "key-1",
    })
  })

  it("dispatches a restore with the socket's actor, the note, the request id and the key", async () => {
    const { requests, seen } = harness()

    await Promise.resolve(requests["note.restore"].handle({
      actor,
      requestId: "req-8",
      signal,
      idempotencyKey: "key-8",
      payload: { groupId, id },
    })).catch(() => {})

    expect(seen.restore?.data).toEqual({
      actor,
      groupId,
      id,
      requestId: "req-8",
      idempotencyKey: "key-8",
    })
  })

  it("dispatches a move with the payload's group as the source, the request id and the key", async () => {
    const { requests, seen } = harness()
    const toGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"

    await Promise.resolve(requests["note.move"].handle({
      actor,
      requestId: "req-9",
      signal,
      idempotencyKey: "key-9",
      payload: { groupId, toGroupId, noteIds: [id] },
    })).catch(() => {})

    expect(seen.move?.data).toEqual({
      actor,
      groupId,
      toGroupId,
      noteIds: [id],
      requestId: "req-9",
      idempotencyKey: "key-9",
    })
  })

  it("refuses a move into the group the notes are in, before anything is dispatched", async () => {
    const { requests, seen } = harness()

    await expect(requests["note.move"].handle({
      actor,
      requestId: "req-9",
      signal,
      idempotencyKey: "key-9",
      payload: { groupId, toGroupId: groupId, noteIds: [id] },
    })).rejects.toMatchObject({ code: "SAME_GROUP" })
    expect(seen.move).toBe(null)
  })

  it("refuses a create payload that names a user, before anything is dispatched", async () => {
    const { requests, seen } = harness()

    await expect(requests["note.create"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { groupId, id, title: "Plan", body: "", userId: 999 },
    })).rejects.toBeInstanceOf(NoteError)
    expect(seen.create).toBe(null)
  })

  it("dispatches a locate with the socket's actor and the note id, and nothing else", async () => {
    const { requests, seen } = harness()

    const found = await requests["note.locate"].handle({
      actor,
      requestId: "req-3",
      signal,
      payload: { id },
    })

    expect(seen.locate?.data).toEqual({ actor, id })
    expect(found).toEqual({ groupId })
  })

  it("refuses a locate payload that names a group, before anything is dispatched", async () => {
    const { requests, seen } = harness()

    await expect(requests["note.locate"].handle({
      actor,
      requestId: "req-3",
      signal,
      payload: { id, groupId },
    })).rejects.toBeInstanceOf(NoteError)
    expect(seen.locate).toBe(null)
  })

  it("lists the first page of the default size when the payload names only the group", async () => {
    const { requests, seen } = harness()

    const page = await requests["note.list"].handle({
      actor,
      requestId: "req-2",
      signal,
      payload: { groupId },
    })

    expect(seen.list?.data).toEqual({ actor, groupId, page: { limit: DEFAULT_NOTE_LIST_LIMIT } })
    expect(page).toEqual({ notes: [], nextCursor: null })
  })
})
