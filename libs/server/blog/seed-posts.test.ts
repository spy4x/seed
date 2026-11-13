import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { BLOG_INTRO_MAX_LENGTH } from "@domain/blog"
import {
  parseSeedPost,
  readSeedPosts,
  SEED_COVERS_DIR,
  SEED_TLDR_MAX,
  SEED_TLDR_MIN,
  SeedPostError,
} from "./seed-posts.ts"

/**
 * A valid post file named `<slug>.md`, with `extra` front matter lines and no `omit` keys. A
 * translation (an `extra` line `translationOf:`) gets no cover, as it shares its original's.
 */
function file(slug = `hello`, extra: string[] = [], omit: string[] = []): [string, string] {
  const translation = extra.some((line) => line.startsWith(`translationOf:`))
  const lines = [
    `slug: ${slug}`,
    `language: en`,
    `title: Hello`,
    `description: A short description.`,
    `tldr:`,
    `  - One.`,
    `  - Two.`,
    `intro: The sentences that open the newsletter.`,
    ...(translation ? [] : [`cover: covers/${slug}.webp`]),
    `coverAlt: A seedling in a pot.`,
    `author: Anton Shubin`,
    `publishAt: 2026-11-01T09:00:00Z`,
  ].filter((line) => !omit.includes(line.split(`:`)[0].trim()))
    .filter((line) => !(omit.includes(`tldr`) && line.startsWith(`  - `)))
    .concat(extra)
  return [`${slug}.md`, `---\n${lines.join(`\n`)}\n---\n\nThe body.\n`]
}

/** A folder holding `files`, as the loader reads one. */
function folder(files: [string, string][]) {
  const byName = new Map(files)
  return {
    readDir: () =>
      Promise.resolve(
        [...byName.keys()].map((name) => ({ name, isFile: true, isDirectory: false })),
      ),
    readText: (path: string) => Promise.resolve(byName.get(path.split(`/`).pop()!) ?? null),
  }
}

