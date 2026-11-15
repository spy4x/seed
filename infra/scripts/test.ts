/// <reference lib="deno.ns" />
/**
 * `deno task test`: the unit tests, in groups that each run `deno test --parallel` with only the
 * permissions their files need, two groups at a time. A serial group runs alone at the end.
 *
 * - No arguments: a passing run prints one summary line. A failing group prints its failures,
 *   with the output of the failed tests, and the command that runs it again.
 * - `CI=true` or `--verbose`: every group's whole output, as `deno test` prints it.
 * - File or folder paths (`deno task test apps/api/routes/auth.test.ts --filter=429`): runs them
 *   with their group's permissions and prints everything. Other `-` arguments go to `deno test`.
 * - A full run first fails, naming each one, when a test file in the repository is in no group.
 * - On a Woodpecker pull request, a full run tests only the files whose imports reach a change
 *   (`relatedFlags` below).
 */

/** One `deno test` run: its permission flags and the files and folders it tests. */
export interface TestGroup {
  flags: string[]
  paths: string[]
  /** Paths under `paths` that another group tests. */
  ignore?: string[]
  /** Runs without `--parallel`, alone, once every other group is done. */
  serial?: boolean
}

/**
 * Tests that count timer turns or measure wall time, and fail when other test workers take the CPU.
 * They run in the serial group below.
 */
const TIMING_SENSITIVE = [
  `apps/api/routes/group-files.test.ts`,
  `apps/spa/src/offline/OfflineStatus.test.tsx`,
  `apps/spa/src/offline/index.test.ts`,
]

/**
 * libs/ui's interaction tests load happy-dom, whose WebSocket package reads the two WS_* variables;
 * the blog's tests read Seed's own posts.
 */
const APP_FLAGS = [
  `--allow-env=WS_NO_BUFFER_UTIL,WS_NO_UTF_8_VALIDATE`,
  `--allow-read=libs/server/blog/seed-posts`,
]

