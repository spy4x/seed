import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type Git, readChangelog } from "./changelog-write.ts"
import { DOC_SLUGS } from "./docs-site.ts"

const SEP = `\x1f`

/** A `git` that answers from `log` and records every command it was asked to run. */
function fakeGit(options: { shallow: boolean; log: string[] }): Git & { calls: string[][] } {
  const calls: string[][] = []
  const git = (args: string[]) => {
    calls.push(args)
    if (args[0] === `rev-parse` && args[1] === `--is-shallow-repository`) {
      return Promise.resolve(`${options.shallow}\n`)
    }
    if (args[0] === `rev-parse`) return Promise.resolve(`abc123\n`)
    if (args[0] === `log` && args[1] === `-1`) {
      return Promise.resolve(
        args.at(-1) === `docs/deploy.md` ? `2026-10-30T09:00:00+02:00\n` : `\n`,
      )
    }
    if (args[0] === `log`) return Promise.resolve(`${options.log.join(`\n`)}\n`)
    return Promise.resolve(``)
  }
  return Object.assign(git, { calls })
}

describe(`readChangelog`, () => {
  it(`deepens a shallow clone before it reads the history`, async () => {
    const git = fakeGit({ shallow: true, log: [`2026-10-20T10:00:00Z${SEP}feat: one (#1)`] })
    await readChangelog(git, true)

    const fetch = git.calls.findIndex((args) => args[0] === `fetch`)
    expect(git.calls[fetch]).toEqual([`fetch`, `--unshallow`, `--no-tags`, `origin`])
    expect(fetch).toBeLessThan(git.calls.findIndex((args) => args[0] === `log`))
  })

  it(`reads a full clone as it is`, async () => {
    const git = fakeGit({ shallow: false, log: [] })
    await readChangelog(git, false)

    expect(git.calls.some((args) => args[0] === `fetch`)).toBe(false)
  })

  it(`keeps only feat and fix commits, with their dates in UTC, and each doc's last commit`, async () => {
    const data = await readChangelog(
      fakeGit({
        shallow: false,
        log: [
          `2026-10-20T12:00:00+02:00${SEP}feat(blog): load posts (#627)`,
          `2026-10-19T10:00:00Z${SEP}docs: explain backups (#600)`,
          `2026-10-18T10:00:00Z${SEP}fix: keep edits`,
        ],
      }),
      true,
    )

    expect(data).toEqual({
      commit: `abc123`,
      entries: [
        { kind: `new`, text: `Load posts.`, number: 627, date: `2026-10-20T10:00:00.000Z` },
        { kind: `fixed`, text: `Keep edits.`, date: `2026-10-18T10:00:00.000Z` },
      ],
      docs: { "docs/deploy.md": `2026-10-30T07:00:00.000Z` },
    })
    expect(DOC_SLUGS).toContain(`deploy`)
  })

  it(`refuses an empty changelog in CI, so a release never ships one by accident`, async () => {
    const git = fakeGit({ shallow: false, log: [`2026-10-19T10:00:00Z${SEP}docs: only docs`] })

    await expect(readChangelog(git, true)).rejects.toThrow(`holds no feat or fix commit`)
    expect((await readChangelog(git, false)).entries).toEqual([])
  })
})
