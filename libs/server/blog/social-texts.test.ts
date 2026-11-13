import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { channelText, socialTexts, X_LINK_LENGTH, X_MAX } from "./social-texts.ts"

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

describe(`channelText`, () => {
  it(`ends each pasted text at the post's address tagged with the channel's utm_source`, () => {
    const tagged = `${URL_DE}?utm_source=t-me-seed`
    expect(channelText(`telegram`, POST, ORIGIN, `t-me-seed`)).toBe(
      `**Neun Sprachen ab Tag eins**\n\nDie Einleitung.\n\n• Erster Punkt.\n• Zweiter Punkt.\n\n${tagged}`,
    )
    expect(channelText(`mastodon`, POST, ORIGIN, `t-me-seed`)).toMatch(/\?utm_source=t-me-seed$/)
    expect(channelText(`newsletter`, POST, ORIGIN, null)).toMatch(/neun-sprachen$/)
  })

  it(`gives no text to a channel that copies the post or takes only a title and a link`, () => {
    for (const kind of [`devto`, `hashnode`, `reddit`, `hackernews`] as const) {
      expect(channelText(kind, POST, ORIGIN, `x`)).toBe(null)
    }
  })
})
