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
printf '%s LANG=%s LC_ALL=%s GIT_DIR=%s\\n' "$*" "$LANG" "$LC_ALL" "$GIT_DIR" >> "$FAKE_DENO_LOG"
[ -n "$FAKE_DENO_EDIT" ] && echo edited >> "$FAKE_DENO_EDIT"
exit "$FAKE_DENO_STATUS"
`

const FULL_CHECK = `task check LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 GIT_DIR=`
const FORMAT_CHECK = `task fmt:check LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 GIT_DIR=`

interface Repo {
  /** The work tree's path. */
  work: string
  /**
   * Runs git in the work tree, or in `cwd`; `checkStatus` is what the fake `deno task` exits with,
   * and the fake appends a line to the file `editDuringCheck` while it runs.
   */
  git(
    args: string[],
    checkStatus?: number,
    cwd?: string,
    editDuringCheck?: string,
  ): Promise<{ code: number; output: string }>
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

    const run = async (cwd: string, args: string[], checkStatus = 0, editDuringCheck = ``) => {
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
          FAKE_DENO_EDIT: editDuringCheck,
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
      git: (args, checkStatus, cwd = work, editDuringCheck) =>
        run(cwd, args, checkStatus, editDuringCheck),
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

/** Commits new files, each holding its own path, on the current branch. */
async function commitFiles(repo: Repo, paths: string[]) {
  for (const path of paths) {
    const file = `${repo.work}/${path}`
    await Deno.mkdir(file.slice(0, file.lastIndexOf(`/`)), { recursive: true })
    await Deno.writeTextFile(file, `${path}\n`)
  }
  await repo.git([`add`, `.`])
  await repo.git([`commit`, `-qm`, `files`])
}

/** Commits new files on a new branch `feature` and pushes it with a green check. */
async function pushFiles(repo: Repo, paths: string[]) {
  await repo.git([`switch`, `-qc`, `feature`])
  await commitFiles(repo, paths)
  return repo.git([`push`, `origin`, `feature`], 0)
}

/** Pushes HEAD's tree again, in a new commit on a new branch, with a red check. */
async function pushSameTree(repo: Repo, branch = `again`) {
  await repo.git([`switch`, `-qc`, branch])
  await repo.git([`commit`, `-q`, `--allow-empty`, `-m`, `same tree`])
  return repo.git([`push`, `origin`, branch], 1)
}

Deno.test(`a red check refuses the push and the branch never reaches the remote`, () =>
  withRepo(async (repo) => {
    await change(repo)
    const push = await repo.git([`push`, `origin`, `feature`], 1)
    expect(push.code).not.toBe(0)
    expect(push.output).toContain(`Push refused: check is red. Run \`deno task check\``)
    expect(await repo.calls()).toEqual([`task check LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 GIT_DIR=`])
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
    expect(await repo.calls()).toEqual([`task check LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 GIT_DIR=`])
  }))

