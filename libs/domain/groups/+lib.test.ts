import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  assertCanChangeRole,
  assertCanDelete,
  assertCanEditDetails,
  assertCanLeave,
  assertCanRemoveMember,
  assertCanRename,
  assertCanTransfer,
  assertOwnerRemains,
  assertTransferNameMatches,
  assignableRoles,
  canDelete,
  canManageMember,
  canMutateNotes,
  canRead,
  canRename,
  canTransfer,
  GROUP_EMOJI_MAX,
  GroupError,
  GroupRole,
  parseCreateGroupRequest,
  parseGroupColor,
  parseGroupDescription,
  parseGroupDetailsBody,
  parseGroupDetailsRequest,
  parseGroupEmoji,
  parseGroupIdRequest,
  parseMemberRequest,
  parseMemberRoleBody,
  parseMemberRoleRequest,
  parseMemberUserIdParam,
  parseRenameGroupBody,
  parseRenameGroupRequest,
  parseTransferBody,
} from "./+lib.ts"

/** The code of the `GroupError` `run` throws, or `undefined` when it throws nothing. */
function codeOf(run: () => void): string | undefined {
  try {
    run()
  } catch (error) {
    return (error as GroupError).code
  }
}

describe("group domain", () => {
  it("keeps fixed v1 enum values", () => {
    expect(GroupRole.VIEWER).toBe(1)
    expect(GroupRole.EDITOR).toBe(2)
    expect(GroupRole.ADMIN).toBe(3)
    expect(GroupRole.OWNER).toBe(4)
  })

  it("applies read and note mutation roles", () => {
    expect(canRead(GroupRole.VIEWER)).toBe(true)
    expect(canMutateNotes(GroupRole.VIEWER)).toBe(false)
    expect(canMutateNotes(GroupRole.EDITOR)).toBe(true)
    expect(canMutateNotes(GroupRole.ADMIN)).toBe(true)
    expect(canMutateNotes(GroupRole.OWNER)).toBe(true)
  })

  it("limits admins to viewer and editor membership", () => {
    expect(canManageMember(GroupRole.ADMIN, GroupRole.VIEWER, GroupRole.EDITOR)).toBe(true)
    expect(canManageMember(GroupRole.ADMIN, GroupRole.EDITOR)).toBe(true)
    expect(canManageMember(GroupRole.ADMIN, GroupRole.ADMIN, GroupRole.VIEWER)).toBe(false)
    expect(canManageMember(GroupRole.ADMIN, GroupRole.EDITOR, GroupRole.ADMIN)).toBe(false)
    expect(canManageMember(GroupRole.EDITOR, GroupRole.VIEWER)).toBe(false)
  })

  it("covers every actor, target, and next-role combination", () => {
    const roles = [GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN, GroupRole.OWNER]
    for (const actor of roles) {
      for (const target of roles) {
        for (const next of [undefined, ...roles]) {
          const expected = actor === GroupRole.OWNER ||
            (actor === GroupRole.ADMIN && target <= GroupRole.EDITOR &&
              (next === undefined || next <= GroupRole.EDITOR))
          expect(canManageMember(actor, target, next)).toBe(expected)
        }
      }
    }
  })

  it("lets owners manage all roles while preserving separate last-owner rule", () => {
    for (const target of Object.values(GroupRole).filter(Number.isInteger) as GroupRole[]) {
      for (const next of Object.values(GroupRole).filter(Number.isInteger) as GroupRole[]) {
        expect(canManageMember(GroupRole.OWNER, target, next)).toBe(true)
      }
    }
    expect(() => assertOwnerRemains(1)).not.toThrow()
    expect(() => assertOwnerRemains(0)).toThrow(GroupError)
  })

  it("lets only an admin or the owner rename a group", () => {
    expect([GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN, GroupRole.OWNER].map(canRename))
      .toEqual([false, false, true, true])
    expect(() => assertCanRename(GroupRole.ADMIN)).not.toThrow()
    expect(() => assertCanRename(GroupRole.OWNER)).not.toThrow()
    for (const role of [GroupRole.VIEWER, GroupRole.EDITOR]) {
      expect(codeOf(() => assertCanRename(role))).toBe("ROLE_INSUFFICIENT")
    }
  })

  it("lets only the owner delete or restore a group", () => {
    expect([GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN, GroupRole.OWNER].map(canDelete))
      .toEqual([false, false, false, true])
    expect(() => assertCanDelete(GroupRole.OWNER)).not.toThrow()
    for (const role of [GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN]) {
      expect(codeOf(() => assertCanDelete(role))).toBe("ROLE_INSUFFICIENT")
    }
  })

  it("tells a non-member the group does not exist, whatever they tried", () => {
    for (const assert of [assertCanRename, assertCanDelete]) {
      expect(codeOf(() => assert(null))).toBe("GROUP_NOT_FOUND")
    }
  })

  it("parses only strict group create intent", () => {
    expect(parseCreateGroupRequest({
      id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
      name: "  Team  ",
    })).toEqual({
      id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
      name: "Team",
      description: "",
      color: null,
      emoji: null,
    })
  })

  it("parses a create that carries the description, colour and emoji in the same request", () => {
    const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"

    expect(parseCreateGroupRequest({
      id,
      name: "Trips",
      description: "  Our trips  ",
      color: "#15803d",
      emoji: "🏕️",
    })).toEqual({ id, name: "Trips", description: "Our trips", color: "#15803d", emoji: "🏕️" })
    expect(parseCreateGroupRequest({ id, name: "Trips", color: null, emoji: "" }))
      .toEqual({ id, name: "Trips", description: "", color: null, emoji: null })
  })

  it("refuses a create whose details are malformed, or that leaves out the id or the name", () => {
    const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    const invalid = [
      { name: "Team" },
      { id },
      { id, name: "Team", description: "x".repeat(501) },
      { id, name: "Team", description: null },
      { id, name: "Team", color: "pink" },
      { id, name: "Team", emoji: "ab" },
      { id, name: "Team", emoji: "🏕️🏕️" },
    ]
    for (const value of invalid) {
      expect(() => parseCreateGroupRequest(value)).toThrow(GroupError)
    }
  })

  it("refuses kind on create, now that groups have none", () => {
    const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"

    expect(() => parseCreateGroupRequest({ id, name: "Team", kind: 2 })).toThrow(GroupError)
  })

  it("rejects malformed, uppercase, empty, long, and extra create data", () => {
    const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    const invalid = [
      { id: "not-a-uuid", name: "Team" },
      { id: id.toUpperCase(), name: "Team" },
      { id, name: "  " },
      { id, name: "x".repeat(101) },
      { id, name: "Te\u0000am" },
      { id, name: "Te\nam" },
      { id, name: "Te\u202eam" },
      { id, name: "Team", userId: 99 },
      { id, name: "Team", kind: 1 },
      { id, name: "Team", kind: 2, userId: 99 },
    ]
    for (const value of invalid) {
      expect(() => parseCreateGroupRequest(value)).toThrow(GroupError)
    }
  })

  it("parses a rename as exactly a trimmed name, with the group id for the socket", () => {
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    expect(parseRenameGroupBody({ name: "  Trip  " })).toEqual({ name: "Trip" })
    expect(parseRenameGroupRequest({ groupId, name: "Trip" })).toEqual({ groupId, name: "Trip" })
    for (const value of [{}, { name: "" }, { name: "x".repeat(101) }, { name: 5 }]) {
      expect(() => parseRenameGroupBody(value)).toThrow(GroupError)
    }
    for (const value of [{ name: "Trip" }, { groupId, name: " " }, { groupId, name: "a", x: 1 }]) {
      expect(() => parseRenameGroupRequest(value)).toThrow(GroupError)
    }
    expect(() => parseRenameGroupBody({ name: "Trip", groupId })).toThrow(GroupError)
  })

  it("parses a request that names one group as exactly its lowercase id", () => {
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    expect(parseGroupIdRequest({ groupId })).toEqual({ groupId })
    for (const value of [{}, { groupId: "nope" }, { groupId: groupId.toUpperCase() }]) {
      expect(() => parseGroupIdRequest(value)).toThrow(GroupError)
    }
    expect(() => parseGroupIdRequest({ groupId, name: "x" })).toThrow(GroupError)
  })
})

