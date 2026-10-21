/** `personName`: how the notes screens name a note's author and last editor. */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { personName } from "./note-people.ts"

const members = [
  { userId: 1, name: "Anna Bell" },
  { userId: 7, name: "Maya Chen" },
  { userId: 9, name: "Leo Park" },
  { userId: 5, name: " " },
]

describe("personName", () => {
  it("names the person themselves You, even before the members are read", () => {
    expect(personName(1, 1, members)).toBe("You")
    expect(personName(1, 1, null)).toBe("You")
  })

  it("names another member by the name the group knows", () => {
    expect(personName(7, 1, members)).toBe("Maya Chen")
    expect(personName(9, 1, members)).toBe("Leo Park")
  })

  it("names a member who set no name Unnamed member, as the members list does", () => {
    expect(personName(5, 1, members)).toBe("Unnamed member")
  })

  it("names an account that left the group or is gone Former member", () => {
    expect(personName(42, 1, members)).toBe("Former member")
    expect(personName(null, 1, members)).toBe("Former member")
  })

  it("names nobody while the members are not read yet, rather than a wrong name", () => {
    expect(personName(7, 1, null)).toBeUndefined()
  })
})
