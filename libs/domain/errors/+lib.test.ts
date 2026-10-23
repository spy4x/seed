import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { apiErrorBodySchema, readApiError } from "./+lib.ts"

describe(`the API's error body`, () => {
  it(`accepts a code from the closed list with its optional parts`, () => {
    const body = {
      error: {
        code: `bad_request`,
        message: `name must be a string`,
        reason: `validation`,
        fields: { name: { code: `domain` } },
        details: { field: `name` },
        requestId: `req-1`,
      },
    }

    expect(apiErrorBodySchema(body)).toEqual(body)
  })

  it(`refuses a code outside the closed list, a bare string and an undeclared part`, () => {
    for (
      const body of [
        { error: { code: `GROUP_NOT_FOUND`, message: `Group not found` } },
        { error: `Too many requests` },
        { error: { code: `forbidden`, message: `No` }, code: `forbidden` },
        { error: { code: `forbidden`, message: `No`, stack: `at x.ts:1` } },
      ]
    ) {
      expect(apiErrorBodySchema(body)).toBeInstanceOf(type.errors)
    }
  })
})

describe(`readApiError`, () => {
  it(`reads the error of an API body, and ignores a part a newer server added`, () => {
    expect(
      readApiError({ error: { code: `not_found`, message: `Gone`, reason: `x`, hint: 1 } }),
    ).toEqual({ code: `not_found`, message: `Gone`, reason: `x` })
  })

  it(`answers null for a body that is not the API's`, () => {
    for (const body of [null, `<html>`, { error: `Bad gateway` }, { error: { code: `oops` } }]) {
      expect(readApiError(body)).toBe(null)
    }
  })
})
