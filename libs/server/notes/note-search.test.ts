import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { prefixQuery } from "./note-search.ts"

describe(`prefixQuery`, () => {
  it(`requires every word, each as the start of a word`, () => {
    expect(prefixQuery(`Weekly  Plan`)).toBe(`weekly:* & plan:*`)
  })

  it(`drops every character that could add a query operator`, () => {
    expect(prefixQuery(`a&b | !c <-> 'd':* (e)`)).toBe(`a:* & b:* & c:* & d:* & e:*`)
  })

  it(`keeps letters and digits of any script`, () => {
    expect(prefixQuery(`Привет 2026`)).toBe(`привет:* & 2026:*`)
  })

  it(`answers null when no word is left`, () => {
    expect(prefixQuery(`!! --`)).toBeNull()
  })

  it(`takes the first eight words only`, () => {
    expect(prefixQuery(`a b c d e f g h i j`)?.split(` & `).length).toBe(8)
  })
})
