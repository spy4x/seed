import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { DEFAULT_PREFERENCES } from "@domain/identity"
import { mailReader, requestReader } from "./reader.ts"

/** A saved preferences record with `changes` over the defaults. */
const saved = (changes: Record<string, unknown>) => ({
  version: 1,
  value: { ...DEFAULT_PREFERENCES, ...changes },
})

describe("mailReader", () => {
  it("writes in the saved language, region format, zone and clock", () => {
    expect(mailReader({
      preferences: saved({
        language: "de",
        locale: "de-AT",
        timeZone: "Europe/Vienna",
        hourCycle: "h23",
      }),
      firstLocale: "en-US",
      firstTimeZone: "America/New_York",
      requested: "ar",
    })).toEqual({ language: "de", locale: "de-AT", timeZone: "Europe/Vienna", hourCycle: "h23" })
  })

  it("follows the asking page's language when none is saved, before the first device's", () => {
    expect(
      mailReader({
        preferences: saved({}),
        firstLocale: "en-US",
        firstTimeZone: null,
        requested: "pt-BR",
      }).language,
    ).toBe("pt-BR")
  })

  it("falls back to the language of the first device's region format, then English", () => {
    const first = { preferences: null, firstTimeZone: "Europe/Madrid" }
    expect(mailReader({ ...first, firstLocale: "es-ES" })).toEqual({
      language: "es",
      locale: "es-ES",
      timeZone: "Europe/Madrid",
      hourCycle: null,
    })
    expect(mailReader({ ...first, firstLocale: null })).toEqual({
      language: "en",
      locale: "en",
      timeZone: "Europe/Madrid",
      hourCycle: null,
    })
  })

  it("skips a language, a format or a zone the apps do not offer", () => {
    expect(mailReader({
      preferences: { version: 1, value: { ...DEFAULT_PREFERENCES, language: "xx" } },
      firstLocale: "zz-ZZ",
      firstTimeZone: "Mars/Olympus",
      requested: "<script>",
    })).toEqual({ language: "en", locale: "en", timeZone: null, hourCycle: null })
  })
})

describe("requestReader", () => {
  it("writes a mail sent before any account in the asking page's language, in UTC", () => {
    expect(requestReader("ar")).toEqual({
      language: "ar",
      locale: "ar",
      timeZone: null,
      hourCycle: null,
    })
    expect(requestReader(undefined).language).toBe("en")
  })
})