const { VIEWER, EDITOR, ADMIN, OWNER } = GroupRole
const ROLES = [VIEWER, EDITOR, ADMIN, OWNER]

describe("group members", () => {
  it("lets the owner give anyone else viewer, editor or admin, and never the owner role", () => {
    expect(assignableRoles(OWNER, VIEWER)).toEqual([EDITOR, ADMIN])
    expect(assignableRoles(OWNER, EDITOR)).toEqual([VIEWER, ADMIN])
    expect(assignableRoles(OWNER, ADMIN)).toEqual([VIEWER, EDITOR])
    expect(assignableRoles(OWNER, OWNER)).toEqual([])
  })

  it("lets an admin move viewers and editors between those two roles only", () => {
    expect(assignableRoles(ADMIN, VIEWER)).toEqual([EDITOR])
    expect(assignableRoles(ADMIN, EDITOR)).toEqual([VIEWER])
    expect(assignableRoles(ADMIN, ADMIN)).toEqual([])
    expect(assignableRoles(ADMIN, OWNER)).toEqual([])
  })

  it("gives a viewer or an editor no role to hand out", () => {
    for (const actor of [VIEWER, EDITOR]) {
      for (const target of ROLES) expect(assignableRoles(actor, target)).toEqual([])
    }
  })

  it("refuses a viewer every role change and every removal", () => {
    for (const target of [VIEWER, EDITOR, ADMIN]) {
      for (const next of [VIEWER, EDITOR, ADMIN]) {
        expect(codeOf(() => assertCanChangeRole(VIEWER, target, next))).toBe("ROLE_INSUFFICIENT")
      }
      expect(codeOf(() => assertCanRemoveMember(VIEWER, target))).toBe("ROLE_INSUFFICIENT")
    }
  })

  it("checks a role change as assignableRoles offers it", () => {
    for (const actor of ROLES) {
      for (const target of [VIEWER, EDITOR, ADMIN]) {
        for (const next of [VIEWER, EDITOR, ADMIN]) {
          if (next === target) continue
          const allowed = codeOf(() => assertCanChangeRole(actor, target, next)) === undefined
          expect(allowed).toBe(assignableRoles(actor, target).includes(next))
        }
      }
    }
  })

  it("never changes the owner's role or hands out the owner role", () => {
    expect(codeOf(() => assertCanChangeRole(OWNER, OWNER, ADMIN))).toBe("LAST_OWNER")
    expect(codeOf(() => assertCanChangeRole(OWNER, ADMIN, OWNER))).toBe("LAST_OWNER")
  })

  it("lets the owner remove anyone else and an admin remove viewers and editors", () => {
    for (const target of [VIEWER, EDITOR, ADMIN]) {
      expect(codeOf(() => assertCanRemoveMember(OWNER, target))).toBeUndefined()
    }
    expect(codeOf(() => assertCanRemoveMember(ADMIN, VIEWER))).toBeUndefined()
    expect(codeOf(() => assertCanRemoveMember(ADMIN, EDITOR))).toBeUndefined()
    expect(codeOf(() => assertCanRemoveMember(ADMIN, ADMIN))).toBe("ROLE_INSUFFICIENT")
    expect(codeOf(() => assertCanRemoveMember(EDITOR, VIEWER))).toBe("ROLE_INSUFFICIENT")
    expect(codeOf(() => assertCanRemoveMember(OWNER, OWNER))).toBe("LAST_OWNER")
  })

  it("tells a non-member the group does not exist, and names a missing member", () => {
    expect(codeOf(() => assertCanChangeRole(null, VIEWER, EDITOR))).toBe("GROUP_NOT_FOUND")
    expect(codeOf(() => assertCanRemoveMember(null, VIEWER))).toBe("GROUP_NOT_FOUND")
    expect(codeOf(() => assertCanLeave(null))).toBe("GROUP_NOT_FOUND")
    expect(codeOf(() => assertCanChangeRole(OWNER, null, EDITOR))).toBe("MEMBER_NOT_FOUND")
    expect(codeOf(() => assertCanRemoveMember(OWNER, null))).toBe("MEMBER_NOT_FOUND")
  })

  it("lets every member but the owner leave", () => {
    for (const role of [VIEWER, EDITOR, ADMIN]) {
      expect(codeOf(() => assertCanLeave(role))).toBeUndefined()
    }
    expect(codeOf(() => assertCanLeave(OWNER))).toBe("LAST_OWNER")
  })

  it("parses a role change and a member request strictly", () => {
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    expect(parseMemberRoleBody({ role: 2 })).toEqual({ role: EDITOR })
    expect(parseMemberRoleRequest({ groupId, userId: 7, role: 3 }))
      .toEqual({ groupId, userId: 7, role: ADMIN })
    expect(parseMemberRequest({ groupId, userId: 7 })).toEqual({ groupId, userId: 7 })
    expect(parseMemberUserIdParam("42")).toBe(42)
    const badBodies = [{ role: 4 }, { role: 0 }, { role: "2" }, {}, { role: 2, userId: 1 }]
    for (const value of badBodies) {
      expect(codeOf(() => parseMemberRoleBody(value))).toBe("INVALID_REQUEST")
    }
    const badRequests = [
      { groupId, userId: "7", role: 2 },
      { groupId, userId: 0, role: 2 },
      { groupId, userId: 1.5, role: 2 },
      { groupId, role: 2 },
      { groupId: "nope", userId: 7, role: 2 },
    ]
    for (const value of badRequests) {
      expect(codeOf(() => parseMemberRoleRequest(value))).toBe("INVALID_REQUEST")
    }
    for (const value of [{ groupId }, { groupId, userId: -1 }, { groupId, userId: 7, x: 1 }]) {
      expect(codeOf(() => parseMemberRequest(value))).toBe("INVALID_REQUEST")
    }
    for (const value of ["0", "007", "1e3", "-1", "2147483648", "abc"]) {
      expect(codeOf(() => parseMemberUserIdParam(value))).toBe("INVALID_REQUEST")
    }
  })
})

