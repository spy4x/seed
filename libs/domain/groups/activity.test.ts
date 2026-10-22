/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  ACTIVITY_KINDS,
  type ActivityEvent,
  assertCanViewActivity,
  describeActivity,
  type GroupError,
  GroupRole,
  OPERATOR_DETAIL,
} from "./+lib.ts"

const ada = { userId: 1, name: "Ada" }

function say(
  kind: string,
  parts: Partial<Pick<ActivityEvent, "actor" | "target" | "details">> = {},
) {
  return describeActivity({ kind, actor: ada, target: null, details: {}, ...parts })
}

function codeOf(role: GroupRole | null): string | undefined {
  try {
    assertCanViewActivity(role)
  } catch (error) {
    return (error as GroupError).code
  }
}

Deno.test("activity: only an admin or the owner may read the log", () => {
  expect(codeOf(GroupRole.OWNER)).toBeUndefined()
  expect(codeOf(GroupRole.ADMIN)).toBeUndefined()
  expect(codeOf(GroupRole.EDITOR)).toBe("ROLE_INSUFFICIENT")
  expect(codeOf(GroupRole.VIEWER)).toBe("ROLE_INSUFFICIENT")
  expect(codeOf(null)).toBe("GROUP_NOT_FOUND")
})

Deno.test("activity: a restored note reads as a sentence, with the title when there is one", () => {
  expect(say("note.restored", { details: { title: "Plan" } })).toBe("Ada restored the note “Plan”")
  expect(say("note.restored")).toBe("Ada restored a note")
})

Deno.test("activity: a move reads as a sentence with the count and the group", () => {
  expect(say("note.moved_out", { details: { count: 3, groupName: "Family" } })).toBe(
    "Ada moved 3 notes to Family",
  )
  expect(say("note.moved_out", { details: { count: 1, groupName: "Family" } })).toBe(
    "Ada moved 1 note to Family",
  )
  expect(say("note.moved_out", { details: { groupName: "Family" } })).toBe(
    "Ada moved some notes to Family",
  )
})

Deno.test("activity: moving all of a group's data reads as a sentence in both groups", () => {
  expect(say("group.data_moved_out", { details: { count: 5, groupName: "Family" } })).toBe(
    "Ada moved all the group's data (5 items) to Family",
  )
  expect(say("group.data_moved_out", { details: { count: 1 } })).toBe(
    "Ada moved all the group's data (1 item) to another group",
  )
  expect(say("group.data_moved_in", { details: { count: 5 } })).toBe(
    "Ada moved all of another group's data (5 items) here",
  )
})

Deno.test("activity: a role change names both roles and the member", () => {
  expect(
    say("group.member_role_changed", {
      target: { userId: 2, name: "Ed" },
      details: { from: GroupRole.EDITOR, to: GroupRole.ADMIN },
    }),
  ).toBe("Ada changed Ed from an editor to an admin")
})

Deno.test("activity: a person with no name and no e-mail reads as Someone", () => {
  expect(say("group.renamed", { actor: { userId: 5, name: "" } })).toBe("Someone renamed the group")
  expect(say("future.kind")).toBe("Ada changed something in the group")
})

Deno.test("activity: a gone actor reads as Deleted user, a missing target as a member", () => {
  expect(say("group.renamed", { actor: { userId: null, name: "" } })).toBe(
    "Deleted user renamed the group",
  )
  expect(say("group.member_removed", { target: null })).toBe(
    "Ada removed a member from the group",
  )
})

Deno.test("activity: an operator's event reads Support team, whoever the actor is", () => {
  expect(say("group.member_removed", { details: { [OPERATOR_DETAIL]: 1 } })).toBe(
    "Support team removed a member from the group",
  )
  expect(
    say("group.invitation_revoked", {
      actor: { userId: null, name: "" },
      details: { [OPERATOR_DETAIL]: 1, role: GroupRole.EDITOR },
    }),
  ).toBe("Support team withdrew an invitation")
})

Deno.test("activity: a tag's changes read as sentences that name the tag", () => {
  expect(say("tag.created", { details: { name: "Work" } })).toBe("Ada added the tag “Work”")
  expect(say("tag.created")).toBe("Ada added a tag")
  expect(say("tag.updated", { details: { name: "Job", from: "Work" } })).toBe(
    "Ada renamed the tag “Work” to “Job”",
  )
  expect(say("tag.updated", { details: { name: "Job", color: "#b91c1c" } })).toBe(
    "Ada changed the colour of the tag “Job”",
  )
  expect(say("tag.updated", { details: { name: "Job" } })).toBe("Ada changed the tag “Job”")
  expect(say("tag.updated")).toBe("Ada changed a tag")
  expect(say("tag.deleted", { details: { name: "Job", notes: 0 } })).toBe(
    "Ada deleted the tag “Job”",
  )
  expect(say("tag.deleted", { details: { name: "Job", notes: 1 } })).toBe(
    "Ada deleted the tag “Job”, which 1 note carried",
  )
  expect(say("tag.deleted", { details: { notes: 3 } })).toBe(
    "Ada deleted a tag, which 3 notes carried",
  )
})

Deno.test("activity: every kind the server writes has its own sentence", () => {
  for (const kind of ACTIVITY_KINDS) {
    expect(say(kind)).not.toBe(say("future.kind"))
  }
})
