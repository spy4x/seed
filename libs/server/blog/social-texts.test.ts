import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { socialTexts, X_LINK_LENGTH, X_MAX } from "./social-texts.ts"

const POST = {
  title: `Neun Sprachen ab Tag eins`,
  slug: `neun-sprachen`,
  language: `de` as const,
  description: `Die Beschreibung.`,
  intro: `Die Einleitung.`,
  tldr: [`Erster Punkt.`, `Zweiter Punkt.`],
}
const ORIGIN = `https://seedsaas.com`
const URL_DE = `https://seedsaas.com/de/blog/neun-sprachen`

/** How long X counts `text`: every link as {@link X_LINK_LENGTH}. */
const xLength = (text: string) =>
  Array.from(text.replace(/https:\/\/\S+/g, ``)).length + X_LINK_LENGTH

describe("socialTexts (#733)", () => {
  it("builds each channel's text from the title, the intro and the points, ending at the post's address in its language", () => {
    const texts = socialTexts(POST, ORIGIN)
    expect(texts.linkedin).toBe(
      `Neun Sprachen ab Tag eins\n\nDie Einleitung.\n\n→ Erster Punkt.\n→ Zweiter Punkt.\n\n${URL_DE}`,
    )
    expect(texts.telegram).toBe(
      `**Neun Sprachen ab Tag eins**\n\nDie Einleitung.\n\n• Erster Punkt.\n• Zweiter Punkt.\n\n${URL_DE}`,
    )
    expect(texts.x).toBe(`Neun Sprachen ab Tag eins\n\nDie Einleitung.\n\n${URL_DE}`)
  })

  it("opens with the description when the post has no intro", () => {
    const texts = socialTexts({ ...POST, intro: null }, ORIGIN)
    expect(texts.linkedin).toContain(`\n\nDie Beschreibung.\n\n`)
    expect(texts.x).toContain(`\n\nDie Beschreibung.\n\n`)
  })

  it("keeps the X text within 280 characters: the intro goes first, then the title is cut", () => {
    const longIntro = socialTexts({ ...POST, intro: `w`.repeat(250) }, ORIGIN).x
    expect(longIntro).toBe(`Neun Sprachen ab Tag eins\n\n${URL_DE}`)

    const longTitle = socialTexts({ ...POST, title: `t`.repeat(300) }, ORIGIN).x
    expect(xLength(longTitle)).toBe(X_MAX)
    expect(longTitle.endsWith(`…\n\n${URL_DE}`)).toBe(true)
  })
})
