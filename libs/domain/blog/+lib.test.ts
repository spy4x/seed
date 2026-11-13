import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  BLOG_AUTHOR_URL_MAX_LENGTH,
  BLOG_INTRO_MAX_LENGTH,
  BLOG_TLDR_MAX,
  BlogError,
  blogSlugProblem,
  isHttpsUrl,
  parseBlogPostEdit,
  parseBlogPostFields,
  parseBlogStatusFilter,
  parsePublishTime,
  readIndexNowKey,
} from "./+lib.ts"

const FIELDS = {
  title: `Hello`,
  slug: `hello-world`,
  description: `A post.`,
  bodyMd: `Hi`,
}

/** The field a parse refuses, or `null` when it accepts. */
function refusedField(input: Parameters<typeof parseBlogPostFields>[0]): string | null {
  try {
    parseBlogPostFields(input)
    return null
  } catch (error) {
    if (error instanceof BlogError) return error.field
    throw error
  }
}

describe(`parseBlogPostFields`, () => {
  it(`trims the texts, drops empty key points and stores an empty optional field as null`, () => {
    expect(parseBlogPostFields({
      ...FIELDS,
      title: `  Hello  `,
      seoTitle: `  `,
      topic: ``,
      tldr: [` One `, `   `, `Two`],
      coverUrl: null,
      coverAlt: `left over`,
      authorUrl: `   `,
      intro: ` `,
    })).toEqual({
      ...FIELDS,
      seoTitle: null,
      topic: null,
      tldr: [`One`, `Two`],
      coverUrl: null,
      coverAlt: null,
      authorUrl: null,
      intro: null,
      relatedFeature: null,
      language: `en`,
      translationOf: null,
    })
  })

  it(`requires a title and a description`, () => {
    expect(refusedField({ ...FIELDS, title: `   ` })).toBe(`title`)
    expect(refusedField({ ...FIELDS, description: `` })).toBe(`description`)
  })

  it(`refuses a slug that is no slug`, () => {
    for (const slug of [`Hello`, `hello world`, `-hello`, `hello--world`, `../admin`, ``]) {
      expect(refusedField({ ...FIELDS, slug })).toBe(`slug`)
    }
  })

  it(`keeps an intro trimmed and refuses one past ${BLOG_INTRO_MAX_LENGTH} characters (#733)`, () => {
    expect(parseBlogPostFields({ ...FIELDS, intro: ` Two sentences. ` }).intro)
      .toBe(`Two sentences.`)
    expect(refusedField({ ...FIELDS, intro: `a`.repeat(BLOG_INTRO_MAX_LENGTH) })).toBeNull()
    expect(refusedField({ ...FIELDS, intro: `a`.repeat(BLOG_INTRO_MAX_LENGTH + 1) })).toBe(`intro`)
  })

  it(`takes a related feature only as a feature page's slug (#733)`, () => {
    expect(parseBlogPostFields({ ...FIELDS, relatedFeature: ` realtime ` }).relatedFeature)
      .toBe(`realtime`)
    for (const relatedFeature of [`/features/realtime`, `Realtime`, `../admin`, `a b`]) {
      expect(refusedField({ ...FIELDS, relatedFeature })).toBe(`relatedFeature`)
    }
  })

  it(`refuses more than ${BLOG_TLDR_MAX} key points`, () => {
    const tldr = Array.from({ length: BLOG_TLDR_MAX + 1 }, (_, i) => `Point ${i}`)
    expect(refusedField({ ...FIELDS, tldr })).toBe(`tldr`)
    expect(refusedField({ ...FIELDS, tldr: tldr.slice(1) })).toBeNull()
  })

  it(`accepts only an https cover, and only with a description`, () => {
    const cover = `https://images.example.com/cover.png`
    expect(refusedField({ ...FIELDS, coverUrl: cover, coverAlt: `A chart` })).toBeNull()
    expect(refusedField({ ...FIELDS, coverUrl: cover })).toBe(`coverAlt`)
    for (const coverUrl of [`http://images.example.com/a.png`, `javascript:alert(1)`, `/a.png`]) {
      expect(refusedField({ ...FIELDS, coverUrl, coverAlt: `A chart` })).toBe(`coverUrl`)
    }
  })

  it(`stores a cover written HTTPS: or without slashes with the https:// the database checks for`, () => {
    for (const coverUrl of [`HTTPS://images.example.com/a.png`, `https:images.example.com/a.png`]) {
      expect(parseBlogPostFields({ ...FIELDS, coverUrl, coverAlt: `A chart` }).coverUrl)
        .toBe(`https://images.example.com/a.png`)
    }
  })

  it(`stores an https author link trimmed, as the parser writes it`, () => {
    for (const authorUrl of [`  https://example.com/about `, `HTTPS://example.com/about`]) {
      expect(parseBlogPostFields({ ...FIELDS, authorUrl }).authorUrl)
        .toBe(`https://example.com/about`)
    }
  })

  it(`refuses an author link that is not https, is junk, carries credentials or is too long`, () => {
    for (
      const authorUrl of [
        `http://example.com/about`,
        `javascript:alert(1)`,
        `example.com/about`,
        `/about`,
        `not a link`,
        `https://user:secret@example.com/`,
        `https://example.com/${`a`.repeat(BLOG_AUTHOR_URL_MAX_LENGTH)}`,
      ]
    ) {
      expect(refusedField({ ...FIELDS, authorUrl })).toBe(`authorUrl`)
    }
  })

  it(`counts a title's length in characters, an emoji as one`, () => {
    expect(refusedField({ ...FIELDS, title: `🙂`.repeat(200) })).toBeNull()
    expect(refusedField({ ...FIELDS, title: `🙂`.repeat(201) })).toBe(`title`)
  })

  it(`refuses a NUL character in the body`, () => {
    expect(refusedField({ ...FIELDS, bodyMd: `a\u0000b` })).toBe(`bodyMd`)
  })
})

