/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  changesOf,
  failuresOf,
  filesLine,
  filesRun,
  groupOf,
  GROUPS,
  relatedFlags,
  runAllReason,
  selectable,
  testArgs,
  totalsOf,
  ungrouped,
} from "./test.ts"

const PR = { CI_PIPELINE_EVENT: `pull_request`, CI_COMMIT_TARGET_BRANCH: `main` }

/** Calls `relatedFlags` with `env` and a git whose `diff` prints `diff`, or that throws. */
async function related(
  env: Record<string, string | undefined>,
  git: { fetch?: Error; diff: string | Error },
): Promise<{ flags: string[]; note?: string; calls: string[][] }> {
  const calls: string[][] = []
  const result = await relatedFlags((name) => env[name], (args) => {
    calls.push(args)
    const output = args[0] === `fetch` ? git.fetch ?? `` : git.diff
    return output instanceof Error ? Promise.reject(output) : Promise.resolve(output)
  })
  return { ...result, calls }
}

Deno.test("runs every test when a change is one the import graph cannot see", () => {
  for (
    const path of [
      `deno.lock`,
      `deno.jsonc`,
      `apps/api/deno.json`,
      `package.json`,
      `.woodpecker/ci.yml`,
      `libs/server/db/migrations/2026_11_03_0001_users_onboarding.sql`,
      `libs/server/db/schema.sql`,
      `libs/server/blog/seed-posts/en/hello.md`,
      `e2e/fixtures/app.ts`,
      `apps/mpa/testdata/post-figures/a.json`,
      `infra/scripts/test.ts`,
      `infra/scripts/test-integration.ts`,
    ]
  ) {
    const view = { path: `apps/spa/src/views/notes.tsx`, deleted: false }
    expect(runAllReason([view, { path, deleted: false }])).toContain(path)
  }
  expect(runAllReason([{ path: `apps/spa/src/views/notes.tsx`, deleted: false }])).toBeUndefined()
})

Deno.test("runs every test when no changed file is left to trace", () => {
  expect(runAllReason([])).toBe(`no changed file is left to trace`)
  expect(runAllReason([{ path: `libs/ui/old.tsx`, deleted: true }])).toBe(
    `no changed file is left to trace`,
  )
})

Deno.test("limits only the groups whose files depend on nothing but their imports", () => {
  // Every other group reads the source tree from disk or runs a program, so it always runs whole.
  // Two tests read only files whose change runs every test: deno.jsonc and deno.lock, migrations.
  expect(GROUPS.filter(selectable).flatMap((group) => group.paths)).toEqual([
    ...GROUPS[0].paths,
    ...groupOf(`apps/spa/src/offline/index.test.ts`)!.paths,
    `tests/dependency-age.test.ts`,
    `tests/migration-names.test.ts`,
    `tests/load/group-plan.test.ts`,
  ])
  const related = [`--related=libs/ui/notes.tsx`]
  expect(testArgs(GROUPS[0], GROUPS[0].paths, [], related)).toContain(related[0])
  const scan = groupOf(`tests/ui-boundary.test.ts`)!
  expect(testArgs(scan, scan.paths, [], related)).not.toContain(related[0])
})

Deno.test("reads changed and deleted files from git's name-status output", () => {
  expect(changesOf(`M\0apps/a.ts\0D\0libs/b.ts\0A\0c d.ts\0`)).toEqual([
    { path: `apps/a.ts`, deleted: false },
    { path: `libs/b.ts`, deleted: true },
    { path: `c d.ts`, deleted: false },
  ])
  expect(changesOf(``)).toEqual([])
})

Deno.test("tests only what a pull request's changes reach, against its target's tip", async () => {
  const { flags, note, calls } = await related(PR, {
    diff: `M\0apps/spa/src/views/a.tsx\0D\0libs/ui/old.tsx\0`,
  })
  // A deleted file is no module to trace; the files that imported it changed too.
  expect(flags).toEqual([`--related=apps/spa/src/views/a.tsx`])
  expect(note).toBe(`only the tests whose imports reach the 2 changed files run`)
  expect(calls).toEqual([
    [`fetch`, `--no-tags`, `origin`, `+refs/heads/main:refs/remotes/origin/main`],
    [`diff`, `--name-status`, `--no-renames`, `-z`, `refs/remotes/origin/main`, `HEAD`],
  ])
})

Deno.test("tests everything without asking git when the run is not a pull request's", async () => {
  for (
    const env of [
      {},
      { CI_PIPELINE_EVENT: `push`, CI_COMMIT_TARGET_BRANCH: `main` },
      { CI_PIPELINE_EVENT: `cron`, CI_COMMIT_TARGET_BRANCH: `main` },
      { CI_PIPELINE_EVENT: `tag`, CI_COMMIT_TARGET_BRANCH: `main` },
      { CI_PIPELINE_EVENT: `pull_request` },
    ]
  ) {
    expect(await related(env, { diff: `M\0apps/a.ts\0` })).toEqual({ flags: [], calls: [] })
  }
})

