/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { failuresOf, groupOf, GROUPS, testArgs, totalsOf, ungrouped } from "./test.ts"

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
