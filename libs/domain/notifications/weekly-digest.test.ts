import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { weeklyDigestSettingSchema } from "./weekly-digest.ts"

const accepts = (value: unknown) => !(weeklyDigestSettingSchema(value) instanceof type.errors)

describe(`weeklyDigestSettingSchema`, () => {
  it(`accepts off, and on with a weekday, an hour and a known zone`, () => {
    expect(accepts({ on: false })).toBe(true)
    expect(accepts({ on: true, weekday: 1, hour: 9, timeZone: `Europe/Berlin` })).toBe(true)
    expect(accepts({ on: true, weekday: 7, hour: 0, timeZone: `UTC` })).toBe(true)
  })

  it(`refuses a weekday or hour out of range or fractional`, () => {
    const base = { on: true, weekday: 1, hour: 9, timeZone: `UTC` }
    for (const bad of [{ weekday: 0 }, { weekday: 8 }, { hour: -1 }, { hour: 24 }, { hour: 9.5 }]) {
      expect(accepts({ ...base, ...bad })).toBe(false)
    }
  })

  it(`refuses an unknown or oversize time zone`, () => {
    const base = { on: true, weekday: 1, hour: 9 }
    expect(accepts({ ...base, timeZone: `Mars/Olympus` })).toBe(false)
    expect(accepts({ ...base, timeZone: `Europe/${`x`.repeat(80)}` })).toBe(false)
  })

  it(`refuses on without its time, and unknown fields`, () => {
    expect(accepts({ on: true })).toBe(false)
    expect(accepts({ on: false, weekday: 1 })).toBe(false)
    expect(accepts({ on: true, weekday: 1, hour: 9, timeZone: `UTC`, extra: 1 })).toBe(false)
  })
})
