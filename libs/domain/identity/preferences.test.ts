/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { DEFAULT_PREFERENCES, type Preferences, preferencesDefinition } from "@domain/identity"

const valid: Preferences = {
  theme: `dark`,
  locale: `de-DE`,
  timeZone: `Europe/Berlin`,
  hourCycle: `h23`,
}

Deno.test(`preferences: accepts a listed region format, a known zone and a clock`, () => {
  const result = preferencesDefinition.parse(valid)
  expect(result).toEqual({ ok: true, value: valid })
})

Deno.test(`preferences: accepts automatic (null) for the format, the zone and the clock`, () => {
  const result = preferencesDefinition.parse(DEFAULT_PREFERENCES)
  expect(result).toEqual({ ok: true, value: DEFAULT_PREFERENCES })
})

Deno.test(`preferences: refuses a zone the runtime does not know`, () => {
  const result = preferencesDefinition.parse({ ...valid, timeZone: `Mars/Olympus_Mons` })
  expect(result.ok).toBe(false)
  if (result.ok || result.reason !== `invalid`) throw new Error(`expected an invalid result`)
  expect(Object.keys(result.error.errors)).toEqual([`timeZone`])
})

Deno.test(`preferences: refuses a region format that is not in the picker's list`, () => {
  for (const locale of [`xx-YY`, `de`, `en-US-u-ca-buddhist`, ``]) {
    const result = preferencesDefinition.parse({ ...valid, locale })
    expect(result.ok).toBe(false)
  }
})

Deno.test(`preferences: refuses an unknown theme or clock`, () => {
  expect(preferencesDefinition.parse({ ...valid, theme: `sepia` }).ok).toBe(false)
  expect(preferencesDefinition.parse({ ...valid, hourCycle: `h24` }).ok).toBe(false)
})

Deno.test(`preferences: a record saved before a key existed reads with that key's default`, () => {
  const stored = { version: 4, value: { theme: `light` } }
  expect(preferencesDefinition.resolve(stored)).toEqual({
    version: 4,
    value: { ...DEFAULT_PREFERENCES, theme: `light` },
  })
})
