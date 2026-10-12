/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { validate } from "@spy4x/validation"
import { userProfileBaseSchema } from "@domain/identity"

Deno.test("userProfileBaseSchema: refuses a NUL or half a surrogate pair in either name", () => {
  for (const name of ["A\u0000da", "A\ud800da"]) {
    const first = validate(userProfileBaseSchema, { firstName: name, lastName: "Lovelace" })
    expect(Object.keys(first.error?.errors ?? {})).toEqual(["firstName"])
    const last = validate(userProfileBaseSchema, { firstName: "Ada", lastName: name })
    expect(Object.keys(last.error?.errors ?? {})).toEqual(["lastName"])
  }
})

Deno.test("userProfileBaseSchema: keeps a line break, a tab and an emoji in a name", () => {
  const name = "Ada\n\tKing 😀"
  const result = validate(userProfileBaseSchema, { firstName: name, lastName: name })
  expect(result.error).toBeNull()
  expect(result.data).toEqual({ firstName: name, lastName: name })
})