export const GROUPS: TestGroup[] = [
  {
    flags: APP_FLAGS,
    paths: [
      `apps/api`,
      `apps/spa/src`,
      `apps/admin/src`,
      `apps/worker`,
      `apps/healthcheck.test.ts`,
      `libs`,
      `e2e/fixtures`,
    ],
    ignore: TIMING_SENSITIVE,
  },
  { flags: APP_FLAGS, paths: TIMING_SENSITIVE, serial: true },
  // Fresh reads its build id from DENO_DEPLOYMENT_ID, GITHUB_SHA or CI_COMMIT_SHA when it loads.
  {
    flags: [
      `--allow-env=DENO_DEPLOYMENT_ID,GITHUB_SHA,CI_COMMIT_SHA`,
      `--allow-read=.`,
    ],
    paths: [`apps/mpa`],
    ignore: [`apps/mpa/changelog-start.test.ts`],
  },
  {
    flags: [`--allow-read`, `--allow-write`, `--allow-run=git`],
    paths: [`apps/mpa/changelog-start.test.ts`],
  },
  // Each test below reads files, so it runs with its own read grant.
  {
    flags: [`--allow-read=apps,libs`],
    paths: [`tests/spacing.test.ts`, `tests/test-catalog-boundary.test.ts`],
  },
  {
    flags: [`--allow-read=apps,libs/ui`],
    paths: [`tests/ui-boundary.test.ts`, `tests/no-direct-date-format.test.ts`],
  },
  {
    flags: [`--allow-read=apps/api`],
    paths: [
      `tests/api-error-shape.test.ts`,
      `tests/api-spa-switch.test.ts`,
      `tests/api-notes-switch.test.ts`,
    ],
  },
  {
    flags: [`--allow-read=apps/api,apps/worker`],
    paths: [`tests/api-files-switch.test.ts`],
  },
  {
    flags: [
      `--allow-read=deno.jsonc,Dockerfile.base,apps/api/dockerfile.node,apps/api/dockerfile.bun,apps/mpa/dockerfile.node,apps/mpa/dockerfile.bun`,
    ],
    paths: [`tests/dockerfile-base.test.ts`],
  },
  {
    flags: [`--allow-read=deno.jsonc,deno.lock`],
    paths: [`tests/dependency-age.test.ts`],
  },
  {
    flags: [`--allow-read=.dockerignore,.gitignore,infra/deploy/include.txt`],
    paths: [`tests/dockerignore.test.ts`, `tests/gitignore.test.ts`],
  },
  {
    flags: [`--allow-read=infra/compose,apps/worker/+main.ts`],
    paths: [
      `tests/compose-migrate.test.ts`,
      `tests/compose-mpa.test.ts`,
      `tests/compose-api-env.test.ts`,
      `tests/compose-exposure.test.ts`,
      `tests/compose-admin.test.ts`,
      `tests/compose-runtime.test.ts`,
      `tests/compose-deno-dir.test.ts`,
      `tests/compose-profiles.test.ts`,
    ],
  },
  {
    flags: [
      `--allow-read=infra/compose,infra/postgres,infra/envs/.env.example,infra/scripts/e2e-local.sh,.woodpecker/ci.yml,docs/handoff.md,docs/woodpecker-ci-setup.md`,
    ],
    paths: [`tests/compose-postgres.test.ts`],
  },
  {
    flags: [`--allow-read=infra/compose,infra/configs/glitchtip-db.sql,infra/envs/.env.example`],
    paths: [`tests/compose-errors.test.ts`],
  },
  {
    flags: [
      `--allow-read=infra/compose,infra/configs,infra/backup`,
      `--allow-run=sh`,
    ],
    paths: [
      `tests/compose-monitoring.test.ts`,
      `tests/monitoring-alerts.test.ts`,
    ],
  },
  {
    flags: [`--allow-read=libs/server/db/migrations`],
    paths: [`tests/migration-names.test.ts`],
  },
  {
    flags: [`--allow-read=docs`],
    paths: [`tests/docs-map.test.ts`],
  },
  // infra/scripts is left out of the other tools (deno.jsonc "exclude"); its tests run here.
  {
    flags: [
      `--allow-read=infra/envs,infra/compose/compose.shared.yml,deno.jsonc,tests`,
      `--allow-write=tests`,
      `--allow-run=git`,
    ],
    paths: [`infra/scripts`],
  },
  {
    flags: [`--allow-read`, `--allow-write`, `--allow-env`, `--allow-run=deno`],
    paths: [`tests/db-reset-main.test.ts`],
  },
  {
    flags: [`--allow-read=apps/spa,docs/offline.md`],
    paths: [`tests/offline-removal.test.ts`],
  },
  {
    flags: [`--allow-read=apps/spa`],
    paths: [`tests/realtime-removal.test.ts`, `tests/spa-reads.test.ts`],
  },
  {
    flags: [
      `--allow-read=apps/spa,tests`,
      `--allow-write=tests`,
      `--allow-run=sh`,
    ],
    paths: [`tests/spa-runtime-config.test.ts`],
  },
  {
    flags: [
      `--allow-read=apps/spa,tests,.woodpecker/release.yml`,
      `--allow-write=tests`,
      `--allow-run=sh`,
    ],
    paths: [`tests/spa-sourcemaps.test.ts`],
  },
  {
    flags: [
      `--allow-read=.woodpecker/ci.yml,e2e,docs/browser-tests.md,docs/woodpecker-ci-setup.md`,
    ],
    paths: [`tests/ci-browser-tests.test.ts`],
  },
  // Reads every file git tracks (docs/ids.md), which `git ls-files` lists.
  {
    flags: [`--allow-read=.`, `--allow-write=tests`, `--allow-run=git`],
    paths: [`tests/no-uuid-v4.test.ts`],
  },
  { flags: [`--allow-read=apps,libs,e2e`], paths: [`tests/no-issue-numbers-in-comments.test.ts`] },
  {
    flags: [`--allow-read=.`, `--allow-env`, `--allow-sys`],
    paths: [`tests/playwright-retries.test.ts`],
  },
  // Looks for Dockerfiles in every directory.
  { flags: [`--allow-read=.`], paths: [`tests/dockerfiles.test.ts`] },
  { flags: [], paths: [`tests/load/group-plan.test.ts`] },
  // The catalogs, and the apps' and libraries' sources for the keys they name.
  { flags: [`--allow-read=i18n,apps,libs`], paths: [`i18n`] },
]

