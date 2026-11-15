/// <reference lib="deno.ns" />
/**
 * `.githooks/pre-push` in a git repository of its own, pushing to a bare remote in a temp folder.
 * A fake `deno` first on PATH records each call and exits with the status the push asks for.
 */
import { expect } from "@std/expect"

const HOOK = new URL(`../.githooks/pre-push`, import.meta.url)

// Never calls the real deno; the depth variable stops it from running itself.
const FAKE_DENO = `#!/bin/sh
[ -n "$FAKE_DENO_DEPTH" ] && exit 99
export FAKE_DENO_DEPTH=1
printf '%s LANG=%s LC_ALL=%s\\n' "$*" "$LANG" "$LC_ALL" >> "$FAKE_DENO_LOG"
exit "$FAKE_DENO_STATUS"
`

interface Repo {
  /** The work tree's path. */
  work: string
  /** Runs git in the work tree; `checkStatus` is what the fake `deno task check` exits with. */
  git(args: string[], checkStatus?: number): Promise<{ code: number; output: string }>
  /** The fake deno's calls, one line each. */
  calls(): Promise<string[]>
  /** The sha the bare remote holds for a branch, or `` when it has none. */
  remoteSha(branch: string): Promise<string>
}

/** A work tree whose `main` is pushed to a bare remote, with the hook installed afterwards. */
async function withRepo(test: (repo: Repo) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: `pre-push-` })
  try {
    for (const sub of [`bin`, `hooks`, `work`]) await Deno.mkdir(`${dir}/${sub}`)
    await Deno.writeTextFile(`${dir}/bin/deno`, FAKE_DENO, { mode: 0o755 })
    await Deno.copyFile(HOOK, `${dir}/hooks/pre-push`)
    const log = `${dir}/deno.log`
    await Deno.writeTextFile(log, ``)

    const run = async (cwd: string, args: string[], checkStatus = 0) => {
      const { code, stdout, stderr } = await new Deno.Command(`git`, {
        args,
        cwd,
        clearEnv: true,
        env: {
          PATH: `${dir}/bin:${Deno.env.get(`PATH`)}`,
          HOME: dir,
          GIT_CONFIG_NOSYSTEM: `1`,
          GIT_CONFIG_GLOBAL: `/dev/null`,
          GIT_AUTHOR_NAME: `Test`,
          GIT_AUTHOR_EMAIL: `test@example.com`,
          GIT_COMMITTER_NAME: `Test`,
          GIT_COMMITTER_EMAIL: `test@example.com`,
          FAKE_DENO_LOG: log,
          FAKE_DENO_STATUS: String(checkStatus),
        },
      }).output()
      const decoder = new TextDecoder()
      return { code, output: decoder.decode(stdout) + decoder.decode(stderr) }
    }
    const must = async (cwd: string, args: string[]) => {
      const result = await run(cwd, args)
      if (result.code !== 0) throw new Error(`git ${args.join(` `)}: ${result.output}`)
      return result.output
    }

    const work = `${dir}/work`
    await must(dir, [`init`, `-q`, `--bare`, `remote.git`])
    await must(work, [`init`, `-q`, `-b`, `main`])
    await Deno.writeTextFile(`${work}/a.txt`, `one\n`)
    await must(work, [`add`, `a.txt`])
    await must(work, [`commit`, `-qm`, `one`])
    await must(work, [`remote`, `add`, `origin`, `${dir}/remote.git`])
    await must(work, [`push`, `-q`, `origin`, `main`])
    await must(work, [`config`, `core.hooksPath`, `${dir}/hooks`])

    await test({
      work,
      git: (args, checkStatus) => run(work, args, checkStatus),
      calls: async () => (await Deno.readTextFile(log)).split(`\n`).filter(Boolean),
      remoteSha: async (branch) =>
        (await must(`${dir}/remote.git`, [
          `for-each-ref`,
          `--format=%(objectname)`,
          `refs/heads/${branch}`,
        ])).trim(),
    })
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

/** Commits a change to a.txt on a new branch `feature`. */
async function change(repo: Repo) {
  await repo.git([`switch`, `-qc`, `feature`])
  await Deno.writeTextFile(`${repo.work}/a.txt`, `two\n`)
  await repo.git([`commit`, `-qam`, `two`])
}

Deno.test(`a red check refuses the push and the branch never reaches the remote`, () =>
  withRepo(async (repo) => {
    await change(repo)
    const push = await repo.git([`push`, `origin`, `feature`], 1)
    expect(push.code).not.toBe(0)
    expect(push.output).toContain(`Push refused: check is red. Run \`deno task check\``)
    expect(await repo.calls()).toEqual([`task check LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`])
    expect(await repo.remoteSha(`feature`)).toBe(``)
  }))

Deno.test(`a green check lets the push through`, () =>
  withRepo(async (repo) => {
    await change(repo)
    const push = await repo.git([`push`, `origin`, `feature`], 0)
    expect(push.code).toBe(0)
    expect(push.output).not.toContain(`Push refused`)
    expect(await repo.calls()).toHaveLength(1)
    expect(await repo.remoteSha(`feature`)).toBe(
      (await repo.git([`rev-parse`, `HEAD`])).output.trim(),
    )
  }))

Deno.test(`the check runs in CI's locale, en_US.UTF-8`, () =>
  withRepo(async (repo) => {
    await change(repo)
    await repo.git([`push`, `origin`, `feature`], 0)
    expect(await repo.calls()).toEqual([`task check LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`])
  }))

Deno.test(`deleting a branch skips the check`, () =>
  withRepo(async (repo) => {
    await change(repo)
    await repo.git([`push`, `origin`, `feature`], 0)
    const push = await repo.git([`push`, `origin`, `--delete`, `feature`], 1)
    expect(push.code).toBe(0)
    expect(await repo.calls()).toHaveLength(1)
    expect(await repo.remoteSha(`feature`)).toBe(``)
  }))

Deno.test(`a branch with no change against origin/main skips the check`, () =>
  withRepo(async (repo) => {
    await repo.git([`switch`, `-qc`, `claim`])
    await repo.git([`commit`, `-q`, `--allow-empty`, `-m`, `claim`])
    const push = await repo.git([`push`, `origin`, `claim`], 1)
    expect(push.code).toBe(0)
    expect(await repo.calls()).toEqual([])
  }))

Deno.test(`without origin/main the check runs, even for a branch with no change`, () =>
  withRepo(async (repo) => {
    await repo.git([`update-ref`, `-d`, `refs/remotes/origin/main`])
    await repo.git([`switch`, `-qc`, `claim`])
    await repo.git([`commit`, `-q`, `--allow-empty`, `-m`, `claim`])
    const push = await repo.git([`push`, `origin`, `claim`], 1)
    expect(push.code).not.toBe(0)
    expect(await repo.calls()).toHaveLength(1)
  }))
