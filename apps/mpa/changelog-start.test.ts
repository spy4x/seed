import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { gitAt, readChangelog } from "./changelog-write.ts"

/** Runs `git` in `cwd` with no inherited environment (a hook's `GIT_DIR`) or config, committing at `date`; its trimmed output. */
async function run(cwd: string, args: string[], date = `2026-10-01T10:00:00Z`): Promise<string> {
  const output = await new Deno.Command(`git`, {
    args: [`-c`, `user.name=Test`, `-c`, `user.email=test@example.com`, ...args],
    cwd,
    clearEnv: true,
    env: {
      GIT_CONFIG_GLOBAL: `/dev/null`,
      GIT_CONFIG_NOSYSTEM: `1`,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
    stderr: `piped`,
  }).output()
  if (!output.success) throw new Error(new TextDecoder().decode(output.stderr))
  return new TextDecoder().decode(output.stdout).trim()
}

/** Commits an empty change with `subject` on the current branch; its hash. */
async function commit(cwd: string, subject: string, day: number): Promise<string> {
  const date = `2026-10-${String(day).padStart(2, `0`)}T10:00:00Z`
  await run(cwd, [`commit`, `--allow-empty`, `-q`, `-m`, subject], date)
  return run(cwd, [`rev-parse`, `HEAD`])
}

/**
 * A throwaway repository: two changes before the start commit, the start itself, then a docs
 * commit, a fix and a merged branch whose own commit is off the first-parent line. `stray` is a
 * commit on a branch that was never merged. Deleted after `body`, also when it fails.
 */
async function withRepo(
  body: (repo: { dir: string; start: string; stray: string }) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: `changelog-start-` })
  try {
    await run(dir, [`init`, `-q`, `-b`, `main`])
    await commit(dir, `feat: old app screen (#1)`, 1)
    await commit(dir, `fix: old app crash`, 2)
    const start = await commit(dir, `chore: copy of Seed`, 3)
    await commit(dir, `docs: explain budgets`, 4)
    await commit(dir, `fix: keep the balance (#5)`, 5)
    await run(dir, [`switch`, `-q`, `-c`, `side`])
    await commit(dir, `feat: inside the branch`, 6)
    await run(dir, [`switch`, `-q`, `main`])
    await run(
      dir,
      [`merge`, `-q`, `--no-ff`, `-m`, `feat: budgets (#7)`, `side`],
      `2026-10-07T10:00:00Z`,
    )
    await run(dir, [`switch`, `-q`, `-c`, `stray`, start])
    const stray = await commit(dir, `feat: never merged`, 8)
    await run(dir, [`switch`, `-q`, `main`])
    await body({ dir, start, stray })
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

describe(`readChangelog with a start commit`, () => {
  it(`lists only the first-parent feat and fix commits after the start`, async () => {
    await withRepo(async ({ dir, start }) => {
      const data = await readChangelog(gitAt(dir), true, start)

      expect(data.entries).toEqual([
        { kind: `new`, text: `Budgets.`, number: 7, date: `2026-10-07T10:00:00.000Z` },
        { kind: `fixed`, text: `Keep the balance.`, number: 5, date: `2026-10-05T10:00:00.000Z` },
      ])
    })
  })

  it(`lists the whole first-parent history when the start is null`, async () => {
    await withRepo(async ({ dir }) => {
      const data = await readChangelog(gitAt(dir), true, null)

      expect(data.entries.map((entry) => entry.text)).toEqual([
        `Budgets.`,
        `Keep the balance.`,
        `Old app crash.`,
        `Old app screen.`,
      ])
    })
  })

  it(`stops with an error naming CHANGELOG_START when the history lacks the start`, async () => {
    await withRepo(async ({ dir, stray }) => {
      const git = gitAt(dir)
      for (const start of [stray, `0`.repeat(40)]) {
        await expect(readChangelog(git, false, start)).rejects.toThrow(
          `CHANGELOG_START (${start}) in apps/mpa/changelog-overrides.ts is not in the history`,
        )
      }
    })
  })

  it(`refuses in CI when no feat or fix comes after the start, whatever came before`, async () => {
    await withRepo(async ({ dir }) => {
      const head = await run(dir, [`rev-parse`, `HEAD`])

      await expect(readChangelog(gitAt(dir), true, head)).rejects.toThrow(
        `after CHANGELOG_START (${head}) holds no feat or fix commit`,
      )
    })
  })
})
