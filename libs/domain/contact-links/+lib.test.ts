import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { CONTACT_LABEL_MAX_LENGTH, ContactLinkError, parseContactLinkFields } from "./+lib.ts"

/** The field a refusal of `input` names, or `null` when the input is accepted. */
function refusedField(input: Parameters<typeof parseContactLinkFields>[0]): string | null {
  try {
    parseContactLinkFields(input)
    return null
  } catch (error) {
    if (!(error instanceof ContactLinkError)) throw error
    return error.field
  }
}

describe(`parseContactLinkFields`, () => {
  it(`normalises the value and drops an empty label`, () => {
    expect(parseContactLinkFields({ kind: `telegram`, value: ` @my_shop `, label: ` ` })).toEqual({
      kind: `telegram`,
      value: `my_shop`,
      label: null,
    })
    expect(parseContactLinkFields({ kind: `zalo`, value: `+84 912 345 678`, label: ` Zalo ` }))
      .toEqual({ kind: `zalo`, value: `84912345678`, label: `Zalo` })
  })

  it(`refuses a value that is no value of its kind, naming the value`, () => {
    expect(refusedField({ kind: `telegram`, value: `my shop` })).toBe(`value`)
    expect(refusedField({ kind: `phone`, value: `+84 9abc` })).toBe(`value`)
    expect(refusedField({ kind: `email`, value: `  ` })).toBe(`value`)
  })

  it(`refuses a label past its length or with a NUL, naming the label`, () => {
    const long = `a`.repeat(CONTACT_LABEL_MAX_LENGTH + 1)
    expect(refusedField({ kind: `email`, value: `a@example.com`, label: long })).toBe(`label`)
    expect(refusedField({ kind: `email`, value: `a@example.com`, label: `a\u0000b` })).toBe(`label`)
    expect(refusedField({ kind: `email`, value: `a@example.com`, label: `😀`.repeat(60) })).toBe(
      null,
    )
  })
})
