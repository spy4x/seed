import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { UserRole } from "@domain/identity"
import { parseUserRoleArgs, USER_ROLE_USAGE } from "./user-role.ts"

it("reads an address and a role by its name, in any letter case", () => {
  expect(parseUserRoleArgs([" ops@example.com ", "Operator"])).toEqual({
    address: "ops@example.com",
    role: UserRole.OPERATOR,
  })
  expect(parseUserRoleArgs(["a@example.com", "administrator"])?.role).toBe(UserRole.ADMIN)
})

it("refuses a missing address, an unknown role and extra arguments", () => {
  expect(parseUserRoleArgs([])).toBe(null)
  expect(parseUserRoleArgs([" ", "operator"])).toBe(null)
  expect(parseUserRoleArgs(["a@example.com", "admin"])).toBe(null)
  expect(parseUserRoleArgs(["a@example.com", "2"])).toBe(null)
  expect(parseUserRoleArgs(["a@example.com", "operator", "x"])).toBe(null)
})

it("names every role in its usage line", () => {
  expect(USER_ROLE_USAGE).toBe(
    "usage: deno task user:role <address> <viewer|operator|supervisor|administrator>",
  )
})
