import type { ChangeMonth } from "@spy4x/preact-ui/change-list"
import { createFormatters } from "@spy4x/time/format"
import { REPOSITORY_URL } from "./brand.ts"
import { CHANGELOG_OVERRIDES } from "./changelog-overrides.ts"

/** The changelog's address. */
export const CHANGELOG_PATH = `/changelog`

/** The changelog's feed. */
export const CHANGELOG_FEED_PATH = `/changelog.xml`

/** Where the changes older than the page's months are read. */
export const CHANGELOG_HISTORY_URL = `${REPOSITORY_URL}/commits/main`

/** How many months the page lists in full; older ones are linked to GitHub. */
export const CHANGELOG_MONTHS = 6

/** What kind of change an entry is: a commit typed `feat` is new, `fix` is fixed. */
export type ChangeKind = `new` | `fixed`

/** One change, as `deno task changelog` writes it from a commit on `main`. */
export interface ChangelogEntry {
  kind: ChangeKind
  /** The commit subject without its type, as one sentence. */
  text: string
  /** The pull request it was merged in, from the subject's `(#612)`. */
  number?: number
  /** When it was merged: the commit's date, ISO 8601. */
  date: string
}

/** What `deno task changelog` writes. */
export interface ChangelogData {
  /** The commit the history was read from. */
  commit: string
  /** Every `feat` and `fix` on the first-parent history, newest first. */
  entries: ChangelogEntry[]
  /** Each published doc's last change, ISO 8601, by its path from the repository root. */
  docs: Record<string, string>
}

/** The `type(scope)!: subject (#123)` of a squash-merge commit. */
const SUBJECT = /^(\w+)(?:\([^)]*\))?!?:\s*(.+?)(?:\s+\(#(\d+)\))?\s*$/

/**
 * The entry a commit subject makes, or `null` for a type the changelog leaves out (`docs`,
 * `test`, `chore`, `refactor`, `ci`…) and a subject with no type, such as a merge commit. The
 * prefix is stripped, the first letter capitalised and a full stop added, so it reads as a
 * sentence. The pull request's number is kept.
 */
export function parseSubject(subject: string, date: string): ChangelogEntry | null {
  const match = SUBJECT.exec(subject.trim())
  if (!match) return null
  const kind = match[1] === `feat` ? `new` : match[1] === `fix` ? `fixed` : null
  if (kind === null) return null
  const entry: ChangelogEntry = { kind, text: sentence(match[2]), date }
  if (match[3] !== undefined) entry.number = Number(match[3])
  return entry
}

/** `text` with a capital first letter and a full stop at the end, unless it ends a sentence. */
function sentence(text: string): string {
  const trimmed = text.trim()
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

/**
 * `entries` with the committed overrides applied: a pull request mapped to a sentence reads that
 * sentence, one mapped to `null` is left out. An entry without a number is never overridden.
 */
export function applyOverrides(
  entries: readonly ChangelogEntry[],
  overrides: Readonly<Record<number, string | null>> = CHANGELOG_OVERRIDES,
): ChangelogEntry[] {
  return entries.flatMap((entry) => {
    if (entry.number === undefined || !(entry.number in overrides)) return [entry]
    const text = overrides[entry.number]
    return text === null ? [] : [{ ...entry, text }]
  })
}

/** One month of the changelog, newest first, before it is drawn. */
export interface ChangelogMonth {
  /** `2026-10`: the heading's anchor. */
  id: string
  /** `October 2026`. */
  title: string
  added: ChangelogEntry[]
  fixed: ChangelogEntry[]
}

/** The changelog is English only, so its dates are British English in UTC: `1 Nov 2026`. */
export const CHANGELOG_FORMAT = createFormatters({ locale: `en-GB`, timeZone: `UTC` })

/** `October 2026`: the long date without its day. */
function monthTitle(date: Date): string {
  return CHANGELOG_FORMAT.date(date, `long`).replace(/^\d+\s+/, ``)
}

/** `entries` grouped by the month they were merged in (UTC), newest month first. */
export function groupByMonth(entries: readonly ChangelogEntry[]): ChangelogMonth[] {
  const months = new Map<string, ChangelogMonth>()
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))
  for (const entry of sorted) {
    const date = new Date(entry.date)
    const id = date.toISOString().slice(0, 7)
    let month = months.get(id)
    if (!month) {
      month = { id, title: monthTitle(date), added: [], fixed: [] }
      months.set(id, month)
    }
    ;(entry.kind === `new` ? month.added : month.fixed).push(entry)
  }
  return [...months.values()]
}

/** A month as `ChangeList` draws it, each number linked to its pull request on GitHub. */
export function changeMonth(month: ChangelogMonth): Omit<ChangeMonth, "note"> {
  const change = (entry: ChangelogEntry) => ({
    text: entry.text,
    number: entry.number,
    href: entry.number === undefined ? undefined : `${REPOSITORY_URL}/pull/${entry.number}`,
  })
  return {
    id: month.id,
    title: month.title,
    added: month.added.map(change),
    fixed: month.fixed.map(change),
  }
}

/** The page's muted status line: the newest change, and how many came in the 30 days to `now`. */
export function changelogPulse(
  entries: readonly ChangelogEntry[],
  now: Date,
): { last: string; recent: number } | null {
  if (entries.length === 0) return null
  const last = entries.map(({ date }) => date).sort().at(-1)!
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000
  const recent = entries.filter(({ date }) => new Date(date).getTime() >= since).length
  return { last, recent }
}

/** Replaced with the file's contents by Vite's `define` (`vite.config.ts`), or `null` without it. */
declare const __SEED_CHANGELOG__: ChangelogData | null | undefined

/**
 * The changelog the site was built with, overrides applied. Empty without `deno task changelog`
 * before the build, and under `deno test`, so the page shows its empty state.
 */
export const CHANGELOG: ChangelogData = (() => {
  const data = typeof __SEED_CHANGELOG__ === `object` && __SEED_CHANGELOG__ !== null
    ? __SEED_CHANGELOG__
    : { commit: ``, entries: [], docs: {} }
  return { ...data, entries: applyOverrides(data.entries) }
})()