describe(`Seed's post files`, () => {
  it(`every post file in seed-posts/ is valid`, async () => {
    // Throws, naming the file, on the first one that is not; a product that deleted them has none.
    await expect(readSeedPosts(denoFileSystem)).resolves.toBeInstanceOf(Array)
  })

  it(`reads the front matter into the blog's fields, with newsletter off by default`, () => {
    const post = parseSeedPost(...file())

    expect(post).toMatchObject({
      fields: {
        slug: `hello`,
        language: `en`,
        title: `Hello`,
        tldr: [`One.`, `Two.`],
        intro: `The sentences that open the newsletter.`,
        coverAlt: `A seedling in a pot.`,
        coverUrl: null,
        relatedFeature: null,
      },
      coverFile: `hello.webp`,
      author: `Anton Shubin`,
      publishAt: new Date(`2026-11-01T09:00:00Z`),
      newsletter: false,
      translationOf: null,
    })
    expect(post.fields.bodyMd).toBe(`The body.\n`)
  })

  it(`reads an author link, and none when the file has no authorUrl`, () => {
    const linked = parseSeedPost(...file(`hello`, [`authorUrl: https://example.com/about`]))
    expect(linked.fields.authorUrl).toBe(`https://example.com/about`)
    expect(parseSeedPost(...file()).fields.authorUrl).toBeNull()
  })

  it(`fails on an author link that is not https, naming the file`, () => {
    expect(() => parseSeedPost(...file(`hello`, [`authorUrl: http://example.com/about`])))
      .toThrow(`hello.md: authorUrl: Enter a full https:// link`)
  })

  it(`links every post by Anton Shubin to his About page`, async () => {
    const posts = (await readSeedPosts(denoFileSystem))
      .filter((post) => post.author === `Anton Shubin`)
    expect(posts.length).toBeGreaterThan(0)
    expect(posts.filter((post) => post.fields.authorUrl !== `https://antonshubin.com/about`))
      .toEqual([])
  })

  it(`reads a quoted date as well as an unquoted one`, () => {
    const post = parseSeedPost(
      ...file(`hello`, [`publishAt: "2026-12-01T09:00:00Z"`], [`publishAt`]),
    )

    expect(post.publishAt).toEqual(new Date(`2026-12-01T09:00:00Z`))
  })

  it(`fails on a file without front matter`, () => {
    expect(() => parseSeedPost(`hello.md`, `# Hello\n`)).toThrow(SeedPostError)
  })

  it(`fails on a missing required field, naming the file`, () => {
    expect(() => parseSeedPost(...file(`hello`, [], [`author`]))).toThrow(`hello.md: author`)
  })

  it(`fails on an unknown field, such as a misspelt one`, () => {
    expect(() => parseSeedPost(...file(`hello`, [`newsleter: true`]))).toThrow(`newsleter`)
  })

  it(`fails on a language the apps do not ship`, () => {
    expect(() => parseSeedPost(...file(`hello`, [`language: it`], [`language`]))).toThrow(
      SeedPostError,
    )
  })

  it(`fails on a field past the blog's own limit`, () => {
    const intro = [`intro: ${`a`.repeat(BLOG_INTRO_MAX_LENGTH + 1)}`]

    expect(() => parseSeedPost(...file(`hello`, intro, [`intro`]))).toThrow(
      `hello.md: intro: Keep the intro to`,
    )
  })

  it(`requires ${SEED_TLDR_MIN} to ${SEED_TLDR_MAX} "In short" points (#733)`, () => {
    const points = (n: number) => [
      `tldr:`,
      ...Array.from({ length: n }, (_, i) => `  - Point ${i}.`),
    ]
    for (const n of [SEED_TLDR_MIN - 1, SEED_TLDR_MAX + 1]) {
      expect(() => parseSeedPost(...file(`hello`, points(n), [`tldr`]))).toThrow(
        `hello.md: tldr: ${SEED_TLDR_MIN} to ${SEED_TLDR_MAX} points`,
      )
    }
    for (const n of [SEED_TLDR_MIN, SEED_TLDR_MAX]) {
      expect(parseSeedPost(...file(`hello`, points(n), [`tldr`])).fields.tldr).toHaveLength(n)
    }
  })

  it(`requires an intro and a cover description (#733)`, () => {
    expect(() => parseSeedPost(...file(`hello`, [], [`intro`]))).toThrow(`hello.md: intro`)
    expect(() => parseSeedPost(...file(`hello`, [`intro: " "`], [`intro`]))).toThrow(
      `hello.md: intro: two or three sentences`,
    )
    expect(() => parseSeedPost(...file(`hello`, [], [`coverAlt`]))).toThrow(`hello.md: coverAlt`)
    expect(() => parseSeedPost(...file(`hello`, [`coverAlt: " "`], [`coverAlt`]))).toThrow(
      `hello.md: coverAlt: what the cover shows`,
    )
  })

  it(`requires a WebP cover in covers/ of an original, and refuses one on a translation (#733)`, () => {
    expect(() => parseSeedPost(...file(`hello`, [], [`cover`]))).toThrow(
      `hello.md: cover: every post has one`,
    )
    for (
      const cover of [`covers/hello.png`, `hello.webp`, `covers/../hello.webp`, `/covers/a.webp`]
    ) {
      expect(() => parseSeedPost(...file(`hello`, [`cover: ${cover}`], [`cover`]))).toThrow(
        `hello.md: cover: a WebP file in covers/`,
      )
    }
    const translated = file(`hallo`, [
      `language: de`,
      `translationOf: hello`,
      `cover: covers/x.webp`,
    ], [
      `language`,
    ])
    expect(() => parseSeedPost(...translated)).toThrow(`hallo.md: cover: a translation shares`)
  })

  it(`gives a translation its original's cover, and a Dev.to cross-post only to an original (#733)`, async () => {
    const files = [
      file(`hello`, [`devto: true`]),
      file(`hallo`, [`language: de`, `translationOf: hello`, `devto: true`], [`language`]),
    ]
    const posts = await readSeedPosts(folder(files), `/posts`)
    expect(posts.map(({ file, coverFile, devto }) => ({ file, coverFile, devto }))).toEqual([
      { file: `hallo.md`, coverFile: `hello.webp`, devto: false },
      { file: `hello.md`, coverFile: `hello.webp`, devto: true },
    ])
    expect(parseSeedPost(...file()).devto).toBe(false)
  })

  it(`has all three widths of every post's cover in covers/ (#733)`, async () => {
    const posts = await readSeedPosts(denoFileSystem)
    const files = new Set((await denoFileSystem.readDir(SEED_COVERS_DIR)).map(({ name }) => name))
    const missing = posts.filter((post) => post.translationOf === null)
      .flatMap(({ coverFile }) =>
        [``, `-960`, `-640`].map((width) => coverFile!.replace(/\.webp$/, `${width}.webp`))
      )
      .filter((name) => !files.has(name))
    expect(posts.length).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it(`fails on a slug that is no slug`, () => {
    expect(() =>
      parseSeedPost(`Hello World.md`, file(`Hello World`, [`cover: covers/x.webp`], [`cover`])[1])
    ).toThrow(
      `Hello World.md: slug: Use lowercase`,
    )
  })

  it(`fails on a file named other than its slug`, () => {
    expect(() => parseSeedPost(`other.md`, file(`hello`)[1])).toThrow(`hello.md`)
  })

  it(`fails on a post with no body`, () => {
    const [name, text] = file()

    expect(() => parseSeedPost(name, text.replace(`The body.\n`, ``))).toThrow(`no body`)
  })

  it(`fails on a translation of a post no file holds`, async () => {
    const files = [file(`hallo`, [`language: de`, `translationOf: hello`], [`language`])]

    await expect(readSeedPosts(folder(files), `/posts`)).rejects.toThrow(`no post file hello.md`)
  })

  it(`fails on a translation in the original's language`, async () => {
    const files = [file(`hello`), file(`hello-again`, [`translationOf: hello`])]

    await expect(readSeedPosts(folder(files), `/posts`)).rejects.toThrow(`same language`)
  })

  it(`fails on a translation of a translation`, async () => {
    const files = [
      file(`hello`),
      file(`hallo`, [`language: de`, `translationOf: hello`], [`language`]),
      file(`hola`, [`language: es`, `translationOf: hallo`], [`language`]),
    ]

    await expect(readSeedPosts(folder(files), `/posts`)).rejects.toThrow(`is a translation itself`)
  })

  it(`fails on two translations of one post into the same language`, async () => {
    const files = [
      file(`hello`),
      file(`hallo`, [`language: de`, `translationOf: hello`], [`language`]),
      file(`guten-tag`, [`language: de`, `translationOf: hello`], [`language`]),
    ]

    await expect(readSeedPosts(folder(files), `/posts`)).rejects.toThrow(`another de translation`)
  })

  it(`skips the folder's README and files that are not Markdown`, async () => {
    const files: [string, string][] = [file(`hello`), [`README.md`, `# Posts\n`], [`x.txt`, `x`]]

    expect((await readSeedPosts(folder(files), `/posts`)).map((post) => post.file)).toEqual([
      `hello.md`,
    ])
  })
})
