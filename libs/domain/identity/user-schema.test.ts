/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { validate } from "@spy4x/validation"
import { userBaseSchema, UserRole, userRoleNamed, userRoleValues } from "@domain/identity"

Deno.test("userBaseSchema: refuses a role's name and keeps a role's number", () => {
  for (const role of ["ADMIN", "VIEWER", "administrator"]) {
    const result = validate(userBaseSchema, { role })
    expect(Object.keys(result.error?.errors ?? {})).toEqual(["role"])
  }
  const result = validate(userBaseSchema, { role: UserRole.ADMIN })
  expect(result.error).toBeNull()
  expect(result.data?.role).toBe(UserRole.ADMIN)
})

Deno.test("userRoleValues holds every role's number and no name", () => {
  expect(userRoleValues).toEqual([
    UserRole.VIEWER,
    UserRole.OPERATOR,
    UserRole.SUPERVISOR,
    UserRole.ADMIN,
  ])
  expect(userRoleNamed("Administrator")).toBe(UserRole.ADMIN)
  expect(userRoleNamed("ADMIN")).toBeNull()
})
