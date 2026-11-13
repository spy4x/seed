import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { renderToString } from "preact-render-to-string"
import { TEST_PRO_PLAN } from "../../libs/domain/billing/test-plans.ts"
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
import HostingCost, {
  fallback as hostingFallback,
  managedMonthly,
  savings,
  seedMonthly,
  toEuro,
} from "./islands/post/HostingCost.tsx"
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

  it(`makes every relative link and image address absolute, and leaves the rest of the HTML alone (#416)`, () => {
    const html = `<p>See <a href="/docs/x" title="T">docs</a>, <a href="#part">this</a>, ` +
      `<a href="other-post">that</a>, <a href="https://example.org/a?b=1&amp;c=2">out</a> and ` +
      `<a href="mailto:hi@example.com">mail</a>.</p>\n<p><img src="/shots/a.png" alt="A"></p>\n` +
      `<p><code>href=&quot;/code&quot;</code></p>\n`
    const { parts } = resolveBody([{ kind: `html`, html }], [], figures)

    expect(feedHtml(parts, `https://www.example.com/blog/a`, t)).toBe(
      `<p>See <a href="https://www.example.com/docs/x" title="T">docs</a>, ` +
        `<a href="https://www.example.com/blog/a#part">this</a>, ` +
        `<a href="https://www.example.com/blog/other-post">that</a>, ` +
        `<a href="https://example.org/a?b=1&amp;c=2">out</a> and ` +
        `<a href="mailto:hi@example.com">mail</a>.</p>\n` +
        `<p><img src="https://www.example.com/shots/a.png" alt="A"></p>\n` +
        `<p><code>href=&quot;/code&quot;</code></p>\n`,
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
  it(`uses Seed's own Pro plan, as the test catalog keeps it: its price per member and its most members`, () => {
    const pro = TEST_PRO_PLAN

    expect(PRO_PRICE).toEqual({ amount: pro.amount, currency: pro.currency })
    expect(PRO_MAX_MEMBERS).toBe(pro.entitlements.limits.maxMembers)
  })
})

describe(`HostingCost`, () => {
  it(`adds the server, its IPv4 address and the backup store to Seed's month`, () => {
    expect(seedMonthly(`cx23`)).toBe(549 + 50 + 649)
    expect(seedMonthly(`cpx32`)).toBe(3549 + 50 + 649)
  })

  it(`charges the managed stack a seat per developer on top of the database`, () => {
    expect(managedMonthly(1)).toBe(4500)
    expect(managedMonthly(3)).toBe(8500)
  })

  it(`turns dollars into euros at the dated ECB rate`, () => {
    expect(toEuro(4500)).toBe(4012)
  })

  it(`draws the post's server and team without JavaScript, and its feed sentence names both totals`, () => {
    const t = siteTranslator(`en`)
    const html = renderToString(
      <HostingCost
        server={`cpx32`}
        developers={3}
        figure={{ id: `hosting-cost`, language: `en`, messages: figureCatalog(`en`) }}
      />,
    )

    expect(html).toMatch(/value="cpx32"[^>]*checked/)
    expect(html).toContain(`€42.48`)
    expect(html).toContain(`$85.00`)
    expect(hostingFallback({ server: `cpx32`, developers: 3 }, t)).toBe(
      `On a Hetzner CPX32, Seed costs €42.48 a month with its IPv4 address and backup storage. ` +
        `Vercel Pro and Supabase Pro cost $85.00 a month, about €75.78. Developers with a Vercel seat: 3. ` +
        `Seed saves €33.30 a month, €399.60 a year.`,
    )
  })

  it(`names the cheaper side and its saving, never a negative amount`, () => {
    expect(savings(`cx23`, 1)).toEqual({ cheaper: `seed`, monthly: 2764 })
    expect(savings(`cpx42`, 1)).toEqual({ cheaper: `managed`, monthly: 3636 })

    const draw = (server: `cx23` | `cpx42`) =>
      renderToString(
        <HostingCost
          server={server}
          developers={1}
          figure={{ id: `hosting-cost`, language: `en`, messages: figureCatalog(`en`) }}
        />,
      )
    const seedWins = draw(`cx23`)
    expect(seedWins).toContain(`Seed saves you`)
    expect(seedWins).toContain(`€27.64 a month`)
    expect(seedWins).toContain(`€331.68 a year`)

    const managedWins = draw(`cpx42`)
    expect(managedWins).toContain(`The managed stack saves you`)
    expect(managedWins).toContain(`€36.36 a month`)
    expect(managedWins).toContain(`€436.32 a year`)
    expect(managedWins).not.toContain(`-€`)
    expect(hostingFallback({ server: `cpx42`, developers: 1 }, siteTranslator(`en`))).toContain(
      `The managed stack saves €36.36 a month, €436.32 a year.`,
    )
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