Deno.test("tests everything when git fails or nothing is left to trace", async () => {
  const diff = `M\0apps/a.ts\0`
  for (
    const [git, note] of [
      [{ fetch: new Error(`git fetch failed: offline`), diff }, `git fetch failed: offline`],
      [{ diff: new Error(`git diff failed: bad ref`) }, `git diff failed: bad ref`],
      [{ diff: `` }, `no changed file is left to trace`],
      [{ diff: `M\0deno.lock\0${diff}` }, `deno.lock changed, which the import graph cannot see`],
    ] as const
  ) expect(await related(PR, git)).toMatchObject({ flags: [], note: `every test runs: ${note}` })
})

Deno.test("counts each test file that ran once, and the ones skipped", () => {
  const output = [
    `\x1b[0m\x1b[38;5;245mrunning 2 tests from ./a.test.ts\x1b[0m`,
    `running 1 test from ./b.test.ts`,
    `running 0 tests from ./c.test.ts`,
    `a test that prints running 1 test from ./d.test.ts ... ok (1ms)`,
    `running 2 tests from ./a.test.ts`,
    // Under --parallel, deno test names each test's file instead.
    `\x1b[0m\x1b[38;5;245m./e.test.ts =>\x1b[0m one ... ok (1ms)`,
    `./e.test.ts => two ... ok (1ms)`,
    `./a.test.ts => three ... ok (1ms)`,
    `fails => ./f.test.ts:2:6`,
  ].join(`\n`)
  expect(filesRun(output)).toBe(4)
  expect(filesLine(`test`, 3, 10)).toBe(
    `test: 3 of 10 test files ran; 7 skipped, their imports reach no change`,
  )
})

Deno.test("runs a file with the permissions of the group that tests it", () => {
  const changelog = groupOf(`apps/mpa/changelog-start.test.ts`)!
  expect(changelog.flags).toContain(`--allow-run=git`)
  // The website's other files run in the group that leaves this one out.
  const website = groupOf(`./apps/mpa/routes/index.test.ts`)!
  expect(website.ignore).toEqual([`apps/mpa/changelog-start.test.ts`])
  expect(groupOf(`libs/ui/notes.test.tsx`)).toBe(GROUPS[0])
  expect(groupOf(`tests/no-uuid-v4.test.ts`)!.flags).toContain(
    `--allow-run=git`,
  )
  // A folder that only starts like a group's folder is not in it.
  expect(groupOf(`apps/mpa-old/x.test.ts`)).toBeUndefined()
  expect(groupOf(`docs/x.test.ts`)).toBeUndefined()
})

Deno.test("names the test files no group runs, but not those another task runs", () => {
  expect(ungrouped([
    `./tests/x.test.ts`,
    `./libs/ui/notes.test.tsx`,
    `./tests/integration/notes.test.ts`,
    `./tests/files/store.test.ts`,
    `./docs/y.test.tsx`,
  ])).toEqual([`./tests/x.test.ts`, `./docs/y.test.tsx`])
})

Deno.test("runs every group in parallel but the serial one, with its ignored files left out", () => {
  expect(testArgs(groupOf(`apps/mpa`)!, [`apps/mpa/a.test.ts`], [`--filter=x`])).toEqual([
    `test`,
    `--no-prompt`,
    `--parallel`,
    `--allow-env=DENO_DEPLOYMENT_ID,GITHUB_SHA,CI_COMMIT_SHA`,
    `--allow-read=.`,
    `--ignore=apps/mpa/changelog-start.test.ts`,
    `--filter=x`,
    `apps/mpa/a.test.ts`,
  ])
  // A test that counts timer turns runs alone, not beside the workers of the app group.
  const timing = groupOf(`apps/spa/src/offline/index.test.ts`)!
  expect(timing.serial).toBe(true)
  expect(testArgs(timing)).not.toContain(`--parallel`)
  expect(testArgs(GROUPS[0]).join(` `)).toContain(`apps/spa/src/offline/index.test.ts`)
})

Deno.test("adds up the tests, steps and failures of every group's summary", () => {
  const output = [
    `\x1b[0m\x1b[32mok\x1b[0m | 817 passed (4744 steps) | 0 failed \x1b[0m\x1b[38;5;245m(3m35s)\x1b[0m`,
    `a test whose name says 5 passed ... ok (1ms)`,
    `FAILED | 2 passed (1 step) | 1 failed (13ms)`,
    `ok | 3 passed | 0 failed | 1 ignored (1s)`,
  ].join(`\n`)
  expect(totalsOf(output)).toEqual({
    passed: 822,
    failed: 1,
    ignored: 1,
    steps: 4745,
  })
})

Deno.test("prints a failed test with its output, and drops the tests that passed", () => {
  const output = [
    `running 3 tests from ./a.test.ts`,
    `passes noisily ...`,
    `------- output -------`,
    `noise`,
    `----- output end -----`,
    `passes noisily ... \x1b[32mok\x1b[0m (1ms)`,
    `fails ...`,
    `------- post-test output -------`,
    `context before failure`,
    `----- post-test output end -----`,
    `fails ... FAILED (2ms)`,
    `quiet ... ok (0ms)`,
    ``,
    ` ERRORS `,
    `fails => ./a.test.ts:2:6`,
    `error: Error: boom`,
  ].join(`\n`)
  expect(failuresOf(output).split(`\n`)).toEqual([
    `------- post-test output -------`,
    `context before failure`,
    `----- post-test output end -----`,
    `fails ... FAILED (2ms)`,
    ``,
    ` ERRORS `,
    `fails => ./a.test.ts:2:6`,
    `error: Error: boom`,
  ])
})