// Git sets GIT_DIR for a hook run from a linked worktree, the way agents push. Left set, a test
// that runs git in a temp repository of its own rewrites this worktree's index instead.
Deno.test(`a push from a linked worktree runs the check without git's GIT_DIR`, () =>
  withRepo(async (repo) => {
    const linked = `${repo.work}-linked`
    await repo.git([`worktree`, `add`, `-q`, `-b`, `feature`, linked])
    await Deno.writeTextFile(`${linked}/a.txt`, `two\n`)
    await repo.git([`commit`, `-qam`, `two`], 0, linked)
    const push = await repo.git([`push`, `origin`, `feature`], 0, linked)
    expect(push.code).toBe(0)
    expect(await repo.calls()).toEqual([`task check LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 GIT_DIR=`])
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

Deno.test(`root Markdown alone runs the format check and lets the push through`, () =>
  withRepo(async (repo) => {
    const push = await pushFiles(repo, [`NOTES.md`])
    expect(push.code).toBe(0)
    expect(await repo.calls()).toEqual([FORMAT_CHECK])
  }))

Deno.test(`Markdown in docs, any README and i18n's own folder runs only the format check`, () =>
  withRepo(async (repo) => {
    const push = await pushFiles(repo, [
      `docs/a/b.md`,
      `apps/x/README.md`,
      `i18n/TRANSLATING.md`,
      `i18n/deep/README.md`,
    ])
    expect(push.code).toBe(0)
    expect(await repo.calls()).toEqual([FORMAT_CHECK])
  }))

Deno.test(`a red format check refuses the push and the branch never reaches the remote`, () =>
  withRepo(async (repo) => {
    await repo.git([`switch`, `-qc`, `feature`])
    await commitFiles(repo, [`NOTES.md`])
    const push = await repo.git([`push`, `origin`, `feature`], 1)
    expect(push.code).not.toBe(0)
    expect(push.output).toContain(`Push refused: format check is red. Run \`deno task fmt:fix\``)
    expect(await repo.calls()).toEqual([FORMAT_CHECK])
    expect(await repo.remoteSha(`feature`)).toBe(``)
  }))

Deno.test(`a blog post runs the full check, because tests parse it`, () =>
  withRepo(async (repo) => {
    await pushFiles(repo, [`libs/server/blog/seed-posts/x.md`])
    expect(await repo.calls()).toEqual([FULL_CHECK])
  }))

Deno.test(`Markdown deeper inside i18n runs the full check`, () =>
  withRepo(async (repo) => {
    await pushFiles(repo, [`i18n/deep/x.md`])
    expect(await repo.calls()).toEqual([FULL_CHECK])
  }))

Deno.test(`Markdown together with a code file runs the full check`, () =>
  withRepo(async (repo) => {
    await pushFiles(repo, [`NOTES.md`, `code.ts`])
    expect(await repo.calls()).toEqual([FULL_CHECK])
  }))

Deno.test(`renaming a code file to Markdown runs the full check`, () =>
  withRepo(async (repo) => {
    await repo.git([`switch`, `-qc`, `feature`])
    await repo.git([`mv`, `a.txt`, `a.md`])
    await repo.git([`commit`, `-qm`, `rename`])
    await repo.git([`push`, `origin`, `feature`], 0)
    expect(await repo.calls()).toEqual([FULL_CHECK])
  }))

Deno.test(`a branch with no history shared with origin/main runs the full check`, () =>
  withRepo(async (repo) => {
    await repo.git([`switch`, `-q`, `--orphan`, `lonely`])
    await commitFiles(repo, [`NOTES.md`])
    await repo.git([`push`, `origin`, `lonely`], 0)
    expect(await repo.calls()).toEqual([FULL_CHECK])
  }))

// Three refs, so the code ref is neither the first nor the last the hook reads.
Deno.test(`a push of docs and code refs runs the full check once`, () =>
  withRepo(async (repo) => {
    await repo.git([`switch`, `-qc`, `a-docs`])
    await commitFiles(repo, [`NOTES.md`])
    await repo.git([`branch`, `c-docs`])
    await repo.git([`switch`, `-qc`, `b-code`, `main`])
    await commitFiles(repo, [`code.ts`])
    const push = await repo.git([`push`, `origin`, `a-docs`, `b-code`, `c-docs`], 0)
    expect(push.code).toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK])
  }))

Deno.test(`a tree that passed the full check runs nothing when pushed on another branch`, () =>
  withRepo(async (repo) => {
    await pushFiles(repo, [`code.ts`])
    const push = await pushSameTree(repo)
    expect(push.code).toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK])
  }))

Deno.test(`a tree that passed in a linked worktree runs nothing from the main checkout`, () =>
  withRepo(async (repo) => {
    const linked = `${repo.work}-linked`
    await repo.git([`worktree`, `add`, `-q`, `-b`, `feature`, linked])
    await Deno.writeTextFile(`${linked}/a.txt`, `two\n`)
    await repo.git([`commit`, `-qam`, `two`], 0, linked)
    await repo.git([`push`, `origin`, `feature`], 0, linked)
    await repo.git([`branch`, `again`, `feature`])
    const push = await repo.git([`push`, `origin`, `again`], 1)
    expect(push.code).toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK])
  }))

Deno.test(`a red full check records nothing, so the next push of that tree checks again`, () =>
  withRepo(async (repo) => {
    await change(repo)
    await repo.git([`push`, `origin`, `feature`], 1)
    const push = await repo.git([`push`, `origin`, `feature`], 1)
    expect(push.code).not.toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK, FULL_CHECK])
  }))

