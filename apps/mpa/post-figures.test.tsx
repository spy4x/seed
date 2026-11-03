import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { renderToString } from "preact-render-to-string"
import { PLANS, PRO_PLAN_ID } from "@domain/billing"
import { renderBlogBody } from "@server/blog/render.ts"
import { readSeedPosts } from "@server/blog/seed-posts.ts"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import {
  feedHtml,
  figureRegistry,
  islandProps,
  postFigures,
  readFigureFolder,
  resolveBody,
} from "./post-figures.tsx"
import { figureCatalog, siteTranslator } from "./languages.ts"
import { PRO_MAX_MEMBERS, PRO_PRICE } from "./islands/post/CostCalculator.tsx"
import OfflineSyncDemo, {
  MAX_NOTES,
  reconnect,
  START,
  writeNote,
} from "./islands/post/OfflineSyncDemo.tsx"

describe(`the figure folder`, () => {
  it(`finds a new file by its name, with no list to edit, and skips files that are no tag`, async () => {
    const modules = await readFigureFolder(new URL(`./testdata/post-figures/`, import.meta.url))
    const figures = figureRegistry(modules)

    expect([...figures.keys()]).toEqual([`Sample`])
  })

  it(`refuses a figure file without its props schema`, () => {
    expect(() => figureRegistry({ "./islands/post/Broken.tsx": { default: () => null } }))
      .toThrow(`Broken.tsx must export the island as default and its arktype props definition`)
  })

  it(`keeps arktype out of every island, which the browser loads with all its exports`, async () => {
    for await (const entry of Deno.readDir(new URL(`./islands/post/`, import.meta.url))) {
      if (!entry.name.endsWith(`.tsx`)) continue
      const source = await Deno.readTextFile(
        new URL(`./islands/post/${entry.name}`, import.meta.url),
      )
      expect(source).not.toMatch(/^import (?!type )[^\n]*from "arktype"/m)
    }
  })

  it(`compiles a file's props definition, so its tags are checked`, () => {
    const figures = figureRegistry({
      "Gauge.tsx": { default: () => null, props: { value: `0 <= number <= 100`, "+": `reject` } },
    })
    const check = figures.get(`Gauge`)!.props

    expect(check({ value: 40 })).toEqual({ value: 40 })
    expect(check({ value: 400 })).toBeInstanceOf(type.errors)
  })

  it(`holds every file of islands/post`, async () => {
    expect([...(await postFigures()).keys()]).toContain(`CostCalculator`)
  })
})

describe(`feedHtml`, () => {
  const t = siteTranslator(`en`)
  const figures = figureRegistry({
    "Plain.tsx": { default: () => null, props: {} },
    "Told.tsx": {
      default: () => null,
      props: { text: `string` },
      fallback: ({ text }: { text: string }) => `Said: ${text} <b>`,
    },
  })

  it(`links a figure without its own text to its place on the post's page`, () => {
    const { parts } = resolveBody(
      [{ kind: `component`, tag: `Plain`, props: {}, line: 1 }],
      [],
      figures,
    )

    expect(feedHtml(parts, `https://www.example.com/blog/a`, t)).toBe(
      `<p>Try it on the website: <a href="https://www.example.com/blog/a#plain">` +
        `https://www.example.com/blog/a#plain</a></p>\n`,
    )
  })

  it(`escapes a figure's own text`, () => {
    const { parts } = resolveBody(
      [{ kind: `component`, tag: `Told`, props: { text: `<i>` }, line: 1 }],
      [],
      figures,
    )

    expect(feedHtml(parts, `https://www.example.com/blog/a`, t)).toBe(
      `<p>Said: &lt;i&gt; &lt;b&gt;</p>\n`,
    )
  })
})

describe(`Seed's own posts`, () => {
  it(`hold at least one figure, every one draws, and each root is figure[data-live]`, async () => {
    const figures = await postFigures()
    let drawn = 0
    for (const { fields } of await readSeedPosts(denoFileSystem)) {
      const body = renderBlogBody(fields.bodyMd)
      const { parts, problems } = resolveBody(body.segments, body.headings, figures)

      expect({ file: fields.slug, problems: [...body.problems, ...problems] })
        .toEqual({ file: fields.slug, problems: [] })
      for (const part of parts) {
        if (part.kind !== `figure`) continue
        const Island = part.figure.default
        const html = renderToString(
          <Island {...islandProps(part, fields.language, figureCatalog(fields.language))} />,
        )
        expect(html).toMatch(new RegExp(`^<figure id="${part.id}"[^>]* data-live="false"`))
        drawn++
      }
    }
    expect(drawn).toBeGreaterThan(0)
  })
})

describe(`CostCalculator`, () => {
  it(`uses the demo's Pro plan: its price per member and its most members`, () => {
    const pro = PLANS.find((plan) => plan.id === PRO_PLAN_ID)!

    expect(PRO_PRICE).toEqual({ amount: pro.amount, currency: pro.currency })
    expect(PRO_MAX_MEMBERS).toBe(pro.entitlements.limits.maxMembers)
  })
})

describe(`OfflineSyncDemo`, () => {
  it(`keeps a note written offline on the device, waiting, until the network is back`, () => {
    const offline = writeNote(START, false)

    expect(offline.map((note) => note.synced)).toEqual([true, false, false])
    expect(reconnect(offline).map((note) => note.synced)).toEqual([true, true, true])
  })

  it(`saves a note written online on the server at once`, () => {
    expect(writeNote(reconnect(START), true).at(-1)).toEqual({ id: 3, synced: true })
  })

  it(`stops adding notes once it holds MAX_NOTES`, () => {
    let notes = START
    for (let i = 0; i < MAX_NOTES + 2; i++) notes = writeNote(notes, false)

    expect(notes.length).toBe(MAX_NOTES)
  })

  it(`starts offline with one note on the server and one waiting, as the post says`, () => {
    const html = renderToString(
      <OfflineSyncDemo
        figure={{ id: `offline-sync-demo`, language: `en`, messages: figureCatalog(`en`) }}
      />,
    )

    expect(html.match(/Waiting to sync</g)?.length).toBe(1)
    expect(html).toContain(`Changes waiting to sync: 1`)
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Offline/)
  })
})
