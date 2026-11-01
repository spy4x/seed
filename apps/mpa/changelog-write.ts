/// <reference lib="deno.ns" />
/**
 * `deno task changelog`: reads the history of the checked-out commit and writes
 * `apps/mpa/changelog.json` (gitignored), which the website's build reads (`vite.config.ts`) for
 * `/changelog`, its feed and each doc's "Last updated" date. Run it before every build of the MPA
 * image: the image has no `.git`, so the history is read here, outside it.
 *
 * Every first-parent commit's subject becomes an entry when its type is `feat` or `fix`
 * (`parseSubject`); each published doc gets the date of its last commit.
 *
 * A shallow clone, as CI makes, holds only a few commits. The task fetches the whole history
 * first, and stops with an error when it cannot, or when the history it read has no change at
 * all under `CI`, so a release never ships an empty changelog by accident.
 *
 * @module
 */
import { fromFileUrl } from "@std/path"
import { type ChangelogData, type ChangelogEntry, parseSubject } from "./changelog.ts"
import { DOC_SLUGS } from "./docs-site.ts"

/** Runs `git` with `args` in the repository's root; its output, or an error naming the command. */
export type Git = (args: string[]) => Promise<string>

const ROOT = fromFileUrl(new URL(`../../`, import.meta.url))
const OUTPUT = fromFileUrl(new URL(`./changelog.json`, import.meta.url))

/** `git` run for real. */
async function git(args: string[]): Promise<string> {
  const output = await new Deno.Command(`git`, { args, cwd: ROOT, stderr: `piped` }).output()
  if (!output.success) {
    throw new Error(
      `git ${args.join(` `)} failed: ${new TextDecoder().decode(output.stderr).trim()}`,
    )
  }
  return new TextDecoder().decode(output.stdout)
}

/** One field separator git never writes in a subject. */
const SEP = `\x1f`

/**
 * The changelog of the checked-out commit, read through `git`. A shallow clone is deepened to
 * the whole history first. `ci` makes a history with no `feat` or `fix` an error.
 */
export async function readChangelog(git: Git, ci: boolean): Promise<ChangelogData> {
  if ((await git([`rev-parse`, `--is-shallow-repository`])).trim() === `true`) {
    await git([`fetch`, `--unshallow`, `--no-tags`, `origin`])
  }
  const commit = (await git([`rev-parse`, `HEAD`])).trim()
  const log = await git([`log`, `--first-parent`, `--format=%cI${SEP}%s`, `HEAD`])
  const entries: ChangelogEntry[] = log.split(`\n`).flatMap((line) => {
    const [date, subject] = line.split(SEP)
    if (!date || subject === undefined) return []
    const entry = parseSubject(subject, new Date(date).toISOString())
    return entry ? [entry] : []
  })
  if (ci && entries.length === 0) {
    throw new Error(
      `The history of ${commit} holds no feat or fix commit; refusing to write an empty changelog.`,
    )
  }
  const docs: Record<string, string> = {}
  for (const slug of DOC_SLUGS) {
    const path = `docs/${slug}.md`
    const date = (await git([`log`, `-1`, `--format=%cI`, `HEAD`, `--`, path])).trim()
    if (date) docs[path] = new Date(date).toISOString()
  }
  return { commit, entries, docs }
}

if (import.meta.main) {
  const ci = (Deno.env.get(`CI`) ?? ``) !== ``
  const data = await readChangelog(git, ci)
  await Deno.writeTextFile(OUTPUT, `${JSON.stringify(data)}\n`)
  console.log(
    `Wrote ${data.entries.length} changes from ${
      data.commit.slice(0, 12)
    } to apps/mpa/changelog.json`,
  )
}