describe(`isHttpsUrl`, () => {
  it(`accepts an https address and refuses other schemes and credentials`, () => {
    expect(isHttpsUrl(`https://example.com/a.png`)).toBe(true)
    expect(isHttpsUrl(`https://user:secret@example.com/a.png`)).toBe(false)
    expect(isHttpsUrl(`data:image/png;base64,AAAA`)).toBe(false)
    expect(isHttpsUrl(`not a url`)).toBe(false)
  })
})

describe(`blogSlugProblem`, () => {
  it(`accepts lowercase words joined by single hyphens, up to 100 characters`, () => {
    expect(blogSlugProblem(`hello-world-2026`)).toBeNull()
    expect(blogSlugProblem(`a`.repeat(100))).toBeNull()
    expect(blogSlugProblem(`a`.repeat(101))).not.toBeNull()
  })
})

describe(`parsePublishTime`, () => {
  const now = new Date(`2026-10-23T10:00:00.000Z`)

  it(`answers null for now, and the time for a time ahead`, () => {
    expect(parsePublishTime(undefined, now)).toBeNull()
    expect(parsePublishTime(`2026-10-24T10:00:00.000Z`, now)).toEqual(
      new Date(`2026-10-24T10:00:00.000Z`),
    )
  })

  it(`refuses a time that has passed and one more than five years ahead`, () => {
    expect(() => parsePublishTime(`2026-10-23T10:00:00.000Z`, now)).toThrow(BlogError)
    expect(() => parsePublishTime(`2032-10-23T10:00:00.000Z`, now)).toThrow(BlogError)
  })
})

describe(`parseBlogStatusFilter`, () => {
  it(`reads a status and lists everything for any other value`, () => {
    expect(parseBlogStatusFilter(`published`)).toBe(`published`)
    expect(parseBlogStatusFilter(`all`)).toBeNull()
    expect(parseBlogStatusFilter(null)).toBeNull()
  })
})

describe(`parseBlogPostEdit`, () => {
  it(`leaves out the language and the link a save did not name, so the post keeps its own (#530)`, () => {
    const edit = parseBlogPostEdit(FIELDS)
    expect(`language` in edit).toBe(false)
    expect(`translationOf` in edit).toBe(false)
  })

  it(`keeps the language and the link a save named, an unlink as null`, () => {
    expect(parseBlogPostEdit({ ...FIELDS, language: `de`, translationOf: null }))
      .toMatchObject({ language: `de`, translationOf: null })
  })
})

describe(`readIndexNowKey`, () => {
  const env = (value?: string) => ({
    get: (name: string) => name === `INDEXNOW_KEY` ? value : undefined,
  })

  it(`answers the key, and null when it is unset or empty, so IndexNow stays off`, () => {
    expect(readIndexNowKey(env(`0123abcd-ef45`))).toBe(`0123abcd-ef45`)
    expect(readIndexNowKey(env())).toBeNull()
    expect(readIndexNowKey(env(` `))).toBeNull()
  })

  it(`refuses a key IndexNow would not take, without naming it`, () => {
    for (const bad of [`short`, `has space in it`, `a/b/c/d/e/f`, `k`.repeat(129)]) {
      expect(() => readIndexNowKey(env(bad))).toThrow(`INDEXNOW_KEY must be`)
      try {
        readIndexNowKey(env(bad))
      } catch (error) {
        expect((error as Error).message).not.toContain(bad)
      }
    }
  })
})