Deno.test(`a modified tracked file records nothing`, () =>
  withRepo(async (repo) => {
    await change(repo)
    await Deno.writeTextFile(`${repo.work}/a.txt`, `uncommitted\n`)
    await repo.git([`push`, `origin`, `feature`], 0)
    const push = await pushSameTree(repo)
    expect(push.code).not.toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK, FULL_CHECK])
  }))

Deno.test(`an untracked file records nothing`, () =>
  withRepo(async (repo) => {
    await change(repo)
    await Deno.writeTextFile(`${repo.work}/untracked.ts`, `export {}\n`)
    await repo.git([`push`, `origin`, `feature`], 0)
    const push = await pushSameTree(repo)
    expect(push.code).not.toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK, FULL_CHECK])
  }))

Deno.test(`an untracked file hidden by status.showUntrackedFiles records nothing`, () =>
  withRepo(async (repo) => {
    await repo.git([`config`, `status.showUntrackedFiles`, `no`])
    await change(repo)
    await Deno.writeTextFile(`${repo.work}/untracked.ts`, `export {}\n`)
    await repo.git([`push`, `origin`, `feature`], 0)
    const push = await pushSameTree(repo)
    expect(push.code).not.toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK, FULL_CHECK])
  }))

Deno.test(`a file edited while the check runs records nothing`, () =>
  withRepo(async (repo) => {
    await change(repo)
    await repo.git([`push`, `origin`, `feature`], 0, repo.work, `${repo.work}/a.txt`)
    await repo.git([`checkout`, `-q`, `--`, `a.txt`])
    const push = await pushSameTree(repo)
    expect(push.code).not.toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK, FULL_CHECK])
  }))

Deno.test(`a green format check records nothing, so the same tree is format-checked again`, () =>
  withRepo(async (repo) => {
    await pushFiles(repo, [`NOTES.md`])
    const push = await pushSameTree(repo)
    expect(push.code).not.toBe(0)
    expect(await repo.calls()).toEqual([FORMAT_CHECK, FORMAT_CHECK])
  }))

// The hook checks the working tree, so a green run says nothing about another branch's commit.
Deno.test(`pushing a branch that is not checked out records only the checked-out tree`, () =>
  withRepo(async (repo) => {
    await change(repo)
    await repo.git([`switch`, `-q`, `main`])
    await repo.git([`push`, `origin`, `feature`], 0)
    await repo.git([`branch`, `again`, `feature`])
    const push = await repo.git([`push`, `origin`, `again`], 1)
    expect(push.code).not.toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK, FULL_CHECK])
  }))

Deno.test(`a pushed blob, which has no tree, still runs the full check`, () =>
  withRepo(async (repo) => {
    await pushFiles(repo, [`code.ts`])
    const blob = (await repo.git([`rev-parse`, `HEAD:a.txt`])).output.trim()
    const push = await repo.git([`push`, `origin`, `${blob}:refs/tags/blob`], 1)
    expect(push.code).not.toBe(0)
    expect(await repo.calls()).toEqual([FULL_CHECK, FULL_CHECK])
  }))

Deno.test(`a green full check deletes markers older than 14 days and keeps newer ones`, () =>
  withRepo(async (repo) => {
    const dir = `${repo.work}/.git/pre-push-passed`
    await Deno.mkdir(dir)
    await Deno.writeTextFile(`${dir}/old`, ``)
    await Deno.writeTextFile(`${dir}/recent`, ``)
    const day = 24 * 60 * 60
    const now = Math.floor(Date.now() / 1000)
    await Deno.utime(`${dir}/old`, now - 16 * day, now - 16 * day)
    await Deno.utime(`${dir}/recent`, now - 2 * day, now - 2 * day)
    await pushFiles(repo, [`code.ts`])
    const left = await Array.fromAsync(Deno.readDir(dir), (entry) => entry.name)
    expect(left).toContain(`recent`)
    expect(left).not.toContain(`old`)
    expect(left).toHaveLength(2)
  }))

Deno.test(`a marker that cannot be written never refuses the push`, () =>
  withRepo(async (repo) => {
    await Deno.writeTextFile(`${repo.work}/.git/pre-push-passed`, `a file, not a folder\n`)
    const push = await pushFiles(repo, [`code.ts`])
    expect(push.code).toBe(0)
    expect(await repo.remoteSha(`feature`)).not.toBe(``)
  }))