/** The `deno test` arguments of a group, for the given paths (all of the group's by default). */
export function testArgs(
  group: TestGroup,
  paths = group.paths,
  extra: string[] = [],
): string[] {
  const ignore = group.ignore?.length ? [`--ignore=${group.ignore.join(`,`)}`] : []
  return [
    `test`,
    `--no-prompt`,
    ...group.serial ? [] : [`--parallel`],
    ...group.flags,
    ...ignore,
    ...extra,
    ...paths,
  ]
}

function covers(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

/** The group whose paths hold `path` and do not ignore it. Undefined when no group tests it. */
export function groupOf(path: string): TestGroup | undefined {
  const clean = path.replace(/^\.\//, ``).replace(/\/$/, ``)
  return GROUPS.find((group) =>
    group.paths.some((root) => covers(root, clean)) &&
    !group.ignore?.some((ignored) => covers(ignored, clean))
  )
}

/** Test files that tasks of their own run: `test:integration` and `test:files`. */
const ELSEWHERE = [`tests/integration`, `tests/files`]

/** The files among `files` that no group tests and no other task runs. */
export function ungrouped(files: string[]): string[] {
  return files.filter((file) =>
    !groupOf(file) && !ELSEWHERE.some((root) => covers(root, file.replace(/^\.\//, ``)))
  )
}

/**
 * Changes the import graph cannot see, besides any `deno.json` or `deno.jsonc`: files tests read
 * from disk, and what sets up the run. A pull request that changes one runs every test.
 */
export const RUN_ALL = [
  `deno.lock`,
  `package.json`,
  `.woodpecker`,
  `libs/server/db/migrations`,
  `libs/server/db/schema.sql`,
  `libs/server/blog/seed-posts`,
  `e2e/fixtures`,
  `apps/mpa/testdata`,
  `infra/scripts/test.ts`,
  `infra/scripts/test-integration.ts`,
]

/** Whether a change to `path` runs every test. */
export function runsAll(path: string): boolean {
  return /(^|\/)deno\.jsonc?$/.test(path) || RUN_ALL.some((root) => covers(root, path))
}

/**
 * Whether a pull request may run only the files of `group` whose imports reach a change: it runs no
 * program and reads nothing from disk but what `runsAll`, so its imports are all it depends on.
 */
export function selectable(group: TestGroup): boolean {
  return group.flags.every((flag) =>
    flag.startsWith(`--allow-env`) ||
    flag.startsWith(`--allow-read=`) && flag.slice(`--allow-read=`.length).split(`,`).every(runsAll)
  )
}

/** A file a pull request changes, and whether its head deleted it. */
export interface Change {
  path: string
  deleted: boolean
}

/** The changes in the output of `git diff --name-status --no-renames -z`. */
export function changesOf(output: string): Change[] {
  const fields = output.split(`\0`)
  const changes: Change[] = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    changes.push({ path: fields[i + 1], deleted: fields[i] === `D` })
  }
  return changes
}

/** Why every test runs for `changes`, or undefined when only the files they reach need to. */
export function runAllReason(changes: Change[]): string | undefined {
  const unseen = changes.find((change) => runsAll(change.path))
  if (unseen) return `${unseen.path} changed, which the import graph cannot see`
  if (!changes.some((change) => !change.deleted)) return `no changed file is left to trace`
}

/** Runs `git <args>` and returns its stdout; throws with its stderr when it fails. */
async function git(args: string[]): Promise<string> {
  const { success, stdout, stderr } = await new Deno.Command(`git`, { args }).output()
  const decoder = new TextDecoder()
  if (!success) throw new Error(`git ${args[0]} failed: ${decoder.decode(stderr).trim()}`)
  return decoder.decode(stdout)
}

/**
 * The `--related` flags that limit a Woodpecker pull request's tests to the files whose imports
 * reach a change, or none to run every test; on a pull request, with a note for the log that
 * says which.
 *
 * The changes are the diff between the head and the target branch's tip. That needs no shared
 * history, which Woodpecker's one-commit clone lacks, and it also counts the target's newer
 * changes: a test whose imports reach neither runs the same code the target already passed.
 * Any failure on the way runs every test. `env` and `run` stand in for the process's in tests.
 */
export async function relatedFlags(
  env = (name: string) => Deno.env.get(name),
  run = git,
): Promise<{ flags: string[]; note?: string }> {
  const target = env(`CI_PIPELINE_EVENT`) === `pull_request` && env(`CI_COMMIT_TARGET_BRANCH`)
  if (!target) return { flags: [] }
  const ref = `refs/remotes/origin/${target}`
  let reason: string | undefined
  let changes: Change[] = []
  try {
    await run([`fetch`, `--no-tags`, `origin`, `+refs/heads/${target}:${ref}`])
    changes = changesOf(await run([`diff`, `--name-status`, `--no-renames`, `-z`, ref, `HEAD`]))
    reason = runAllReason(changes)
  } catch (error) {
    reason = (error as Error).message
  }
  if (reason) return { flags: [], note: `every test runs: ${reason}` }
  return {
    flags: changes.filter((change) => !change.deleted).map((change) => `--related=${change.path}`),
    note: `only the tests whose imports reach the ${changes.length} changed files run`,
  }
}

/**
 * The number of test files `deno test` ran, read from its `running N tests from` lines and, under
 * `--parallel`, which prints none, from the `./file => test` prefix of its result lines.
 */
export function filesRun(output: string): number {
  const lines = output.replace(ANSI, ``)
    .matchAll(/^(?:running \d+ tests? from (\S+)|(\.\/\S+) => )/gm)
  return new Set(Array.from(lines, ([, serial, parallel]) => serial ?? parallel)).size
}

/** The log line that says how many of `total` test files ran and how many were skipped. */
export function filesLine(task: string, run: number, total: number): string {
  return `${task}: ${run} of ${total} test files ran; ${total - run} skipped, ` +
    `their imports reach no change`
}

/**
 * Every `*.test.ts` and `*.test.tsx` file git tracks or would track: new files count, and ignored
 * folders (`node_modules`, `.volumes`, build output) do not.
 */
export async function testFiles(): Promise<string[]> {
  const files = await git([
    `ls-files`,
    `-z`,
    `-co`,
    `--exclude-standard`,
    `*.test.ts`,
    `*.test.tsx`,
  ])
  return files.split(`\0`).filter(Boolean)
}

/** Test and step counts read from `deno test` summary lines. */
export interface Totals {
  passed: number
  failed: number
  ignored: number
  steps: number
}

const ANSI = /\x1b\[[0-9;]*m/g

/** Adds up the counts of every `ok | … passed …` or `FAILED | …` line in `output`. */
export function totalsOf(output: string): Totals {
  const totals: Totals = { passed: 0, failed: 0, ignored: 0, steps: 0 }
  for (const line of output.replace(ANSI, ``).split(`\n`)) {
    if (!/^(ok|FAILED) \| /.test(line)) continue
    for (
      const [, count, kind, steps] of line.matchAll(
        /(\d+) (passed|failed|ignored)(?: \((\d+) steps?\))?/g,
      )
    ) {
      totals[kind as `passed` | `failed` | `ignored`] += Number(count)
      if (kind === `passed`) totals.steps += Number(steps ?? 0)
    }
  }
  return totals
}

const PASSED = / \.\.\. ok \(/
const BLOCK_START = /^------- (post-test )?output -------$/
const BLOCK_END = /^----- (post-test )?output end -----$/

/**
 * The output of a failed group without what passed: the result lines of passing tests and steps,
 * the output those tests printed, the "running N tests" headers and the "Check" lines. Failed tests,
 * their output,
 * the ERRORS section and anything else stay.
 */
export function failuresOf(output: string): string {
  // Lines, with each output block gathered into one entry; a block belongs to the result line
  // that follows it.
  const entries: string[][] = []
  let block: string[] | undefined
  for (const line of output.split(`\n`)) {
    const plain = line.replace(ANSI, ``)
    if (block) {
      block.push(line)
      if (BLOCK_END.test(plain)) block = undefined
    } else if (BLOCK_START.test(plain)) entries.push(block = [line])
    else entries.push([line])
  }
  const kept = entries.filter((entry, index) => {
    const plain = entry[0].replace(ANSI, ``)
    if (entry.length > 1 || BLOCK_START.test(plain)) {
      const result = entries.slice(index + 1).find((next) => next.length === 1)?.[0] ?? ``
      return !PASSED.test(result.replace(ANSI, ``))
    }
    return !PASSED.test(plain) && !/ \.\.\.$/.test(plain) && !/^Check /.test(plain) &&
      !/^running \d+ tests? from /.test(plain)
  })
  return kept.flat().join(`\n`).replace(/\n{3,}/g, `\n\n`).trim()
}

/**
 * Runs `deno <args>` and returns whether it passed, and its stdout and then its stderr. A run still
 * going after two minutes is named once, so a hung test shows where it hangs.
 */
async function capture(args: string[]): Promise<{ success: boolean; output: string }> {
  const slow = setTimeout(
    () => console.log(`Still running after 2 min: deno ${args.join(` `)}`),
    120_000,
  )
  const { success, stdout, stderr } = await new Deno.Command(`deno`, { args }).output()
  clearTimeout(slow)
  const decoder = new TextDecoder()
  return { success, output: decoder.decode(stdout) + decoder.decode(stderr) }
}

/**
 * Groups run at once. Each already runs its files on every core (`--parallel`); two at a time
 * hides the small groups' start-up behind the large one without starving it.
 */
const JOBS = 2

/** Runs `tasks` with at most `limit` at a time and returns their results in order. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = []
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/** Runs the given paths, each with its group's permissions, printing everything as it comes. */
async function runPaths(paths: string[], extra: string[]): Promise<number> {
  const runs = new Map<TestGroup, string[]>()
  for (const path of paths) {
    const group = groupOf(path)
    if (!group) {
      console.error(`No test group covers ${path}; the groups are in infra/scripts/test.ts.`)
      return 2
    }
    runs.set(group, [...runs.get(group) ?? [], path])
  }
  let code = 0
  for (const [group, groupPaths] of runs) {
    const { success } = await new Deno.Command(`deno`, { args: testArgs(group, groupPaths, extra) })
      .spawn().status
    if (!success) code = 1
  }
  return code
}

/**
 * Runs every group, a few at a time, and prints failures and one summary line, or everything. The
 * `related` flags limit the groups that `selectable` allows.
 */
async function runAll(extra: string[], verbose: boolean, related: string[]): Promise<number> {
  const files = await testFiles()
  const missing = ungrouped(files)
  if (missing.length) {
    console.error(`No test group covers these files; add each to a group in infra/scripts/test.ts:`)
    for (const file of missing.sort()) console.error(`  ${file}`)
    return 2
  }
  const started = performance.now()
  const args = (group: TestGroup) =>
    testArgs(group, group.paths, selectable(group) ? [...extra, ...related] : extra)
  const run = (group: TestGroup) => () => capture(args(group))
  const parallel = GROUPS.filter((group) => !group.serial)
  const serial = GROUPS.filter((group) => group.serial)
  const results = await pool(parallel.map(run), JOBS)
  for (const group of serial) results.push(await run(group)())
  const order = [...parallel, ...serial]
  let failed = 0
  results.forEach(({ success, output }, index) => {
    if (verbose) console.log(output)
    if (success) return
    if (!verbose) console.log(failuresOf(output))
    failed++
    console.log(`\nFailed: deno ${args(order[index]).join(` `)}\n`)
  })
  const output = results.map((result) => result.output).join(`\n`)
  if (related.length) {
    console.log(filesLine(`test`, filesRun(output), files.filter((file) => groupOf(file)).length))
  }
  const totals = totalsOf(output)
  const seconds = Math.round((performance.now() - started) / 1000)
  const counts = `${totals.passed} passed (${totals.steps} steps) | ${totals.failed} failed` +
    (totals.ignored ? ` | ${totals.ignored} ignored` : ``)
  console.log(
    failed
      ? `test: FAILED | ${counts} | ${failed} of ${GROUPS.length} groups failed | ${seconds}s`
      : `test: ok | ${counts} | ${GROUPS.length} groups | ${seconds}s`,
  )
  if (failed) console.log(`One file with all its output: deno task test <file>`)
  return failed ? 1 : 0
}

if (import.meta.main) {
  const verbose = Deno.args.includes(`--verbose`) || Deno.env.get(`CI`) === `true`
  const extra = Deno.args.filter((arg) => arg.startsWith(`-`) && arg !== `--verbose`)
  const paths = Deno.args.filter((arg) => !arg.startsWith(`-`))
  if (paths.length) Deno.exit(await runPaths(paths, extra))
  const { flags, note } = await relatedFlags()
  if (note) console.log(`test: ${note}`)
  Deno.exit(await runAll(extra, verbose, flags))
}
