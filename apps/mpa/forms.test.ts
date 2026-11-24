import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { HONEYPOT_FIELD_NAME } from "@spy4x/platform/universal/honeypot"
import { API_BODIES } from "./forms.ts"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

describe("API_BODIES", () => {
  it("sends the subscription forms' fields as the API names them", () => {
    expect(API_BODIES.subscribe(form({ email: "ada@example.com", list: "news" })))
      .toEqual({ email: "ada@example.com", list: "news" })
    expect(API_BODIES.subscriptionToken(form({ list: "news", token: "t" })))
      .toEqual({ list: "news", token: "t" })
  })

  it("forwards the subscribe form's honeypot field as posted, and leaves it out when it is missing", () => {
    const fields = { email: "ada@example.com", list: "news" }
    expect(API_BODIES.subscribe(form({ ...fields, [HONEYPOT_FIELD_NAME]: "" })))
      .toEqual({ ...fields, [HONEYPOT_FIELD_NAME]: "" })
    expect(API_BODIES.subscribe(form({ ...fields, [HONEYPOT_FIELD_NAME]: "Ada" })))
      .toEqual({ ...fields, [HONEYPOT_FIELD_NAME]: "Ada" })
    // Left out, not sent empty: the API refuses a post that skipped the field.
    expect(API_BODIES.subscribe(form(fields))).toEqual(fields)
  })
})
