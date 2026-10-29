/**
 * The admin app's languages on a real page (happy-dom): `<html lang dir>` follows the language shown, so
 * an Arabic page reads right to left and mirrors its layout (#215).
 */
import { expect } from "@std/expect"
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { languages } from "./i18n.ts"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

describe("the admin app's page direction", () => {
  it("is right to left in Arabic, and left to right again after a switch to English", async () => {
    const html = window.document.documentElement

    expect(await languages.use(`ar`)).toBe(true)
    expect([html.lang, html.dir]).toEqual([`ar`, `rtl`])

    expect(await languages.use(`en`)).toBe(true)
    expect([html.lang, html.dir]).toEqual([`en`, `ltr`])
  })
})
