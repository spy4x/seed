import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { h } from "preact"
import { renderToString } from "preact-render-to-string"
import {
  applyOverrides,
  CHANGELOG,
  type ChangelogEntry,
  changelogPulse,
  changeMonth,
  groupByMonth,
  parseSubject,
} from "./changelog.ts"
import { REPOSITORY_URL } from "./brand.ts"
import { Changelog } from "./routes/[[lang]]/changelog.tsx"
import { SiteLanguage } from "./use-site.tsx"

const AT = `2026-10-20T10:00:00.000Z`

const entry = (
  kind: ChangelogEntry[`kind`],
  text: string,
  date: string,
  number?: number,
): ChangelogEntry => ({ kind, text, date, ...(number === undefined ? {} : { number }) })

describe(`parseSubject`, () => {
  it(`strips the type and scope, lists feat as new and keeps the pull request's number`, () => {
    expect(parseSubject(`feat(blog): load Seed's own posts from files (#627)`, AT)).toEqual({
      kind: `new`,
      text: `Load Seed's own posts from files.`,
      number: 627,
      date: AT,
    })
  })

  it(`lists fix as fixed, also with a breaking-change mark and no scope`, () => {
    expect(parseSubject(`fix!: keep an expired user's edits (#615)`, AT)).toEqual({
      kind: `fixed`,
      text: `Keep an expired user's edits.`,
      number: 615,
      date: AT,
    })
  })

  it(`keeps an entry without a number, and a sentence that already ends`, () => {
    expect(parseSubject(`feat: passkeys work offline?`, AT)).toEqual({
      kind: `new`,
      text: `Passkeys work offline?`,
      date: AT,
    })
  })

  it(`leaves out every other type and a subject with no type`, () => {
    for (
      const subject of [
        `docs: explain backups (#1)`,
        `test(api): real auth wiring (#616)`,
        `chore(deps): take preact-components 13.3.0`,
        `refactor: split the router`,
        `ci: pin the image`,
        `Merge branch 'main' into feat/x`,
        `feature: not a type we read`,
      ]
    ) {
      expect(parseSubject(subject, AT), subject).toBeNull()
    }
  })
})

describe(`applyOverrides`, () => {
  const entries = [
    entry(`new`, `Raw subject.`, AT, 1),
    entry(`fixed`, `Hidden fix.`, AT, 2),
    entry(`new`, `No number.`, AT),
  ]

  it(`replaces an entry's text, hides one mapped to null and leaves the rest`, () => {
    expect(applyOverrides(entries, { 1: `A plain sentence.`, 2: null })).toEqual([
      entry(`new`, `A plain sentence.`, AT, 1),
      entry(`new`, `No number.`, AT),
    ])
  })
})

describe(`groupByMonth`, () => {
  it(`groups by the UTC month, newest month first, with new and fixed apart`, () => {
    const months = groupByMonth([
      entry(`fixed`, `Late fix.`, `2026-10-31T23:30:00.000Z`, 3),
      entry(`new`, `September thing.`, `2026-09-02T00:00:00.000Z`, 1),
      entry(`new`, `October thing.`, `2026-10-01T00:00:00.000Z`, 2),
      // Already November in UTC, though still 31 October west of Greenwich.
      entry(`new`, `November thing.`, `2026-11-01T00:30:00.000Z`, 4),
    ])

    expect(months.map(({ id, title }) => [id, title])).toEqual([
      [`2026-11`, `November 2026`],
      [`2026-10`, `October 2026`],
      [`2026-09`, `September 2026`],
    ])
    expect(months[1].added.map(({ number }) => number)).toEqual([2])
    expect(months[1].fixed.map(({ number }) => number)).toEqual([3])
  })

  it(`links each number to its pull request on GitHub`, () => {
    const [month] = groupByMonth([entry(`new`, `Thing.`, AT, 612), entry(`new`, `Other.`, AT)])

    expect(changeMonth(month).added).toEqual([
      { text: `Thing.`, number: 612, href: `${REPOSITORY_URL}/pull/612` },
      { text: `Other.`, number: undefined, href: undefined },
    ])
  })
})

describe(`changelogPulse`, () => {
  const now = new Date(`2026-11-01T12:00:00.000Z`)

  it(`names the newest change and counts the last 30 days`, () => {
    expect(changelogPulse([
      entry(`new`, `Old.`, `2026-09-01T00:00:00.000Z`),
      entry(`new`, `Newest.`, `2026-10-30T00:00:00.000Z`),
      entry(`fixed`, `Recent.`, `2026-10-05T00:00:00.000Z`),
    ], now)).toEqual({ last: `2026-10-30T00:00:00.000Z`, recent: 2 })
  })

  it(`says nothing without changes`, () => {
    expect(changelogPulse([], now)).toBeNull()
  })
})

describe(`the changelog page`, () => {
  const render = (entries: readonly ChangelogEntry[], posts = new Map<string, string>()) =>
    renderToString(
      h(SiteLanguage, {
        language: `en`,
        children: h(Changelog, { entries, posts, newsletter: true, now: new Date(AT) }),
      }),
    )

  it(`is empty without the build's history, as under deno test`, () => {
    expect(CHANGELOG.entries).toEqual([])
  })

  it(`shows its empty state and the commits on GitHub when there is no change`, () => {
    const html = render([])

    expect(html).toContain(`data-e2e="changelog-empty"`)
    expect(html).toContain(`No changes listed yet`)
    expect(html).toContain(`href="${REPOSITORY_URL}/commits/main"`)
    expect(html).not.toContain(`data-e2e="changelog-pulse"`)
  })

  it(`lists six months in full, names each pull request, and links a month's post once it exists`, () => {
    const entries = Array.from(
      { length: 8 },
      (_, index) =>
        entry(
          `new`,
          `Change ${index}.`,
          `2026-${String(10 - index).padStart(2, `0`)}-15T00:00:00.000Z`,
          600 + index,
        ),
    )
    const html = render(entries, new Map([[`What's new in Seed, October 2026`, `/blog/october`]]))

    const months = [...html.matchAll(/<h2 id="(\d{4}-\d{2})"/g)].map((match) => match[1])
    expect(months).toEqual([`2026-10`, `2026-09`, `2026-08`, `2026-07`, `2026-06`, `2026-05`])
    expect(html).toContain(`aria-label="Pull request 600 on GitHub"`)
    expect(html).toContain(`href="/blog/october"`)
    expect(html.match(/Read (?:&quot;|")What(?:&#39;|')s new in Seed/g)).toHaveLength(1)
    expect(html).toContain(`Earlier changes on GitHub`)
    expect(html).toContain(`data-e2e="changelog-pulse"`)
  })
})
