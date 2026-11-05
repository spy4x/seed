import { expect } from "@std/expect"
import type { Catalog } from "@spy4x/platform/universal/i18n"
import { SITE_LANGUAGES } from "./languages.ts"
import {
  CHECKLIST,
  CHECKLIST_COUNTS,
  CHECKLIST_ITEMS,
  CHECKLIST_PATH,
  Coverage,
  proofLink,
} from "./launch-checklist.ts"
import { SITE_PAGES } from "./pages.ts"

/** The repository's root, which every proof path is relative to. */
const ROOT = new URL(`../../`, import.meta.url)

/** Each site language's catalog, read straight from `i18n/site/`, with no English fallback. */
async function siteCatalogs(): Promise<[string, Catalog][]> {
  return await Promise.all(SITE_LANGUAGES.map(async (language) => {
    const module = await import(`../../i18n/site/${language}.ts`)
    return [language, module.default as Catalog] as [string, Catalog]
  }))
}

/** Every catalog key the list reads: titles, reasons, what is left, sources. */
function listKeys(): string[] {
  return [
    ...CHECKLIST.map((section) => section.title),
    ...CHECKLIST_ITEMS.flatMap((item) => [
      item.title,
      item.why,
      ...(item.seed?.left ? [item.seed.left] : []),
      ...(item.source ? [item.source.name] : []),
    ]),
  ]
}

/** A Markdown heading's anchor as GitHub and the docs site make it. */
function anchor(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, ``).replace(/ /g, `-`)
}

Deno.test(`every site language has every checklist item's words`, async () => {
  const missing: string[] = []
  for (const [language, catalog] of await siteCatalogs()) {
    for (const key of listKeys()) if (!(key in catalog)) missing.push(`${language}: ${key}`)
  }
  expect(missing).toEqual([])
})

Deno.test(`each item id is unique, stable in form and starts with its section's id`, () => {
  const ids = CHECKLIST_ITEMS.map((item) => item.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(new Set(CHECKLIST.map((section) => section.id)).size).toBe(CHECKLIST.length)
  for (const section of CHECKLIST) {
    for (const item of section.items) {
      expect(item.id).toMatch(new RegExp(`^${section.id}-[a-z0-9]+(?:-[a-z0-9]+)*$`))
    }
  }
})

Deno.test(`every "Built into Seed" mark cites a file, heading or page that exists`, async () => {
  const pages = new Set(SITE_PAGES.map((page) => page.path))
  const problems: string[] = []
  for (const { id, seed } of CHECKLIST_ITEMS) {
    if (!seed) continue
    const [file, fragment] = seed.path.split(`#`)
    if (file.startsWith(`/`)) {
      if (!pages.has(file)) problems.push(`${id}: no site page ${file}`)
      continue
    }
    const text = await Deno.readTextFile(new URL(file, ROOT)).catch(() => undefined)
    if (text === undefined) {
      problems.push(`${id}: no file ${file}`)
      continue
    }
    if (!file.endsWith(`.md`)) {
      if (seed.title !== file) problems.push(`${id}: a code file is named by its path`)
      continue
    }
    const headings = [...text.matchAll(/^(#{1,6}) (.+)$/gm)]
    const title = headings.find(([, level]) => level === `#`)?.[2]
    if (title !== seed.title) problems.push(`${id}: ${file} is titled "${title}"`)
    if (fragment && !headings.some(([, , heading]) => anchor(heading) === fragment)) {
      problems.push(`${id}: ${file} has no heading #${fragment}`)
    }
  }
  expect(problems).toEqual([])
})

Deno.test(`a partly covered item says what is left to the reader`, () => {
  const silent = CHECKLIST_ITEMS.filter((item) =>
    item.seed?.coverage === Coverage.Partial && !item.seed.left
  )
  expect(silent.map((item) => item.id)).toEqual([])
})

Deno.test(`the counts the page states are computed from the list`, () => {
  expect(CHECKLIST_COUNTS).toEqual({
    items: CHECKLIST_ITEMS.length,
    sections: CHECKLIST.length,
    covered: CHECKLIST_ITEMS.filter((item) => item.seed?.coverage === Coverage.Full).length,
  })
  expect(SITE_PAGES.some((page) => page.path === CHECKLIST_PATH)).toBe(true)
})

Deno.test(`a proof link opens a published guide on the site, and anything else on GitHub`, () => {
  const local = (path: string) => `/de${path}`
  expect(proofLink(`docs/backups.md`, local, `seedsaas.com`)).toEqual({
    href: `/de/docs/backups`,
    short: `seedsaas.com/docs/backups`,
  })
  expect(proofLink(`/features/sign-in`, local, `seedsaas.com`).href).toBe(`/de/features/sign-in`)
  expect(proofLink(`apps/mpa/routes/[[lang]]/privacy.tsx`, local, `seedsaas.com`)).toEqual({
    href: `https://github.com/spy4x/seed/blob/main/apps/mpa/routes/%5B%5Blang%5D%5D/privacy.tsx`,
    short: `github.com/spy4x/seed/blob/main/apps/mpa/routes/[[lang]]/privacy.tsx`,
  })
})