describe("transferring ownership", () => {
  it("lets only the owner hand the group to another member", () => {
    for (const target of [VIEWER, EDITOR, ADMIN]) {
      expect(canTransfer(OWNER, target)).toBe(true)
      expect(codeOf(() => assertCanTransfer(OWNER, target))).toBeUndefined()
    }
    for (const actor of [VIEWER, EDITOR, ADMIN]) {
      expect(canTransfer(actor, VIEWER)).toBe(false)
      expect(codeOf(() => assertCanTransfer(actor, VIEWER))).toBe("ROLE_INSUFFICIENT")
    }
  })

  it("tells a non-member the group does not exist and the owner the person is not a member", () => {
    expect(codeOf(() => assertCanTransfer(null, VIEWER))).toBe("GROUP_NOT_FOUND")
    expect(codeOf(() => assertCanTransfer(OWNER, null))).toBe("MEMBER_NOT_FOUND")
  })

  it("refuses the owner naming themselves", () => {
    expect(canTransfer(OWNER, OWNER)).toBe(false)
    expect(codeOf(() => assertCanTransfer(OWNER, OWNER))).toBe("INVALID_REQUEST")
  })

  it("accepts the group's name with spaces around it, and no other spelling", () => {
    expect(codeOf(() => assertTransferNameMatches(" Team ", "Team"))).toBeUndefined()
    for (const typed of ["team", "Teams", "", "T eam"]) {
      expect(codeOf(() => assertTransferNameMatches(typed, "Team"))).toBe("NAME_MISMATCH")
    }
  })

  it("parses exactly a member, a name and a password", () => {
    expect(parseTransferBody({ userId: 7, name: "Team", password: "pw" }))
      .toEqual({ userId: 7, name: "Team", password: "pw" })
    const bad = [
      { userId: 7, name: "Team" },
      { userId: 7, name: "Team", password: "pw", role: 4 },
      { userId: "7", name: "Team", password: "pw" },
      { userId: 7, name: 1, password: "pw" },
      { userId: 7, name: "Team", password: null },
      { userId: 7, name: "x".repeat(201), password: "pw" },
      { userId: 7, name: "Team", password: "x".repeat(1025) },
    ]
    for (const value of bad) {
      expect(codeOf(() => parseTransferBody(value))).toBe("INVALID_REQUEST")
    }
  })
})

