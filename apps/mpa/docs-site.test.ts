/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { fromFileUrl } from "@std/path"
import { renderApiDocs } from "./api-docs.ts"
import { REPOSITORY_URL } from "./brand.ts"
import {
  DOC_SLUGS,
  docNeighbours,
  firstSentence,
  isPublishedDoc,
  pointerLine,
  PUBLISHED_GUIDES,
  readDoc,
  rewriteDocLinks,
} from "./docs-site.ts"

const ROOT = fromFileUrl(new URL(`../../`, import.meta.url))
const english = (path: string) => path
const german = (path: string) => `/de${path}`

describe(`rewriteDocLinks`, () => {
  const rewrite = (href: string, localize = english, self?: string) =>
    rewriteDocLinks(`<p><a href="${href}">x</a></p>`, localize, self)

  it(`points a published guide at its page, in the page's language, with its anchor`, () => {
    expect(rewrite(`deploy.md`)).toBe(`<p><a href="/docs/deploy">x</a></p>`)
    expect(rewrite(`./deploy.md#releases`, german)).toBe(
      `<p><a href="/de/docs/deploy#releases">x</a></p>`,
    )
  })

  it(`points the API reference's file at its page`, () => {
    expect(rewrite(`token-api.md#quick-start`)).toBe(`<p><a href="/docs/api#quick-start">x</a></p>`)
  })

  it(`points the API reference's file at GitHub while the notes are off, as the site has no page`, () => {
    const html = rewriteDocLinks(
      `<p><a href="token-api.md#quick-start">x</a></p>`,
      german,
      undefined,
      undefined,
      false,
    )
    expect(html).toContain(`href="${REPOSITORY_URL}/blob/main/docs/token-api.md#quick-start"`)
    expect(html).not.toContain(`/docs/api`)
  })

  it(`points an internal doc and any other file at GitHub, marked as leaving the site`, () => {
    const handoff = rewrite(`handoff.md#traps`)
    expect(handoff).toContain(`href="${REPOSITORY_URL}/blob/main/docs/handoff.md#traps"`)
    expect(handoff).toContain(`rel="noopener noreferrer"`)
    expect(handoff).toContain(`<span class="sr-only"> (on GitHub)</span>`)
    expect(rewrite(`../apps/mpa/`)).toContain(`href="${REPOSITORY_URL}/tree/main/apps/mpa/"`)
    expect(rewrite(`../README.md`)).toContain(`href="${REPOSITORY_URL}/blob/main/README.md"`)
  })

  it(`points an anchor written the GitHub way at the website's id of that heading`, () => {
    // GitHub drops the slashes of "2. Database: `libs/server/db/`"; the website turns them into hyphens.
    expect(rewrite(`#2-database-libsserverdb`, english, `aggregates`))
      .toBe(`<p><a href="#2-database-libs-server-db">x</a></p>`)
    expect(rewrite(`aggregates.md#2-database-libsserverdb`))
      .toBe(`<p><a href="/docs/aggregates#2-database-libs-server-db">x</a></p>`)
  })

  it(`resolves the links of a guide in a subfolder of docs/ against that folder`, () => {
    const guide = (file: string, slug: string, text = `# ${slug}\n`) => ({
      file,
      slug,
      summary: slug,
      text,
    })
    const groups = [{
      title: `Guides`,
      docs: [
        guide(`docs/product/install.md`, `install`),
        guide(`docs/product/backups.md`, `backups`, `# Backups\n\n## Daily runs\n`),
        guide(`docs/deploy.md`, `deploy`),
      ],
    }]
    const html = [
      `backups.md#daily-runs`,
      `./backups.md`,
      `../deploy.md`,
      `../handoff.md`,
      `../token-api.md`,
    ]
      .map((href) => `<a href="${href}">x</a>`).join(``)

    const links = [...rewriteDocLinks(html, german, `install`, groups).matchAll(/href="([^"]*)"/g)]
      .map((match) => match[1])

    expect(links).toEqual([
      `/de/docs/backups#daily-runs`,
      `/de/docs/backups`,
      `/de/docs/deploy`,
      `${REPOSITORY_URL}/blob/main/docs/handoff.md`,
      `/de/docs/api`,
    ])
  })

  it(`leaves an anchor in the page and a link to another site as they are`, () => {
    expect(rewrite(`#limits`)).toBe(`<p><a href="#limits">x</a></p>`)
    expect(rewrite(`https://stripe.com/docs`)).toBe(
      `<p><a href="https://stripe.com/docs">x</a></p>`,
    )
    expect(rewrite(`mailto:hi@example.com`)).toBe(`<p><a href="mailto:hi@example.com">x</a></p>`)
  })
})

