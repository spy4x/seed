import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { BLOG_TLDR_MAX } from "@domain/blog"
import { parseSeedPost, readSeedPosts, SeedPostError } from "./seed-posts.ts"

/** A valid post file named `<slug>.md`, with `extra` front matter lines and no `omit` keys. */
function file(slug = `hello`, extra: string[] = [], omit: string[] = []): [string, string] {
  const lines = [
    `slug: ${slug}`,
    `language: en`,
    `title: Hello`,
    `description: A short description.`,
    `author: Anton Shubin`,
    `publishAt: 2026-11-01T09:00:00Z`,
  ].filter((line) => !omit.includes(line.split(`:`)[0])).concat(extra)
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
    const post = parseSeedPost(...file(`hello`, [`tldr:`, `  - One.`, `  - Two.`]))

    expect(post).toMatchObject({
      fields: { slug: `hello`, language: `en`, title: `Hello`, tldr: [`One.`, `Two.`] },
      author: `Anton Shubin`,
      publishAt: new Date(`2026-11-01T09:00:00Z`),
      newsletter: false,
      translationOf: null,
    })
    expect(post.fields.bodyMd).toBe(`The body.\n`)
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
    expect(() => parseSeedPost(...file(`hello`, [`language: fr`], [`language`]))).toThrow(
      SeedPostError,
    )
  })

  it(`fails on a field past the blog's own limit`, () => {
    const tldr = [`tldr:`, ...Array.from({ length: BLOG_TLDR_MAX + 1 }, (_, i) => `  - ${i}`)]

    expect(() => parseSeedPost(...file(`hello`, tldr))).toThrow(`hello.md: tldr`)
  })

  it(`fails on a slug that is no slug`, () => {
    expect(() => parseSeedPost(`Hello World.md`, file(`Hello World`)[1])).toThrow(`slug`)
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