describe("a group's description", () => {
  it("is trimmed and may be empty", () => {
    expect(parseGroupDescription("  Our trips \n")).toBe("Our trips")
    expect(parseGroupDescription("   ")).toBe("")
  })

  it("holds 500 characters and refuses the 501st, counting an emoji as one", () => {
    expect(parseGroupDescription("x".repeat(500))).toHaveLength(500)
    expect(Array.from(parseGroupDescription("🏕".repeat(500)))).toHaveLength(500)
    expect(() => parseGroupDescription("x".repeat(501))).toThrow(GroupError)
  })

  it("refuses a NUL or half a surrogate pair", () => {
    const message = "Group description must not contain a NUL or a broken character"
    expect(() => parseGroupDescription("Our\u0000trips")).toThrow(message)
    expect(() => parseGroupDescription("Our\ud800trips")).toThrow(message)
    expect(() => parseGroupDetailsBody({ description: "a\u0000b", color: null, emoji: null }))
      .toThrow(GroupError)
  })

  it("keeps a line break, a tab and an emoji", () => {
    expect(parseGroupDescription("Our trips\n\tsummer 🏕")).toBe("Our trips\n\tsummer 🏕")
  })

  it("refuses what is not text", () => {
    expect(() => parseGroupDescription(null)).toThrow(GroupError)
    expect(() => parseGroupDescription(4)).toThrow(GroupError)
  })
})