describe(`the published guides`, () => {
  it(`publishes the guides of docs/README.md and never an internal doc`, () => {
    expect(DOC_SLUGS).toContain(`deploy`)
    for (
      const slug of [
        `handoff`,
        `financy-extraction-inventory`,
        `postgres-18-upgrade`,
        `woodpecker-ci-setup`,
        `runtime-policy`,
        `README`,
        `token-api`,
        `../README`,
      ]
    ) {
      expect({ slug, published: isPublishedDoc(slug) }).toEqual({ slug, published: false })
      expect(readDoc(slug, english), slug).toBeUndefined()
    }
  })

  it(`reads every published guide: its heading, a description of at most 155 characters and its body`, () => {
    for (const slug of DOC_SLUGS) {
      const doc = readDoc(slug, english)!
      expect(doc.title.length, slug).toBeGreaterThan(0)
      expect(doc.description.length, slug).toBeLessThanOrEqual(155)
      expect(doc.html, slug).not.toContain(`Also on the website`)
      expect(doc.html, slug).not.toMatch(/<h1\b/)
    }
  })

  it(`imports every published guide from the file it names, which starts with its pointer to the website`, async () => {
    for (const { file, slug, text } of PUBLISHED_GUIDES) {
      const source = await Deno.readTextFile(`${ROOT}${file}`)
      expect(text === source, file).toBe(true)
      expect(source.split(`\n`).slice(0, 3), file).toEqual([
        expect.stringMatching(/^# /),
        ``,
        pointerLine(slug),
      ])
    }
  })

  it(`resolves every link of every published guide: a guide and its section, a section here, a file on GitHub`, async () => {
    const api = new Set(renderApiDocs(`https://app.example.com`).headings.map(({ id }) => id))
    const broken: string[] = []
    for (const slug of DOC_SLUGS) {
      const doc = readDoc(slug, english)!
      const own = new Set(doc.headings.map(({ id }) => id))
      for (const [, href] of doc.html.matchAll(/<a href="([^"]*)"/g)) {
        const [path, hash] = href.replaceAll(`&amp;`, `&`).split(`#`) as [string, string?]
        const file = /^.*?\/(?:blob|tree)\/main\/(.*)$/.exec(path)?.[1]
        if (/^(?:https?:|mailto:)/.test(path) && file === undefined) continue
        let ok: boolean
        if (path === ``) ok = hash !== undefined && own.has(hash)
        else if (path === `/docs/api`) ok = hash === undefined || api.has(hash)
        else if (path.startsWith(`/docs/`)) {
          const target = readDoc(path.slice(`/docs/`.length), english)
          ok = target !== undefined &&
            (hash === undefined || target.headings.some(({ id }) => id === hash))
        } else if (file !== undefined) {
          ok = await Deno.stat(`${ROOT}${decodeURIComponent(file)}`).then(() => true, () => false)
        } else ok = false
        if (!ok) broken.push(`${slug}: ${href}`)
      }
    }
    expect(broken).toEqual([])
  })

  it(`walks every guide in reading order, forwards and back, across the groups`, () => {
    const walk = (from: string, step: `next` | `previous`) => {
      const walked = [from]
      for (let slug = docNeighbours(from)[step]; slug; slug = docNeighbours(slug)[step]) {
        walked.push(slug)
      }
      return walked
    }

    expect(walk(DOC_SLUGS[0], `next`)).toEqual([...DOC_SLUGS])
    expect(walk(DOC_SLUGS.at(-1)!, `previous`)).toEqual([...DOC_SLUGS].reverse())
  })
})

describe(`firstSentence`, () => {
  it(`takes the first paragraph's first sentence as plain text, past headings and quotes`, () => {
    expect(
      firstSentence(`## Intro\n\n> A note.\n\nSeed has [three apps](apps.md) and \`deno\`. More.`),
    )
      .toBe(`Seed has three apps and deno.`)
  })

  it(`cuts a long sentence at a word, within 155 characters`, () => {
    const cut = firstSentence(`${`word `.repeat(60)}end.`)!
    expect(cut.length).toBeLessThanOrEqual(155)
    expect(cut).toMatch(/word…$/)
  })
})