describe("a group's colour", () => {
  it("is any #rrggbb, kept in lower case, or null", () => {
    expect(parseGroupColor("#1d4ed8")).toBe("#1d4ed8")
    expect(parseGroupColor("#FACC15")).toBe("#facc15")
    expect(parseGroupColor(null)).toBeNull()
  })

  it("refuses a palette name, a short or long hex, and a missing value", () => {
    for (const value of ["red", "#ff00", "#ff000000", "ff0000", "", undefined, 3]) {
      expect(() => parseGroupColor(value)).toThrow(GroupError)
    }
  })
})

describe("a group's emoji", () => {
  it("accepts one emoji, however many code points it takes", () => {
    for (const emoji of ["🏕️", "🏠", "👨‍👩‍👧", "🇳🇱", "👍🏽", "⭐"]) {
      expect(parseGroupEmoji(emoji)).toBe(emoji)
    }
  })

  it("reads an empty string or null as none", () => {
    expect(parseGroupEmoji("")).toBeNull()
    expect(parseGroupEmoji("  ")).toBeNull()
    expect(parseGroupEmoji(null)).toBeNull()
  })

  it("refuses two emoji, letters, digits and an emoji with text", () => {
    for (const value of ["🏕️🏠", "a", "1", "🏠a", "ab", 5, undefined]) {
      expect(() => parseGroupEmoji(value)).toThrow(GroupError)
    }
  })

  it("refuses one grapheme that is longer than the column holds", () => {
    expect(() => parseGroupEmoji(`🙂${"\u0301".repeat(40)}`)).toThrow(GroupError)
    expect(parseGroupEmoji(`🙂${"\u0301".repeat(GROUP_EMOJI_MAX - 1)}`)).not.toBeNull()
  })
})

describe("a group's details request", () => {
  const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
  const details = { description: " Trips ", color: "#15803d", emoji: "🏕️" }

  it("carries exactly the three fields, cleaned", () => {
    expect(parseGroupDetailsBody(details)).toEqual({
      description: "Trips",
      color: "#15803d",
      emoji: "🏕️",
    })
    expect(parseGroupDetailsRequest({ groupId, ...details })).toEqual({
      groupId,
      description: "Trips",
      color: "#15803d",
      emoji: "🏕️",
    })
  })

  it("refuses a missing field, an extra one and a bad group id", () => {
    expect(() => parseGroupDetailsBody({ description: "", color: null })).toThrow(GroupError)
    expect(() => parseGroupDetailsBody({ ...details, name: "Trip" })).toThrow(GroupError)
    expect(() => parseGroupDetailsRequest({ groupId, ...details, name: "Trip" })).toThrow(
      GroupError,
    )
    expect(() => parseGroupDetailsRequest({ ...details })).toThrow(GroupError)
    expect(() => parseGroupDetailsRequest({ groupId: "nope", ...details })).toThrow(GroupError)
  })

  it("lets an admin and the owner edit and refuses an editor, a viewer and a stranger", () => {
    expect(codeOf(() => assertCanEditDetails(GroupRole.ADMIN))).toBeUndefined()
    expect(codeOf(() => assertCanEditDetails(GroupRole.OWNER))).toBeUndefined()
    expect(codeOf(() => assertCanEditDetails(GroupRole.EDITOR))).toBe("ROLE_INSUFFICIENT")
    expect(codeOf(() => assertCanEditDetails(GroupRole.VIEWER))).toBe("ROLE_INSUFFICIENT")
    expect(codeOf(() => assertCanEditDetails(null))).toBe("GROUP_NOT_FOUND")
  })
})
